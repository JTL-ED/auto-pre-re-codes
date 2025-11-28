// ==UserScript==
// @name         NEW-Pre-requisito v4
// @namespace    https://accesosede.my.salesforce.com/
// @version      1.4.1
// @description  solucionar modal ventana, diferencia EDIT (desactiva todo) y NEW / CREATE
// @match        https://*.lightning.force.com/*
// @match        https://*.salesforce.com/*
// @author       Jiatai + Carles + GPT
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==


(function() {
    const MODAL_WHITELIST = new Set(['01/01', '01/07','03/07']);

    const NAME_RULES = {
        '01/01': [{label: 'PART', write: 'PART', key: 'PART_Acciones' }, 'REQ ORG CLIENT', 'DIVISIO', 'REHABILITACIO'],
        '01/04': 'CES OC',
        '01/06': 'IE',
        '01/07': ['FASE OBRA', 'ANULAR', 'PTE ACT CLIENT'],
        '01/19': 'CES',
        '01/18': 'OBRA CIVIL',
        '01/20': 'AJUSTAT',
        '01/21': 'ACTA',
        //'01/24': '',
        //'01/25': '',
        //'01/26': '',
        //'01/27': '',
        //----------------------------------------------------------------------------------------------------------------
        '02/08': 'ESCREIX',
        //----------------------------------------------------------------------------------------------------------------
        '03/09': 'CP2',
        '03/11': {label: 'PART', write: 'PART', key: 'PART_Permisos' },
        '03/13': 'PER',
        '03/14': 'APS',
        '03/07': ['OBRA BACKLOG', 'CP1', 'SUPEDITAT', 'CIVICOS', 'ESTUDI', 'AGP', 'CTR', 'FASES', 'TRAÇAT', 'CE'],
        //----------------------------------------------------------------------------------------------------------------
        //'04/15': '',
        //'04/16': '',
    };

    const COMM_RULES_3 = {
        '01/01/PART_Acciones': 'Pendiente aportación de los permisos de terceros afectados para la realización de los trabajos.',
        '01/01/REQ ORG CLIENT': 'Pendiente aportación de la documentación requerida por los Organismos Oficiales en el proceso de tramitación de permisos.',
        '01/01/DIVISIO': 'Pendiente que nos haga llegar la nueva estructura del edificio para el reparto de la potencia.',
        '01/01/REHABILITACIO': 'Pendiente que nos haga llegar la División Horizontal para poder finalizar el expediente.',
        //--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
        '01/07/ANULAR': 'Pendiente aportación carta de anulación, justificante de pago y certificado de titularidad bancaria.',
        '01/07/FASE OBRA': '',
        '01/07/PTE ACT CLIENT': 'Temporalmente, la gestión del expediente queda suspendida a la espera de la aportación por su parte de los documentos que se le han requerido.',
    };

    const COMM_RULES_2 = {
        '01/04': 'En breve les serán requeridos los documentos necesarios para realizar la cesión del CT/CM.',
        '01/06': 'Pendiente instalacion de la Caja General de Protección/Caja de Protección y Medida.',
        //'01/08': 'Pendiente de pago del sobrecoste  indicado en las condiciones - técnico econòmicas remitidas.',
        '01/18': 'Pendiente recibir información del espacio reservado para ubicar el CT/CM.',
        '01/19': 'En breve les serán requeridos los documentos necesarios para la cesión de las instalaciones.',
        '01/20': 'Pendiente recibir proyecto eléctrico para revisión.',
        '01/21': 'Una vez validado el proyecto eléctrico, tendrá que aportar permisos y autorizaciones concedidas, y cronograma de ejecución de obra para programar Acta de Lanzamiento.',
        //'01/24': '',
        //'01/25': '',
        //'01/26': '',
        //'01/27': '',
        //--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

        '02/08': 'Pendiente de pago del sobrecoste  indicado en las condiciones - técnico econòmicas remitidas.',
    };

    const NAME_LABEL_RX = /Nombre del Pre-?requisito/i;
    const COMM_LABEL_RX = /Comunicaci[oó]n al cliente\s*\(push\)/i;

    // Detectores de contexto (URL) //Create
    const RX_NEW = /\/lightning\/o\/Prerequisite__c\/create(?:\?|$)/i;
    const RX_CREATE = /\/lightning\/cmp\/c__nnssCreatePrerequisito(?:\?|$)/i;

    const RX_EDIT = /\/lightning\/r\/Prerequisite__c\/[^/]+\/edit(?:\?|$)/i;
    const RX_VIEW = /\/lightning\/r\/Prerequisite__c\/[^/]+\/view(?:\?|$)/i;


    let COMM_PENDING = false;
    let COMM_DEBOUNCE_T = null;

    // —— Utils de normalización y comparación —— //
    const collator = new Intl.Collator('es', { sensitivity:'base', usage:'sort' });
    const toObj = (x) => (typeof x === 'object' ? x : { label:String(x), write:String(x), key:String(x) });
    const byLabel = (a,b) => collator.compare(
        (toObj(a).label ?? toObj(a).write ?? '').trim(),
        (toObj(b).label ?? toObj(b).write ?? '').trim()
    );
    const buildKey2 = (tipo, subtipo) => `${tipo ?? ''}/${subtipo ?? ''}`;
    const buildKey3 = (tipo, subtipo, nameKey) => `${buildKey2(tipo, subtipo)}/${nameKey ?? ''}`;
    const guardReady = () => !(ST.modalOpen || ST.choosing);


    const ST = {
        tipo: null,
        subtipo: null,
        nameHost: null,
        commHost: null,
        tipoHost: null,
        subtipoHost: null,
        modalOpen: false,
        choosing: false,
        lastKeyName: null,
        lastTextName: null,
        lastKeyComm: null,
        lastTextComm: null,
        pickerEl: null,
        _insidePickerClick: false,
        lockNameOnce: false,
        lastNameKey: null,
        preNameOverride: null,
        noProcShownKey: null,
        _lastHadRule: null,
        // dentro de const ST = { ... }
        mode: 'view', // 'new' | 'edit' | 'view'
        canAutofill: false, // permiso para que applyName/applyComm actúen

    };

    const ESTUDI_TARGET = { tipo: '03', subtipo: '07' };
    const ESTUDI_VARIANTS = [
        { label: 'ESTUDI - PER', write: 'ESTUDI - PER', key: 'ESTUDI_PER' },
        { label: 'ESTUDI - PART', write: 'ESTUDI - PART', key: 'ESTUDI_PART' },
        { label: 'ESTUDI - CAR', write: 'ESTUDI - CAR', key: 'ESTUDI_CAR' },
        { label: 'ESTUDI - ERROR', write: 'ESTUDI - ERROR', key: 'ESTUDI_ERROR' },
        { label: 'ESTUDI - CLIENT', write: 'ESTUDI - CLIENT', key: 'ESTUDI_CLIENT' },
        { label: 'ESTUDI - EXE', write: 'ESTUDI - EXE', key: 'ESTUDI_EXE' },
        { label: 'ESTUDI - SO', write: 'ESTUDI - SO', key: 'ESTUDI_SO' },
    ];

    async function resetFields(level = 4) {
        ensurePickHosts();
        ST.nameHost = ST.nameHost || findHostByLabel(NAME_LABEL_RX, ['lightning-input','lightning-input-field']);
        ST.commHost = ST.commHost || findHostByLabel(COMM_LABEL_RX, ['lightning-textarea','lightning-input-rich-text','lightning-input-field']);

        if (level >= 1) {
            if (ST.nameHost) writeHostValue(ST.nameHost, '');
            ST.lastKeyName = null;
            ST.lastTextName = '';
            ST.lastNameKey = null;
        }
        if (level >= 2) {
            if (ST.commHost) writeHostValue(ST.commHost, '');
            ST.lastKeyComm = null;
            ST.lastTextComm = '';
        }
        if (level >= 3) {
            ST.subtipo = null;
            ST._lastHadRule = null;
            ST.noProcShownKey = null;
            if (ST.subtipoHost) {
                try {
                    ST.subtipoHost.value = '';
                    ST.subtipoHost.dispatchEvent(new CustomEvent('change', { detail:{ value:'' }, bubbles:true, composed:true }));
                    ST.subtipoHost.dispatchEvent(new Event('blur', { bubbles:true, composed:true }));
                } catch(_) {}
            }
        }
        if (level >= 4) {
            ST.tipo = null;
            if (ST.tipoHost) {
                try {
                    ST.tipoHost.value = '';
                    ST.tipoHost.dispatchEvent(new CustomEvent('change', { detail:{ value:'' }, bubbles:true, composed:true }));
                    ST.tipoHost.dispatchEvent(new Event('blur', { bubbles:true, composed:true }));
                } catch(_) {}
            }
        }
        ST.lockNameOnce = false;
        ST.modalOpen = false;
        ST.choosing = false;
        destroyPicker();
        document.getElementById('__af_modal_root__')?.remove();
    }

    const resetName = () => resetFields(1);
    const resetNameAndComm = () => resetFields(2);
    const resetNameCommAndSubtipo = () => resetFields(3);
    const resetAll = () => resetFields(4);

    async function resetFieldsDeferred(level = 2, ms = 80) { //可选稳妥）把 resetFieldsDeferred 的延时再拉长一点
        await delay(ms); // 延后一个很小的时间，避开 LWC 的一次同步校验周期
        await resetFields(level); // 再去清空
    }

    async function pickEstudiVariant() {
        const sorted = [...ESTUDI_VARIANTS].sort((a,b) => collator.compare(a.label||'', b.label||''));
        await resetFieldsDeferred(2);
        await delay(100);
        return await showChoiceModal('Seleccione Pre-requisito (ESTUDI)', sorted);
    }

    function requestApplyComm() {
        // 弹窗开着就先记一笔，等关闭后再执行
        if (ST.modalOpen || ST.choosing) { COMM_PENDING = true; return; }
        // 简单防抖
        clearTimeout(COMM_DEBOUNCE_T);
        COMM_DEBOUNCE_T = setTimeout(() => {
            COMM_PENDING = false;
            applyComm(); // 真正调用
        }, 160);// （可选）把通信的防抖再宽一点
    }

    function* walkDeep(root, opts = {}) {
        const MAX_NODES = opts.maxNodes ?? 2000;
        const MAX_DEPTH = opts.maxDepth ?? 4;
        let seen = 0;
        const stack = [{ node: root, depth: 0 }];
        while (stack.length) {
            const { node, depth } = stack.pop();
            if (!node) continue;
            yield node;
            if (++seen >= MAX_NODES) break;
            if (depth >= MAX_DEPTH) continue;
            if (node.shadowRoot) stack.push({ node: node.shadowRoot, depth: depth + 1 });
            if (node.children && node.children.length) {
                for (let i = node.children.length - 1; i >= 0; i--) {
                    stack.push({ node: node.children[i], depth: depth + 1 });
                }
            }
            const tag = node.tagName;
            if (tag === 'IFRAME' || tag === 'FRAME') {
                try {
                    if (node.contentDocument) {
                        stack.push({ node: node.contentDocument, depth: depth + 1 });
                    }
                } catch (_) {}
            }
        }
    }

    const __FH_CACHE__ = new Map();

    function findHostByLabel(rx, tags){
        const key = rx.toString() + '|' + tags.join(',');
        const cached = __FH_CACHE__.get(key);
        if (cached && document.contains(cached)) return cached;

        const fast = document.querySelectorAll(tags.join(','));
        for (const el of fast) {
            const lab = (el.label || el.getAttribute?.('label') || '').trim();
            if (rx.test(lab)) { __FH_CACHE__.set(key, el); return el; }
        }
        for (const root of walkDeep(document, { maxNodes: 2000, maxDepth: 4 })) {
            if (!root.querySelectorAll) continue;
            for (const tag of tags) {
                const list = root.querySelectorAll(tag);
                for (const el of list) {
                    const lab = (el.label || el.getAttribute?.('label') || '').trim();
                    if (rx.test(lab)) { __FH_CACHE__.set(key, el); return el; }
                }
            }
        }
        return null;
    }

    function writeHostValue(host, text=''){
        try{
            if(!host) return false;
            const current = (host.value ?? '');
            if(current === text) return true;
            host.value = text;

            try {
                host.dispatchEvent(new InputEvent('input', { bubbles:true, composed:true }));
            } catch(_) {
                host.dispatchEvent(new Event('input', { bubbles:true, composed:true }));
            }
            host.dispatchEvent(new CustomEvent('change', { detail:{ value:text }, bubbles:true, composed:true }));
            host.dispatchEvent(new Event('blur', { bubbles:true, composed:true }));
            // —— 关键：若是必填字段且文本非空，主动清除错误并触发一次校验 —— //
            try {
                if (text && text.trim() !== '') {
                    if (typeof host.setCustomValidity === 'function') host.setCustomValidity('');
                    if (typeof host.reportValidity === 'function') host.reportValidity();
                }
            } catch(_) {}
            return true;
        }catch(e){
            console.warn('Error al escribir:', e);
            return false;
        }
    }

    // —— Builder de modal genérico —— //
    async function showModal({ title, bodyHTML, actions }) {
        return new Promise(resolve => {
            const root = document.createElement('div');
            root.id = '__af_modal_root__';
            root.innerHTML = `
        <div class="af-backdrop"></div>
        <div class="af-modal" role="dialog" aria-modal="true" aria-label="${title}">
          <div class="af-header">${title}</div>
          <div class="af-body">${bodyHTML || ''}</div>
          <div class="af-actions"></div>
        </div>`;

            const style = document.createElement('style');
            style.id = 'af-modal-style';
            style.textContent = `
  #__af_modal_root__{position:fixed;inset:0;z-index:999999;font-family:system-ui,Segoe UI,Arial,Helvetica,sans-serif}
  #__af_modal_root__ .af-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.35)}
  #__af_modal_root__ .af-modal{
    position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
    background:#fff;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.3);
    padding:16px;display:flex;flex-direction:column;gap:12px;
    width:fit-content;max-width:90vw;min-width:360px;
  }
  #__af_modal_root__ .af-header{font-weight:600;font-size:16px}
  /* grid de opciones (se controla el nº de columnas con --af-cols) */
  #__af_modal_root__ .af-body-grid{
    display:grid;grid-template-columns: repeat(var(--af-cols,3), minmax(110px, 1fr));
    gap:10px; align-items:stretch;
  }
  #__af_modal_root__ .af-option{
    min-height:40px; padding:10px 12px; border-radius:10px;
    border:1px solid #e3e3e3; background:#f6f7f9; cursor:pointer;
    width:100%; display:flex; align-items:center; justify-content:center; text-align:center;
    white-space:normal; word-break:break-word; overflow:visible;
  }
  #__af_modal_root__ .af-option:hover{background:#eef2ff;border-color:#c7d2fe}
  #__af_modal_root__ .af-actions{display:flex;justify-content:flex-end}
  #__af_modal_root__ .af-ok, #__af_modal_root__ .af-cancel{
    padding:8px 12px;border-radius:8px;border:1px solid #ddd;background:#fff;cursor:pointer
  }
  #__af_modal_root__ .af-ok:hover, #__af_modal_root__ .af-cancel:hover{background:#f7f7f7}
  `;

            document.body.appendChild(style);
            document.body.appendChild(root);
            const $actions = root.querySelector('.af-actions');
            (actions || [{label:'Aceptar', id:'ok'}]).forEach(a => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'af-ok';
                b.textContent = a.label;
                b.addEventListener('click', () => done(a.id));
                $actions.appendChild(b);
            });
            function done(result){ root.remove(); style.remove(); resolve(result); }

            //可选
            //function done(result){
            //  try { root.remove(); style.remove(); } catch(_) {}
            // 兜底：任何关闭路径都把标志位清掉
            //  ST.modalOpen = false;
            //  ST.choosing = false;
            //  resolve(result);
            //}

            root.querySelector('.af-backdrop').addEventListener('click', () => done(null));
            document.addEventListener('keydown', e => { if (e.key === 'Escape') done(null); }, { once:true });
        });
    }



    function showChoiceModal(title, choices) {
        if (ST.modalOpen || ST.choosing) return Promise.resolve(null);
        ST.modalOpen = true; ST.choosing = true;

        choices = [...choices].sort(byLabel);
        const cols = Math.min(3, Math.max(1, choices.length));
        const body = `
    <div class="af-body-grid" style="--af-cols:${cols}">
      ${choices.map((c,i)=>`<button class="af-option" data-idx="${i}" type="button" title="${toObj(c).label}">${toObj(c).label}</button>`).join('')}
    </div>`;

        return new Promise(resolve => {
            let finished = false;
            const finalize = (val) => {
                if (finished) return; // ejecutar solo una vez
                finished = true;
                // cerrar modal
                try {
                    document.getElementById('__af_modal_root__')?.remove();
                    document.getElementById('af-modal-style')?.remove();
                } catch(_) {}
                // reset
                ST.modalOpen = false;
                ST.choosing = false;
                ST.canAutofill = true;
                // 如果有挂起的 applyComm 请求，这里补一次（带防抖）
                if (typeof COMM_PENDING !== 'undefined' && COMM_PENDING) requestApplyComm();
                resolve(val ?? null);
            };
            showModal({ title, bodyHTML: body, actions: [{label:'Cancelar', id:null}] })
                .then(() => finalize(null));

            document.querySelectorAll('.af-option').forEach((btn, i) => {
                const handler = (ev) => {
                    // 防止被外层 Lightning 失焦/遮罩抢走事件
                    ev.preventDefault();
                    ev.stopPropagation();
                    ev.stopImmediatePropagation();
                    finalize(choices[i]);
                };
                // 提前于 click 的通道，更稳
                btn.addEventListener('pointerdown', handler, { once: true, capture: true });
                // 兜底（某些环境仍走 click）
                btn.addEventListener('click', handler, { once: true, capture: true });
            });

        });
    }


    function showNoticeModal(message){
        if (ST.modalOpen || ST.choosing) return Promise.resolve();
        ST.modalOpen = true; ST.choosing = true;
        return showModal({ title:'Aviso', bodyHTML:`<div class="af-msg" style="padding:6px 2px;">${message}</div>` })
            .then(()=>{ ST.modalOpen=false; ST.choosing=false; });
    }

    async function chooseFromRule(key, rule){
        if (rule === undefined) return null;
        // Si la regla es lista
        if (Array.isArray(rule)) {
            // Sin modal: toma la primera normalizada
            if (!MODAL_WHITELIST.has(key)) return toObj(rule[0]);
            if (!guardReady()) return null;
            await resetFieldsDeferred(2); // limpia Nombre + Comunicación antes del modal
            const picked = await showChoiceModal('Seleccione Pre-requisito', [...rule].sort(byLabel));
            if (!picked) return null;
            // Subflujo ESTUDI centralizado
            if (key === '03/07' && (toObj(picked).label||toObj(picked).write||'').trim().toUpperCase() === 'ESTUDI') {
                const v = await pickEstudiVariant();
                return v ? toObj(v) : null;
            }
            return toObj(picked);
        }
        // Regla única
        return toObj(rule);
    }

    function buildNameCatalog(rules){
        const out = [];
        for (const key of Object.keys(rules)) {
            const [tipo, subtipo] = key.split('/');
            const val = rules[key];
            const push = (x) => {
                if (!x) return;
                if (typeof x === 'string') {
                    out.push({ label: x, write: x, key: x, tipo, subtipo });
                } else {
                    const label = x.label ?? x.write ?? '';
                    const write = x.write ?? x.label ?? '';
                    const k = x.key ?? write;
                    out.push({ label, write, key: k, tipo, subtipo });
                }
            };
            Array.isArray(val) ? val.forEach(push) : push(val);
        }
        out.sort((a,b)=> collator.compare(a.label, b.label));
        return out;
    }
    const NAME_CATALOG = buildNameCatalog(NAME_RULES);

    function computePartGroups(rules){
        const groups = new Map();
        for (const key of Object.keys(rules)) {
            const [tipo, subtipo] = key.split('/');
            const val = rules[key];
            const push = (x) => {
                if (!x) return;
                const label = (typeof x==='object') ? (x.label ?? x.write ?? '') : x;
                const write = (typeof x==='object') ? (x.write ?? x.label ?? '') : x;
                const k = (typeof x==='object') ? (x.key ?? write) : write;
                if (String(write).trim().toUpperCase() !== 'PART') return;
                const gk = `${tipo}/${subtipo}`;
                if (!groups.has(gk)) groups.set(gk, { tipo, subtipo, variants: [] });
                groups.get(gk).variants.push({ label, write:'PART', key:k, tipo, subtipo });
            };
            Array.isArray(val) ? val.forEach(push) : push(val);
        }
        return [...groups.values()].filter(g => g.variants.length > 0);
    }
    const PART_GROUPS = computePartGroups(NAME_RULES);

    function ensurePickHosts(){
        if (!ST.tipoHost) ST.tipoHost = findHostByLabel(/^Tipo$/i, ['lightning-combobox']);
        if (!ST.subtipoHost) ST.subtipoHost = findHostByLabel(/^Subtipo$/i, ['lightning-combobox']);
    }

    function delay(ms){ return new Promise(r=>setTimeout(r, ms)); }
    function validateCombo(host){
        try { if (typeof host.reportValidity === 'function') return host.reportValidity(); }
        catch(_) {}
        return true;
    }

    async function setComboValue(host, valueOrLabel){
        if (!host) return false;
        try{
            host.value = valueOrLabel;
            host.dispatchEvent(new CustomEvent('change', { detail:{ value: valueOrLabel }, bubbles:true, composed:true }));
            host.dispatchEvent(new Event('blur', { bubbles:true, composed:true }));
            await delay(50);
            if (validateCombo(host)) return true;

            const trigger = host.shadowRoot?.querySelector('input.slds-input,[role="combobox"],button.slds-combobox__input');
            trigger?.click();
            await delay(60);

            const opts = Array.from(document.querySelectorAll('div.slds-listbox__option, li.slds-listbox__item .slds-media, li.slds-listbox__item'));
            const goal = String(valueOrLabel).trim().toLowerCase();
            let target = opts.find(el => {
                const dv = el.getAttribute?.('data-value') || el.dataset?.value || '';
                if (dv && String(dv).trim().toLowerCase() === goal) return true;
                const txt = (el.textContent || '').trim().toLowerCase();
                return txt === goal;
            }) || opts.find(el => (el.textContent||'').trim().toLowerCase().startsWith(goal));

            if (target) {
                (target.closest('li') || target).click();
                await delay(80);
                if (validateCombo(host)) return true;
            }
            const finalVal = host.value;
            host.dispatchEvent(new CustomEvent('change', { detail:{ value: finalVal }, bubbles:true, composed:true }));
            host.dispatchEvent(new Event('blur', { bubbles:true, composed:true }));
            await delay(30);
            return validateCombo(host);
        } catch(e){
            console.warn('No se pudo establecer combobox:', e);
            return false;
        }
    }

    function destroyPicker(){
        ST.pickerEl?.remove();
        ST.pickerEl = null;
        ST._insidePickerClick = false;
    }

    function positionPickerNear(host, wrap){
        const r = host.getBoundingClientRect?.(); if (!r) return;
        const w = wrap.offsetWidth || 240;
        const gapX = 8, gapY = 8;
        let left = Math.min(r.right + gapX, innerWidth - w - 8);
        let top = Math.max(8, r.top);
        wrap.style.left = left + 'px';
        wrap.style.top = top + 'px';
    }

    function openNamePickerOnDemand(){
        if (document.getElementById('__af_name_picker_ephemeral__')) destroyPicker();

        if (ST.mode !== 'new') return;
        if (!ST.nameHost) return;
        destroyPicker();

        const wrap = document.createElement('div');
        wrap.id = '__af_name_picker_ephemeral__';
        Object.assign(wrap.style, {
            position:'fixed', zIndex:'999998', background:'#fff',
            border:'1px solid #e3e3e3', borderRadius:'8px', padding:'6px 8px',
            boxShadow:'0 6px 24px rgba(0,0,0,0.12)', display:'flex',
            alignItems:'stretch', gap:'8px',
            fontFamily:'system-ui, Segoe UI, Arial, Helvetica, sans-serif',
            width:'auto',
        });

        const label = document.createElement('div');
        label.innerHTML = 'Selección&nbsp;del<br>Pre-requisito:';
        Object.assign(label.style, {
            fontSize: '12px',
            lineHeight: '1.25',
            fontWeight: '600',
            whiteSpace: 'normal',
            wordBreak: 'keep-all',
            overflowWrap: 'normal',
            flex: '0 0 auto',
            minWidth: 'max-content',
            padding: '4px 2px',
            marginRight: '8px'
        });

        const list = document.createElement('div');
        Object.assign(list.style, {
            display:'grid',
            gridTemplateColumns:'repeat(2, minmax(100px, 1fr))',
            gap:'6px',
            maxHeight:'min(60vh, 394px)',
            overflow:'auto',
            width:'100%'
        });

        function mkBtn(entry){
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = entry.label;
            Object.assign(b.style, {
                fontSize:'12px', padding:'8px 10px', borderRadius:'8px',
                border:'1px solid #d7d2d7', background:'#f6f7f9',
                cursor:'pointer', textAlign:'left', width:'100%'
            });
            b.addEventListener('mouseenter', () => { b.style.background = '#eef2ff'; b.style.borderColor = '#c7d2fe'; });
            b.addEventListener('mouseleave', () => { b.style.background = '#f6f7f9'; b.style.borderColor = '#d7d2d7'; });

            b.addEventListener('pointerdown', async (ev) => {
                ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();
                ST._insidePickerClick = true; queueMicrotask(()=>{ ST._insidePickerClick = false; });

                ensurePickHosts();
                await setComboValue(ST.tipoHost, entry.tipo);
                setTimeout(async () => {
                    await setComboValue(ST.subtipoHost, entry.subtipo);

                    ST.nameHost = findHostByLabel(NAME_LABEL_RX, ['lightning-input']) || ST.nameHost;
                    if (ST.nameHost) {
                        ST.lockNameOnce = true;
                        writeHostValue(ST.nameHost, entry.write);
                        ST.lastTextName = entry.write;
                        ST.lastNameKey = entry.key;
                    }
                    ST.canAutofill = true;
                    requestApplyComm();
                    destroyPicker();
                }, 180);
            });
            return b;
        }

        function mkUniversalPartBtn(){
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = 'PART';
            Object.assign(b.style, {
                fontSize:'12px', padding:'8px 10px', borderRadius:'8px',
                border:'1px solid #d7d2d7', background:'#f6f7f9',
                cursor:'pointer', textAlign:'left', width:'100%'
            });

            b.addEventListener('mouseenter', () => { b.style.background = '#eef2ff'; b.style.borderColor = '#c7d2fe'; });
            b.addEventListener('mouseleave', () => { b.style.background = '#f6f7f9'; b.style.borderColor = '#d7d2d7'; });

            b.addEventListener('pointerdown', async (ev) => {
                ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();
                ST._insidePickerClick = true; queueMicrotask(()=>{ ST._insidePickerClick = false; });

                try {
                    const labelMap = {
                        'PART_Acciones': 'PART - Pendiente acciones cliente',
                        'PART_Permisos':  'PART - Pendiente de permisos',
                    };

                    const variants = [];
                    for (const g of (PART_GROUPS || [])) {
                        for (const v of (g.variants || [])) {
                            variants.push({
                                ...v,
                                label: labelMap[v.key] || v.label || 'PART',
                                _target: { tipo: g.tipo, subtipo: g.subtipo }
                            });
                        }
                    }
                    if (!variants.length) { destroyPicker(); return; }

                    if (ST.nameHost) writeHostValue(ST.nameHost, '');
                    await resetFieldsDeferred(2);
                    const choice = await showChoiceModal('Seleccione Pre-requisito (PART)', variants);
                    if (!choice) { destroyPicker(); return; }

                    ST.preNameOverride = { write: 'PART', key: choice.key };
                    ST.lockNameOnce = true;
                    ST.lastTextName = 'PART';
                    ST.lastNameKey = choice.key;

                    ensurePickHosts();
                    await setComboValue(ST.tipoHost, choice._target.tipo);
                    setTimeout(async () => {
                        await setComboValue(ST.subtipoHost, choice._target.subtipo);

                        ST.nameHost = findHostByLabel(NAME_LABEL_RX, ['lightning-input']) || ST.nameHost;
                        if (ST.nameHost) writeHostValue(ST.nameHost, 'PART');
                        ST.canAutofill = true;
                        requestApplyComm();
                        destroyPicker();
                    }, 180);
                } catch (err) {
                    console.error('[PART] click error:', err);
                    destroyPicker();
                }
            });
            return b;
        }

        function mkUniversalEstudiBtn(){
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = 'ESTUDI';
            Object.assign(b.style, {
                fontSize:'12px', padding:'8px 10px', borderRadius:'8px',
                border:'1px solid #d7d2d7', background:'#f6f7f9',
                cursor:'pointer', textAlign:'left', width:'100%'
            });
            b.addEventListener('mouseenter', () => { b.style.background = '#eef2ff'; b.style.borderColor = '#c7d2fe'; });
            b.addEventListener('mouseleave', () => { b.style.background = '#f6f7f9'; b.style.borderColor = '#d7d2d7'; });

            b.addEventListener('pointerdown', async (ev) => {
                ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();
                ST._insidePickerClick = true; queueMicrotask(()=>{ ST._insidePickerClick = false; });

                const v = await pickEstudiVariant();
                if (!v) { destroyPicker(); return; }

                ST.preNameOverride = { write: v.write, key: v.key };
                ST.lockNameOnce = true;
                ST.lastTextName = v.write;
                ST.lastNameKey = v.key;

                ensurePickHosts();
                await setComboValue(ST.tipoHost, ESTUDI_TARGET.tipo);
                setTimeout(async () => {
                    await setComboValue(ST.subtipoHost, ESTUDI_TARGET.subtipo);

                    ST.nameHost = findHostByLabel(NAME_LABEL_RX, ['lightning-input']) || ST.nameHost;
                    if (ST.nameHost) writeHostValue(ST.nameHost, v.write);
                    ST.canAutofill = true;
                    requestApplyComm();
                    destroyPicker();
                }, 180);
            });
            return b;
        }

        let entries = NAME_CATALOG
        .filter(e => e && e.label && e.label.trim() !== '')
        .filter(e => String(e.write).trim().toUpperCase() !== 'PART')
        .filter(e => String(e.label).trim().toUpperCase() !== 'ESTUDI' &&
                String(e.write).trim().toUpperCase() !== 'ESTUDI');

        entries.push({ label: 'PART', __isPartUniversal:   true });
        entries.push({ label: 'ESTUDI', __isEstudiUniversal: true });

        entries.sort((a, b) => a.label.localeCompare(b.label, 'es'));

        for (const entry of entries) {
            if (entry.__isPartUniversal) list.appendChild(mkUniversalPartBtn());
            else if (entry.__isEstudiUniversal) list.appendChild(mkUniversalEstudiBtn());
            else list.appendChild(mkBtn(entry));
        }

        wrap.appendChild(label);
        wrap.appendChild(list);
        document.body.appendChild(wrap);
        ST.pickerEl = wrap;
        positionPickerNear(ST.nameHost, wrap);

        const onDocDown = (e) => {
            if (ST._insidePickerClick) return;

            const wrap = document.getElementById('__af_name_picker_ephemeral__');
            wrap.addEventListener('mousedown', () => {
                ST._insidePickerClick = true;
                queueMicrotask(() => { ST._insidePickerClick = false; });
            }, true);

            wrap.addEventListener('pointerdown', () => {
                ST._insidePickerClick = true;
                queueMicrotask(() => { ST._insidePickerClick = false; });
            }, true);

            if (!wrap) return;

            // 1) Ignorar clicks en las barras de scroll del navegador
            const onViewportScrollbar =
                  (e.target === document.documentElement || e.target === document.body) &&
                  (e.clientX >= window.innerWidth - 18 || e.clientY >= window.innerHeight - 18);
            if (onViewportScrollbar) return;

            // 2) Considerar "dentro" si el target está contenido en el panel
            const insidePanel = wrap.contains(e.target);

            // 3) Considerar "dentro" si el click parte del input de Nombre
            const insideNameHost = !!(ST.nameHost && ST.nameHost.contains && ST.nameHost.contains(e.target));

            if (!insidePanel && !insideNameHost) {
                destroyPicker();
                document.removeEventListener('mousedown', onDocDown, true);
                document.removeEventListener('keydown', onKey, true);
            }
        };

        const onKey = (e) => { if (e.key === 'Escape') onDocDown(e); };
        document.addEventListener('mousedown', onDocDown, true);
        document.addEventListener('keydown', onKey, true);
    }

    let EXEC_TOKEN = 0;
    const nextToken = () => (++EXEC_TOKEN);
    const applyName = (() => {
        let t=null;
        return async () => {
            if (ST.mode !== 'new') return;

            if (ST.modalOpen || ST.choosing) return;
            if (!ST.canAutofill && !ST.lockNameOnce && !ST.preNameOverride) return;
            if (!ST.subtipo) return;
            clearTimeout(t);
            t = setTimeout(async () => {
                if (ST.modalOpen || ST.choosing) return; // 先 guard
                const token = nextToken(); // 再递增

                const key = `${ST.tipo ?? ''}/${ST.subtipo ?? ''}`;
                if (ST.lastKeyName === key && ST.lastTextName != null && ST._lastHadRule === true) return;
                const rule = NAME_RULES[key];
                ST.nameHost = ST.nameHost || findHostByLabel(NAME_LABEL_RX, ['lightning-input']);
                if (ST.preNameOverride) {
                    const picked = ST.preNameOverride;
                    ST.preNameOverride = null;
                    ST.nameHost = ST.nameHost || findHostByLabel(NAME_LABEL_RX, ['lightning-input']);
                    if (ST.nameHost) {
                        writeHostValue(ST.nameHost, picked.write || '');
                        ST.lastTextName = picked.write || '';
                        ST.lastNameKey = picked.key || (picked.write || '');
                    }
                    ST.lastKeyName = key;
                    requestApplyComm();
                    return;
                }

                if (rule === undefined) {
                    if (ST.lastTextName && ST.lastTextName !== '') {
                        if (writeHostValue(ST.nameHost, '')) ST.lastTextName = '';
                    }
                    ST.lastKeyName = key;
                    ST._lastHadRule = false;

                    const k = key;
                    if (ST.tipo && ST.subtipo && ST.noProcShownKey !== k) {
                        ST.noProcShownKey = k;
                        const msg = `No procede el prerrequisito con el TIPO y SUBTIPO seleccionados.`;
                        await resetFields(3);
                        await showNoticeModal(msg);
                    }
                    return;
                }

                if (ST.lockNameOnce) {
                    ST.lockNameOnce = false;
                    ST.lastKeyName = key;
                    requestApplyComm();
                    return;
                }

                const picked = await chooseFromRule(key, rule);
                if (token !== EXEC_TOKEN) return; // descarta resultados obsoletos
                if (picked === null) return;
                const writeText = picked.write ?? picked.label ?? '';
                if (writeHostValue(ST.nameHost, writeText)) {
                    ST.lastTextName = writeText;
                    ST.lastNameKey = picked.key ?? writeText;
                    ST._lastHadRule = true;
                }
                ST.lastKeyName = key;
                requestApplyComm();
            }, 120);
        };
    })();

    const applyComm = (() => {
        let t=null;
        return async () => {
            if (ST.mode !== 'new') return;

            if (ST.modalOpen || ST.choosing) return;
            if (!ST.canAutofill && !ST.lockNameOnce && !ST.preNameOverride) return;
            clearTimeout(t);
            t = setTimeout(async () => {
                if (ST.modalOpen || ST.choosing) return; // 先 guard
                const token = nextToken(); // 再递增

                const key2 = `${ST.tipo ?? ''}/${ST.subtipo ?? ''}`;
                const nombreKey = ST.lastNameKey || ST.lastTextName || '';
                const key3 = buildKey3(ST.tipo, ST.subtipo, nombreKey);
                const rule3 = COMM_RULES_3[key3];
                const rule2 = COMM_RULES_2[key2];
                const rule = (rule3 !== undefined) ? rule3 : rule2;

                ST.commHost = ST.commHost || findHostByLabel(COMM_LABEL_RX, ['lightning-textarea','lightning-input-rich-text']);
                if (!ST.commHost) return;

                if (rule === undefined) {
                    if (ST.lastTextComm && ST.lastTextComm !== '') {
                        if (writeHostValue(ST.commHost, '')) ST.lastTextComm='';
                    }
                    ST.lastKeyComm = (rule3 !== undefined) ? key3 : key2;
                    return;
                }

                const picked = await chooseFromRule((rule3 !== undefined) ? key3 : key2, rule);
                if (token !== EXEC_TOKEN) return; // descarta resultados obsoletos
                if (picked === null) return;

                const writeText = (typeof picked === 'object') ? (picked.write ?? picked.label ?? '') : picked;
                if (writeHostValue(ST.commHost, writeText)) ST.lastTextComm = writeText;
                ST.lastKeyComm = (rule3 !== undefined) ? key3 : key2;
            }, 140);
        };
    })();

    function onFocusIn(e){
        if (ST.mode !== 'new') return;
        const path = e.composedPath?.() || [];
        const tag = n => n && n.tagName;
        const inputHost = path.find(n => tag(n)==='LIGHTNING-INPUT');
        const areaHost = path.find(n => tag(n)==='LIGHTNING-TEXTAREA' || tag(n)==='LIGHTNING-INPUT-RICH-TEXT');

        if (inputHost) {
            const label = inputHost.label || inputHost.getAttribute?.('label') || '';
            if (NAME_LABEL_RX.test(label) && !ST.nameHost) {
                ST.nameHost = inputHost;
            }
        }
        if (areaHost) {
            const label = areaHost.label || areaHost.getAttribute?.('label') || '';
            if (COMM_LABEL_RX.test(label) && !ST.commHost) {
                ST.commHost = areaHost;
                requestApplyComm();
            }
        }
    }

    document.addEventListener('click', (e) => {
        const path = e.composedPath?.() || [];
        if (path.some(n => n && n.id === '__af_name_picker_ephemeral__')) return;

        // NO abrir el picker si no estamos en "nuevo"
        if (ST.mode !== 'new') return;

        const hit = path.find(n => n && n.tagName === 'LIGHTNING-INPUT');
        const lab = hit ? (hit.label || hit.getAttribute?.('label') || '') : '';
        if (hit && NAME_LABEL_RX.test(lab)) {
            ST.nameHost = hit;
            openNamePickerOnDemand();
        }
    }, true);

    document.addEventListener('pointerdown', (e) => {
        if (ST.mode !== 'new') return;
        const path = e.composedPath?.() || [];
        const combo = path.find(n => n && n.tagName === 'LIGHTNING-COMBOBOX');
        if (!combo) return;
        const label = combo.label || combo.getAttribute?.('label') || '';
        if (label === 'Subtipo') {
            ST._subtipoListOpen = true;
            clearTimeout(ST._subtipoListTimer);
            ST._subtipoListTimer = setTimeout(() => { ST._subtipoListOpen = false; }, 2000);
        }
    }, true);

    document.addEventListener('click', async (e) => {
        if (ST.mode !== 'new') return;
        if (!ST._subtipoListOpen) return;

        const path = e.composedPath?.() || [];
        let opt = null;
        for (const n of path) {
            if (!n || !n.getAttribute) continue;
            if (n.getAttribute('role') === 'option' || n.classList?.contains?.('slds-listbox__option')) {
                opt = n; break;
            }
            const li = n.closest?.('li.slds-listbox__item');
            if (li) { opt = li; break; }
        }
        if (!opt) return;

        const picked = (opt.getAttribute('data-value') || opt.dataset?.value || (opt.textContent || '')).trim();
        if (!picked) return;

        const currentSub = (ST.subtipo || '').trim();
        if (picked.toLowerCase() !== currentSub.toLowerCase()) {
            ST._subtipoListOpen = false;
            return;
        }

        const key = buildKey2(ST.tipo, ST.subtipo);
        const rule = NAME_RULES[key];
        const isMulti = Array.isArray(rule);

        if (rule === undefined) {
            ST._subtipoListOpen = false;
            await resetFields(3);
            await showNoticeModal('No procede el prerrequisito con el TIPO y SUBTIPO seleccionados.');
            return;
        }

        if (!isMulti) {
            ST._subtipoListOpen = false;
            return;
        }
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        ST._subtipoListOpen = false;
        await resetFieldsDeferred(2);
        const choice = await showChoiceModal('Seleccione Pre-requisito', rule);

        // —— ★ 新增：03/07 的 ESTUDI 需要二级弹窗 —— //
        const keyNow = `${ST.tipo ?? ''}/${ST.subtipo ?? ''}`;
        const pickedLabel = (typeof choice === 'object'
                             ? (choice.label ?? choice.write ?? '')
                             : String(choice)).trim().toUpperCase();

        if (keyNow === '03/07' && pickedLabel === 'ESTUDI') {
            const v = await pickEstudiVariant(); // 打开二级弹窗
            if (!v) return; // 取消就退出
            // 用二级选择的结果覆盖
            const finalWrite = v.write ?? v.label ?? '';
            const finalKey = v.key ?? finalWrite;

            if (ST.nameHost) writeHostValue(ST.nameHost, finalWrite);
            ST.lastTextName = finalWrite;
            ST.lastNameKey = finalKey;
            ST.canAutofill = true;
            requestApplyComm();
            return; // 二级路径到此结束，避免继续走一级写入
        }

        if (choice == null) return;
        const writeText = (typeof choice === 'object') ? (choice.write ?? choice.label ?? '') : choice;
        const nameKey = (typeof choice === 'object') ? (choice.key ?? writeText) : writeText;
        if (ST.nameHost) writeHostValue(ST.nameHost, writeText);
        ST.lastTextName = writeText;
        ST.lastNameKey = nameKey;
        requestApplyComm();
    }, true);

    async function onPickChange(e){
        if (ST.mode !== 'new') return;
        const path = e.composedPath?.() || [];
        const host = path.find(n => n && n.tagName === 'LIGHTNING-COMBOBOX');
        if (!host) return;

        const label = host.label || host.getAttribute?.('label') || '';
        const val = ('value' in host) ? host.value : null;
        if (val == null) return;

        if (label === 'Tipo') {
            ST.tipo = val;
            ST.canAutofill = true;
            await resetFields(3);
            return;
        }

        if (label === 'Subtipo') {
            ST.subtipo = val;
            ST._lastHadRule = null;
            ST.noProcShownKey = null;
            ST.canAutofill = true;
            applyName();
            requestApplyComm();
        }
    }

    function resetFormState() {
        ST.tipo = null;
        ST.subtipo = null;
        ST.lastKeyName = null;
        ST.lastTextName = null;
        ST.lastKeyComm = null;
        ST.lastTextComm = null;
        ST.nameHost = null;
        ST.commHost = null;
        ST.tipoHost = null;
        ST.subtipoHost = null;
        ST.modalOpen = false;
        ST.choosing = false;
        ST.lockNameOnce = false;
        ST._lastHadRule = null;
        ST.noProcShownKey = null;
        ST.pickerEl = null; // por si acaso que actica choicemodal en otro sitio
        destroyPicker();
        document.getElementById('__af_modal_root__')?.remove();
    }

    function install() {
        document.addEventListener('focusin', onFocusIn, true);
        document.addEventListener('change', onPickChange, true);
    }

    (function monitorNewPrereqPage(){
        let lastUrl = location.href;
        const CHECK_INTERVAL = 800;

        setInterval(() => {
            const href = location.href;
            if (href !== lastUrl) {
                lastUrl = href;

                // 1) Limpia solo estado interno (NO borra campos del form)
                resetFormState();

                // 2) Modo por URL
                if (RX_NEW.test(href) || RX_CREATE.test(href)) ST.mode = 'new';
                else if (RX_EDIT.test(href)) ST.mode = 'edit';
                else if (RX_VIEW.test(href)) ST.mode = 'view';
                else ST.mode = 'view';

                // 3) Localiza hosts y decide si autocompletar
                setTimeout(() => {
                    //ST.nameHost = ST.nameHost || findHostByLabel(NAME_LABEL_RX, ['lightning-input','lightning-input-field']);
                    //ST.commHost = ST.commHost || findHostByLabel(COMM_LABEL_RX, ['lightning-textarea','lightning-input-rich-text','lightning-input-field']);

                    //const nameVal = (ST.nameHost && 'value' in ST.nameHost) ? (ST.nameHost.value || '').trim() : '';
                    //const commVal = (ST.commHost && 'value' in ST.commHost) ? (ST.commHost.value || '').trim() : '';

                    // Política: en "nuevo" siempre; en "editar" solo si ambos están vacíos
                    //if (ST.mode === 'new') {
                    //    ST.canAutofill = true;
                    //} else if (ST.mode === 'edit') {
                    //    ST.canAutofill = (nameVal === '' && commVal === '');
                    //} else {
                    //    ST.canAutofill = false;
                    //}

                    // 4) Si procede, dispara cálculos (sin limpiar campos)
                    //if (ST.canAutofill) {
                    //    applyName();
                    //    requestApplyComm();
                    //}

                    if (ST.mode !== 'new') { ST.canAutofill = false; return; }
                    ST.nameHost = ST.nameHost || findHostByLabel(NAME_LABEL_RX, ['lightning-input','lightning-input-field']);
                    ST.commHost = ST.commHost || findHostByLabel(COMM_LABEL_RX, ['lightning-textarea','lightning-input-rich-text','lightning-input-field']);
                    ST.canAutofill = true;
                    applyName();
                    requestApplyComm();
                }, 400);
            }
        }, CHECK_INTERVAL);

    })();

    if (document.readyState === 'complete' || document.readyState === 'interactive') install();
    else document.addEventListener('DOMContentLoaded', install, { once:true });
})();
