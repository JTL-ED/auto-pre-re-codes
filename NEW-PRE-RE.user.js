// ==UserScript==
// @name         NEW-Pre-requisito
// @namespace    https://your-space.example
// @version      1.3.0
// @description  solucionar modal ventana
// @match        https://*.lightning.force.com/*
// @match        https://*.salesforce.com/*
// @author       Jiatai + Carles + GPT
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function() {
    /***  Configuración: definir las reglas reales según los códigos de valor  ***/
    const MODAL_WHITELIST = new Set(['01/01', '01/07','03/07']);

    const NAME_RULES = {
        '01/01': [{label: 'PART', write: 'PART', key: 'PART_Acciones' }, 'REQ ORG CLIENT'],
        //'01/02': '',
        //'01/03': '',
        '01/04': 'CES OC',
        '01/06': 'IE',
        '01/07': ['FASE OBRA', 'ANULAR', 'PTE ACT CLIENT'],
        '01/19': 'CES',
        //'01/17': '',
        '01/18': 'OBRA CIVIL',
        '01/20': 'AJUSTAT',
        '01/21': 'ACTA',
        '02/08': 'ESCREIX',
        '03/09': 'CP2',
        //'03/10': '',
        '03/11': {label: 'PART', write: 'PART', key: 'PART_Permiso' },
        //'03/12': '',
        '03/13': 'PER',
        '03/14': 'APS',
        '03/07': ['OBRA BACKLOG', 'CP1', 'SUPEDITAT', 'CIVICOS', 'ESTUDI', 'AGP', 'CTR', 'FASES', 'TRAÇAT', 'CE'],
    };

    const COMM_RULES_3 = {
        '01/01/PART_Acciones': 'Pendiente aportación de los permisos de terceros afectados para la realización de los trabajos.',
        '01/01/REQ ORG CLIENT': 'Pendiente aportación de la documentación requerida por los Organismos Oficiales en el proceso de tramitación de permisos.',
        '01/07/FASE OBRA': '',
        '01/07/ANULAR': 'Pendiente aportación carta de anulación, justificante de pago y certificado de titularidad bancaria.',
        '01/07/PTE ACT CLIENT': 'Temporalmente, la gestión del expediente queda suspendida a la espera de la aportación por su parte de los documentos que se le han requerido.',

    };

    const COMM_RULES_2 = {
        '01/04': 'En breve les serán requeridos los documentos necesarios para realizar la cesión del CT/CM.',
        '01/06': 'Pendiente instalacion de la Caja General de Protección/Caja de Protección y Medida.',
        '01/08': 'Pendiente de pago del sobrecoste  indicado en las condiciones - técnico econòmicas remitidas.',
        '01/18': 'Pendiente recibir información del espacio reservado para ubicar el CT/CM.',
        '01/19': 'En breve les serán requeridos los documentos necesarios para la cesión de las instalaciones.',
        '01/20': 'Pendiente recibir proyecto eléctrico para revisión.',
        '01/21': 'Una vez validado el proyecto eléctrico, tendrá que aportar permisos y autorizaciones concedidas, y cronograma de ejecución de obra para programar Acta de Lanzamiento.',

        '02/08': 'Pendiente de pago del sobrecoste  indicado en las condiciones - técnico econòmicas remitidas.',
    };

    // —— Etiquetas ——
    const NAME_LABEL_RX = /Nombre del Pre-?requisito/i;
    const COMM_LABEL_RX = /Comunicaci[oó]n al cliente\s*\(push\)/i;

    /***  Estado  ***/
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
        // picker flotante efímero
        pickerEl: null,
        _insidePickerClick: false,
        lockNameOnce: false,
        lastNameKey: null, //  COMM_RULES_3 
        preNameOverride: null, // remplazar applyName input（{write, key}）
        noProcShownKey: null, // memorizar `${tipo}/${subtipo}` combo

    };

    // —— ESTUDI - Tipo/Subtipo + variable —— //
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

    // ESTUDI modal 2n nivel（ORDEN ABC）
    async function pickEstudiVariant() {
        const sorted = [...ESTUDI_VARIANTS].sort((a,b) => (a.label||'').localeCompare(b.label||'', 'es', {sensitivity:'base'}));
        return await showChoiceModal('Seleccione Pre-requisito (ESTUDI)', sorted);
    }

    /* ==== walkDeep：profundidad limitada / Nodos limitados，Evitar que la página se quede bloqueada ==== */
    function* walkDeep(root, opts = {}) {
        const MAX_NODES = opts.maxNodes ?? 2000; // El número máximo de nodos a atravesar a la vez (se puede ajustar según sea necesario)
        const MAX_DEPTH = opts.maxDepth ?? 4; // Nivel máximo de profundidad de sombra/subárbol
        let seen = 0;
        const stack = [{ node: root, depth: 0 }];

        while (stack.length) {
            const { node, depth } = stack.pop();
            if (!node) continue;
            yield node;
            if (++seen >= MAX_NODES) break; // Detenerse inmediatamente si se excede el límite
            if (depth >= MAX_DEPTH) continue;

            // Entrar shadowRoot
            if (node.shadowRoot) stack.push({ node: node.shadowRoot, depth: depth + 1 });

            // Introducir elementos secundarios
            if (node.children && node.children.length) {
                for (let i = node.children.length - 1; i >= 0; i--) {
                    stack.push({ node: node.children[i], depth: depth + 1 });
                }
            }

            // Document / ShadowRoot 的 children
            if (node instanceof Document || node instanceof ShadowRoot) {
                const kids = node.children || node.childNodes || [];
                for (let i = kids.length - 1; i >= 0; i--) {
                    stack.push({ node: kids[i], depth: depth + 1 });
                }
            }

            // iframe del mismo origen
            const tag = node.tagName;
            if (tag === 'IFRAME' || tag === 'FRAME') {
                try {
                    if (node.contentDocument) {
                        stack.push({ node: node.contentDocument, depth: depth + 1 });
                    }
                } catch (_) {  } /* Ignorar entre dominios */
            }
        }
    }

    /* ==== Primero findHostByLabel ligero: primero la ruta rápida, luego una reserva de profundidad limitada y caché ==== */
    const __FH_CACHE__ = new Map(); // key: rx.toString() + '|' + tags.join(',')

    function findHostByLabel(rx, tags){
        const key = rx.toString() + '|' + tags.join(',');
        const cached = __FH_CACHE__.get(key);
        if (cached && document.contains(cached)) return cached;

        // 1) Ruta rápida: buscar solo en documentos de nivel superior
        const fast = document.querySelectorAll(tags.join(','));
        for (const el of fast) {
            const lab = (el.label || el.getAttribute?.('label') || '').trim();
            if (rx.test(lab)) { __FH_CACHE__.set(key, el); return el; }
        }

        // 2) Respaldo: escaneo profundo/de profundidad limitada de nodos (use la limitación walkDeep mencionada anteriormente)
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

            // Notificar a Lightning que el valor cambió
            try {
                host.dispatchEvent(new InputEvent('input', { bubbles:true, composed:true }));
            } catch(_) {
                host.dispatchEvent(new Event('input', { bubbles:true, composed:true }));
            }
            host.dispatchEvent(new CustomEvent('change', { detail:{ value:text }, bubbles:true, composed:true }));
            host.dispatchEvent(new Event('blur', { bubbles:true, composed:true }));
            return true;
        }catch(e){
            console.warn('Error al escribir:', e);
            return false;
        }
    }




    function showChoiceModal(title, choices) {
        if (ST.modalOpen || ST.choosing) return Promise.resolve(null);
        ST.modalOpen = true; ST.choosing = true;

        //Puedes mantener tu clasificación actual
        choices = [...choices].sort((a,b) => {
            const n = x => (typeof x === 'object' ? (x.label ?? x.write ?? '') : String(x)).trim();
            return n(a).localeCompare(n(b), 'es', {sensitivity:'base'});
        });

        // —— Clave: Determina dinámicamente el número de columnas según el número de opciones (hasta 3 columnas) —— //
        const MAX_COLS = 3;
        const BTN_MIN_W = 110; // Ancho mínimo de cada botón (ajustable)
        const GAP = 10; //Espaciado entre botones (ajustable)
        const cols = Math.min(MAX_COLS, Math.max(1, choices.length));

        return new Promise(resolve => {
            const root = document.createElement('div');
            root.id = '__af_modal_root__';
            root.innerHTML = `
      <div class="af-backdrop"></div>
      <div class="af-modal" role="dialog" aria-modal="true" aria-label="${title}">
        <div class="af-header">${title}</div>
        <div class="af-body">
          ${choices.map((c,i)=>{
                const lbl = (typeof c === 'object') ? c.label : c;
                return `<button class="af-option" data-idx="${i}" type="button" title="${lbl}">${lbl}</button>`;
            }).join('')}
        </div>
        <div class="af-actions"><button class="af-cancel" type="button">Cancelar</button></div>
      </div>`;

            const style = document.createElement('style');
            style.textContent = `
      #__af_modal_root__{position:fixed;inset:0;z-index:999999;font-family:system-ui,Segoe UI,Arial,Helvetica,sans-serif}
      #__af_modal_root__ .af-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.35)}
      #__af_modal_root__ .af-modal{
        position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
        background:#fff;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.3);
        padding:16px;display:flex;flex-direction:column;gap:12px;
        /* Adaptar al ancho máximo en función del número de columnas: ancho del botón * número de columnas + espaciado + relleno */
        width:fit-content;max-width:90vw;min-width:360px;
      }
      #__af_modal_root__ .af-header{font-weight:600;font-size:16px}
      #__af_modal_root__ .af-body{
        display:grid;
        grid-template-columns: repeat(${cols}, minmax(${BTN_MIN_W}px, 1fr));
        gap:${GAP}px; align-items:stretch;
      }
      #__af_modal_root__ .af-option{
        min-height:40px; padding:10px 12px; border-radius:10px;
        border:1px solid #e3e3e3; background:#f6f7f9; cursor:pointer;
        width:100%;
        /* Varias líneas son adaptativas y centradas */
        display:flex; align-items:center; justify-content:center; text-align:center;
        white-space:normal; word-break:break-word; overflow:visible;
      }
      #__af_modal_root__ .af-option:hover{background:#eef2ff;border-color:#c7d2fe}
      #__af_modal_root__ .af-actions{display:flex;justify-content:flex-end}
      #__af_modal_root__ .af-cancel{padding:8px 12px;border-radius:8px;border:1px solid #ddd;background:#fff;cursor:pointer}
      #__af_modal_root__ .af-cancel:hover{background:#f7f7f7}
    `;
            document.body.appendChild(style);
            document.body.appendChild(root);

            const cleanup=()=>{ root.remove(); style.remove(); ST.modalOpen=false; ST.choosing=false; };
            root.querySelectorAll('.af-option').forEach((btn, i)=>{
                btn.addEventListener('click',()=>{ const choice = choices[i]; cleanup(); resolve(choice ?? null); });
            });
            root.querySelector('.af-cancel').addEventListener('click',()=>{ cleanup(); resolve(null); });
            root.querySelector('.af-backdrop').addEventListener('click', ()=>{ cleanup(); resolve(null); });
            const onKey=e=>{ if(e.key==='Escape'){ document.removeEventListener('keydown',onKey); cleanup(); resolve(null); } };
            document.addEventListener('keydown', onKey, { once:true });
        });
    }

    function showNoticeModal(message){
        if (ST.modalOpen || ST.choosing) return Promise.resolve(); // Evita conflictos con otras ventanas emergentes
        ST.modalOpen = true; ST.choosing = true;

        return new Promise(resolve => {
            const root = document.createElement('div');
            root.id = '__af_notice_root__';
            root.innerHTML = `
      <div class="af-backdrop"></div>
      <div class="af-modal" role="dialog" aria-modal="true" aria-label="Aviso">
        <div class="af-header">Aviso</div>
        <div class="af-body"><div class="af-msg" style="padding:6px 2px;">${message}</div></div>
        <div class="af-actions"><button class="af-ok" type="button">Aceptar</button></div>
      </div>`;

            const style = document.createElement('style');
            style.textContent = `
      #__af_notice_root__{position:fixed;inset:0;z-index:999999;font-family:system-ui,Segoe UI,Arial,Helvetica,sans-serif}
      #__af_notice_root__ .af-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.35)}
      #__af_notice_root__ .af-modal{
        position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
        background:#fff;border-radius:12px;min-width:360px;max-width:560px;
        box-shadow:0 20px 60px rgba(0,0,0,.3);
        padding:16px;display:flex;flex-direction:column;gap:12px
      }
      #__af_notice_root__ .af-header{font-weight:600;font-size:16px}
      #__af_notice_root__ .af-actions{display:flex;justify-content:flex-end}
      #__af_notice_root__ .af-ok{padding:8px 12px;border-radius:8px;border:1px solid #ddd;background:#fff;cursor:pointer}
      #__af_notice_root__ .af-ok:hover{background:#f7f7f7}
    `;
            document.body.appendChild(style);
            document.body.appendChild(root);
            
            const cleanup=()=>{ root.remove(); style.remove(); ST.modalOpen=false; ST.choosing=false; resolve(); };
            root.querySelector('.af-ok').addEventListener('click', cleanup);
            root.querySelector('.af-backdrop').addEventListener('click', cleanup);
            const onKey=e=>{ if(e.key==='Escape'){ document.removeEventListener('keydown',onKey); cleanup(); } };
            document.addEventListener('keydown', onKey, { once:true });
        });
    }

    async function resolveRuleValueUI(key, rule){
        // Matriz: puede ser una mezcla de cadenas u objetos
        if (Array.isArray(rule)) {
            if (!MODAL_WHITELIST.has(key)) {
                const first = rule[0];
                return (typeof first === 'object') ? first : { label:first, write:first, key:first };
            }
            if (ST.modalOpen || ST.choosing) return null;
            // —— Ordenar alfabéticamente (ignorando mayúsculas y minúsculas y acentos) —— //
            const toLabel = (x) => (typeof x === 'object' ? (x.label ?? x.write ?? '') : String(x)).trim();
            const sortedRule = [...rule].sort((a, b) => toLabel(a).localeCompare(toLabel(b), 'es', { sensitivity: 'base' }));

            const picked = await showChoiceModal(`Seleccione Pre-requisito`, sortedRule);
            if (!picked) return null; // Predicción

            // Si es 03/07 y el usuario selecciona ESTUDI, entonces pasa a la ventana emergente secundaria ESTUDI
            if (key === '03/07') {
                const getLabel = (x) => (typeof x === 'object' ? (x.label ?? x.write ?? '') : String(x)).trim().toUpperCase();
                if (getLabel(picked) === 'ESTUDI') {
                    const v = await pickEstudiVariant();
                    if (!v) return null;
                    return v; // {label, write:'ESTUDI - XXX', key:'ESTUDI_XXX'}
                }
            }
            return (typeof picked === 'object') ? picked : { label:picked, write:picked, key:picked };
        }
        // Valor único: puede ser una cadena o un objeto
        if (rule && typeof rule === 'object') return rule;
        return { label: rule ?? '', write: rule ?? '', key: rule ?? '' };
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
        // Ordenación opcional
        out.sort((a,b)=> a.label.localeCompare(b.label,'es'));
        return out;
    }
    const NAME_CATALOG = buildNameCatalog(NAME_RULES);

    // -- Agrega todos los elementos en NAME_RULES donde escribe === 'PART' por (tipo/subtipo) --
    function computePartGroups(rules){
        const groups = new Map(); // key: "tipo/subtipo" -> { tipo, subtipo, variants:[] }
        for (const key of Object.keys(rules)) {
            const [tipo, subtipo] = key.split('/');
            const val = rules[key];
            const push = (x) => {
                if (!x) return;
                const label = (typeof x==='object') ? (x.label ?? x.write ?? '') : x;
                const write = (typeof x==='object') ? (x.write ?? x.label ?? '') : x;
                const k = (typeof x==='object') ? (x.key ?? write) : write;
                // Solo importan las entradas donde se escribe === 'PART' (por ejemplo, PART-Acciones / PART-Permiso)
                if (String(write).trim().toUpperCase() !== 'PART') return;
                const gk = `${tipo}/${subtipo}`;
                if (!groups.has(gk)) groups.set(gk, { tipo, subtipo, variants: [] });
                groups.get(gk).variants.push({ label, write:'PART', key:k, tipo, subtipo });
            };
            Array.isArray(val) ? val.forEach(push) : push(val);
        }
        // Mantener únicamente grupos con variantes de 1 o más PARTES
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

    /***  Picker flotante efímero: solo al hacer clic en el campo  ***/
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
        let top = Math.max(8, r.top); // alineado arriba del input
        wrap.style.left = left + 'px';
        wrap.style.top = top + 'px';
    }

    function openNamePickerOnDemand(){
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
            width:'auto', // ← auto
            //maxWidth:'min(500px, 90vw)' // ←max 520px screen max 90%
        });

        const label = document.createElement('div');
        label.innerHTML = 'Selección&nbsp;del<br>Pre-requisito:'; // ← “Selección del” inseparable
        Object.assign(label.style, {
            fontSize: '12px',
            lineHeight: '1.25',
            fontWeight: '600',
            whiteSpace: 'normal', // respeta el <br>
            wordBreak: 'keep-all', // no cortes palabras
            overflowWrap: 'normal',
            flex: '0 0 auto', // no se comprime en el flex
            minWidth: 'max-content', // ancho suficiente para “Selección del”
            padding: '4px 2px',
            marginRight: '8px'
        });

        //Object.assign(label.style, { fontSize:'12px', lineHeight:'1.2', whiteSpace:'nowrap', padding:'4px 2px' });
        const list = document.createElement('div');
        Object.assign(list.style, {
            display:'grid',
            gridTemplateColumns:'repeat(2, minmax(100px, 1fr))', // ← 2 colum；min 160px,width
            gap:'6px',
            maxHeight:'min(60vh, 394px)', // ← no bigger than 60% or 360px para ajustar la ventana flotante de nombre del prerequisito.
            overflow:'auto',
            width:'100%' // ← width
        });

        //Se utiliza para crear ventanas flotantes.
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
                        ST.lastNameKey = entry.key; // COMM_RULES_3
                    }
                    applyComm();
                    destroyPicker();
                }, 180);
            });
            return b;
        }

        // —— Botón único "PART": reproduce directamente Acciones / Permisos —— //
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
                    // Recopilar variantes de PART (de todos los grupos) y anular el texto mostrado
                    const labelMap = {
                        'PART_Acciones': 'PART - Pendiente acciones cliente',
                        'PART_Permiso':  'PART - Pendiente de permisos',
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

                    // Mostrar solo variantes de PART
                    const choice = await showChoiceModal('Seleccione Pre-requisito (PART)', variants);
                    if (!choice) { destroyPicker(); return; }

                    // Dígale a applyName: No vuelva a mostrar la ventana emergente esta vez
                    ST.preNameOverride = { write: 'PART', key: choice.key };
                    ST.lockNameOnce = true;
                    ST.lastTextName = 'PART';
                    ST.lastNameKey = choice.key;

                    // Establecer Tipo/Subtipo del grupo correspondiente
                    ensurePickHosts();
                    await setComboValue(ST.tipoHost, choice._target.tipo);
                    setTimeout(async () => {
                        await setComboValue(ST.subtipoHost, choice._target.subtipo);

                        // Introducir Nombre='PARTE'
                        ST.nameHost = findHostByLabel(NAME_LABEL_RX, ['lightning-input']) || ST.nameHost;
                        if (ST.nameHost) writeHostValue(ST.nameHost, 'PART');

                        applyComm();
                        destroyPicker();
                    }, 180);
                } catch (err) {
                    console.error('[PART] click error:', err);
                    destroyPicker();
                }
            });
            return b;
        }

        // —— Botón único "ESTUDI": haga clic para que aparezcan 7 opciones de ESTUDI —— //
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

                // Primero saca la variante ESTUDI
                // ...después de pickEstudiVariant():
                const v = await pickEstudiVariant();
                if (!v) { destroyPicker(); return; }

                // Clave: Indica a applyName que no muestre una ventana emergente esta vez y que solo escriba ESTUDI - XXX
                ST.preNameOverride = { write: v.write, key: v.key };
                ST.lockNameOnce = true;
                ST.lastTextName = v.write;
                ST.lastNameKey = v.key;

                // Ajustes 03/07
                ensurePickHosts();
                await setComboValue(ST.tipoHost, ESTUDI_TARGET.tipo);
                setTimeout(async () => {
                    await setComboValue(ST.subtipoHost, ESTUDI_TARGET.subtipo);

                    // Escribe "Nombre del Pre-requisito" = ESTUDI - XXX (escribir una vez es más estable)
                    ST.nameHost = findHostByLabel(NAME_LABEL_RX, ['lightning-input']) || ST.nameHost;
                    if (ST.nameHost) writeHostValue(ST.nameHost, v.write);

                    // No escriba comunicación: applyComm quedará vacío si falla
                    applyComm();
                    destroyPicker();
                }, 180);
            });
            return b;
        }

        //——Construir lista de candidatos: filtrar elementos vacíos + eliminar variantes individuales de PART/ESTUDI + inyectar "PART/ESTUDI único"—— //
        let entries = NAME_CATALOG
        .filter(e => e && e.label && e.label.trim() !== '')
        .filter(e => String(e.write).trim().toUpperCase() !== 'PART')
        .filter(e => String(e.label).trim().toUpperCase() !== 'ESTUDI' &&
                String(e.write).trim().toUpperCase() !== 'ESTUDI');

        // Inyectar dos botones unificados
        entries.push({ label: 'PART', __isPartUniversal:   true });
        entries.push({ label: 'ESTUDI', __isEstudiUniversal: true });

        // Clasificar
        entries.sort((a, b) => a.label.localeCompare(b.label, 'es'));

        // Prestar
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

        // Cerrar solo cuando se hace clic en el punto externo
        const onDocDown = (e) => {
            if (ST._insidePickerClick) return;
            const path = e.composedPath?.() || [];
            if (!path.includes(wrap) && !path.includes(ST.nameHost)) {
                destroyPicker();
                document.removeEventListener('mousedown', onDocDown, true);
                document.removeEventListener('keydown', onKey, true);
            }
        };
        const onKey = (e) => { if (e.key === 'Escape') onDocDown(e); };
        document.addEventListener('mousedown', onDocDown, true);
        document.addEventListener('keydown', onKey, true);
    }

    /***  Lógica de aplicar reglas  ***/
    const applyName = (() => {
        let t=null;
        return async () => {
            if (!ST.subtipo) return;
            clearTimeout(t);
            t = setTimeout(async () => {
                const key = `${ST.tipo ?? ''}/${ST.subtipo ?? ''}`;
                if (ST.lastKeyName === key && ST.lastTextName != null) return;
                const rule = NAME_RULES[key];

                ST.nameHost = ST.nameHost || findHostByLabel(NAME_LABEL_RX, ['lightning-input']);

                // —— Si hay un resultado de preselección único, escríbalo directamente y omita la ventana emergente —— //
                if (ST.preNameOverride) {
                    const picked = ST.preNameOverride; // { write, key }
                    ST.preNameOverride = null;
                    ST.nameHost = ST.nameHost || findHostByLabel(NAME_LABEL_RX, ['lightning-input']);
                    if (ST.nameHost) {
                        writeHostValue(ST.nameHost, picked.write || '');
                        ST.lastTextName = picked.write || '';
                        ST.lastNameKey = picked.key || (picked.write || '');
                    }
                    ST.lastKeyName = key; // key = `${ST.tipo}/${ST.subtipo}`
                    applyComm(); 
                    return; // resolveRuleValueUI ya no se activa → no aparecerá ninguna ventana emergente
                }
                
                if (rule === undefined) {
                    // Lógica de limpieza
                    if (ST.lastTextName && ST.lastTextName !== '') {
                        if (writeHostValue(ST.nameHost, '')) ST.lastTextName = '';
                    }
                    ST.lastKeyName = key;

                    // Solo se solicita una vez la combinación actual
                    const k = key; // `${ST.tipo}/${ST.subtipo}`
                    if (ST.tipo && ST.subtipo && ST.noProcShownKey !== k) {
                        ST.noProcShownKey = k;
                        const msg = `No procede el prerrequisito con el TIPO y SUBTIPO seleccionados.`;
                        //const msg = `No procede el prerrequisito con el TIPO "${ST.tipo}" y SUBTIPO "${ST.subtipo}" seleccionados.`;
                        await showNoticeModal(msg);
                    }
                    return;
                }
                
                if (ST.lockNameOnce) {
                    ST.lockNameOnce = false;
                    ST.lastKeyName = key;
                    applyComm();
                    return;
                }

                const picked = await resolveRuleValueUI(key, rule);
                if (picked === null) return;
                const writeText = picked.write ?? picked.label ?? '';
                if (writeHostValue(ST.nameHost, writeText)) {
                    ST.lastTextName = writeText;
                    ST.lastNameKey = picked.key ?? writeText;
                }
                ST.lastKeyName = key;
                applyComm();
            }, 120);
        };
    })();

    const applyComm = (() => {
        let t=null;
        return async () => {
            clearTimeout(t);
            t = setTimeout(async () => {
                const key2 = `${ST.tipo ?? ''}/${ST.subtipo ?? ''}`;
                const nombreKey = ST.lastNameKey || ST.lastTextName || '';
                const key3 = `${key2}/${nombreKey}`;
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

                const picked = await resolveRuleValueUI((rule3 !== undefined) ? key3 : key2, rule);
                if (picked === null) return;

                const writeText = (typeof picked === 'object') ? (picked.write ?? picked.label ?? '') : picked;
                if (writeHostValue(ST.commHost, writeText)) ST.lastTextComm = writeText;
                ST.lastKeyComm = (rule3 !== undefined) ? key3 : key2;
            }, 140);
        };
    })();

    /***  Listeners  ***/
    // Solo almacena en caché el host, ya no aparece automáticamente debido al foco
    function onFocusIn(e){
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
                applyComm();
            }
        }
    }

    //Abre la lista flotante solo cuando se hace clic en "Nombre del Pre-requisito"
    document.addEventListener('click', (e) => {
        const path = e.composedPath?.() || [];
        // Si se hace clic en el panel flotante, ignorar
        if (path.some(n => n && n.id === '__af_name_picker_ephemeral__')) return;

        const hit = path.find(n => n && n.tagName === 'LIGHTNING-INPUT');
        if (!hit) return;
        const lab = hit.label || hit.getAttribute?.('label') || '';
        if (NAME_LABEL_RX.test(lab)) {
            ST.nameHost = hit;
            openNamePickerOnDemand();
        }
    }, true);

    // Mark: El usuario acaba de hacer clic en el menú desplegable Subtipo (hacer clic en las opciones dentro de los próximos 1,2 segundos contará como esta apertura)
    document.addEventListener('pointerdown', (e) => {
        const path = e.composedPath?.() || [];
        const combo = path.find(n => n && n.tagName === 'LIGHTNING-COMBOBOX');
        if (!combo) return;
        const label = combo.label || combo.getAttribute?.('label') || '';
        if (label === 'Subtipo') {
            ST._subtipoListOpen = true;
            // Tiempo de espera para evitar que la bandera quede colgada
            clearTimeout(ST._subtipoListTimer);
            ST._subtipoListTimer = setTimeout(() => { ST._subtipoListOpen = false; }, 2000); //延长点击时间
        }
    }, true);

    document.addEventListener('click', async (e) => {
        // Solo proceso dentro del periodo de ventana de "Se acaba de abrir el menú desplegable de subtipo"
        if (!ST._subtipoListOpen) return;

        const path = e.composedPath?.() || [];

        // Encuentre el "nodo de opción" en el que hizo clic en la superposición de Salesforce
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

        // Obtener el valor de la opción en la que se hizo clic esta vez (primero el valor de los datos, luego el texto)
        const picked = (opt.getAttribute('data-value') || opt.dataset?.value || (opt.textContent || '')).trim();
        if (!picked) return;

        // Subtipo actualmente seleccionado
        const currentSub = (ST.subtipo || '').trim();
        // Procesar solo cuando se "hace clic en el mismo subtipo"; de lo contrario, dejar el comportamiento predeterminado
        if (picked.toLowerCase() !== currentSub.toLowerCase()) {
            ST._subtipoListOpen = false; // Si se selecciona otro valor, onPickChange seguirá la lógica normal.
            return;
        }

        // Determinar si este Tipo/Subtipo es una "regla de selección múltiple" (01/01 o 01/07)
        const key = `${ST.tipo ?? ''}/${ST.subtipo ?? ''}`;
        const rule = NAME_RULES[key];
        const isMulti = Array.isArray(rule);

        if (!isMulti) {
            ST._subtipoListOpen = false;
            return;
        }

        // El usuario "selecciona nuevamente" en el mismo Subtipo → Interceptamos y abrimos una ventana
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        ST._subtipoListOpen = false;

        // Limpiar el viejo Nombre
        ST.nameHost = ST.nameHost || findHostByLabel(NAME_LABEL_RX, ['lightning-input']);
        if (ST.nameHost) writeHostValue(ST.nameHost, '');
        ST.lastTextName = '';
        ST.lockNameOnce = false;

        // Aparece un modal de selección múltiple
        const choice = await showChoiceModal('Seleccione Pre-requisito', rule);
        if (choice == null) return;

        //Solo cuando la clave actual es 03/07 y el usuario selecciona ESTUDI → ingresa a la ventana emergente secundaria
        const keyNow = `${ST.tipo ?? ''}/${ST.subtipo ?? ''}`;
        const getLabel = x => (typeof x === 'object' ? (x.label ?? x.write ?? '') : String(x)).trim().toUpperCase();
        if (keyNow === '03/07' && getLabel(choice) === 'ESTUDI') {
            const v = await pickEstudiVariant();
            if (!v) return;
            if (ST.nameHost) writeHostValue(ST.nameHost, v.write);
            ST.lastTextName = v.write;
            ST.lastNameKey = v.key;
            applyComm();
            return;
        }

        // Otras opciones siguen la lógica original
        const writeText = (typeof choice === 'object') ? (choice.write ?? choice.label ?? '') : choice;
        const nameKey = (typeof choice === 'object') ? (choice.key ?? writeText) : writeText;
        if (ST.nameHost) writeHostValue(ST.nameHost, writeText);
        ST.lastTextName = writeText;
        ST.lastNameKey = nameKey;
        applyComm();
    }, true);

    async function clearTipoDependents() {
        // Estado
        ST.subtipo = null;
        ST.lastKeyName = null;
        ST.lastTextName = '';
        ST.lastNameKey = null;
        ST.lastKeyComm = null;
        ST.lastTextComm = '';
        ST.noProcShownKey = null;
        // Hosts
        ensurePickHosts();
        ST.nameHost = ST.nameHost || findHostByLabel(NAME_LABEL_RX, ['lightning-input']);
        ST.commHost = ST.commHost || findHostByLabel(COMM_LABEL_RX, ['lightning-textarea','lightning-input-rich-text']);
        
        // Limpiar Subtipo (combobox)
        if (ST.subtipoHost) {
            try {
                // Intenta la vía estándar
                ST.subtipoHost.value = '';
                ST.subtipoHost.dispatchEvent(new CustomEvent('change', { detail:{ value:'' }, bubbles:true, composed:true }));
                ST.subtipoHost.dispatchEvent(new Event('blur', { bubbles:true, composed:true }));
            } catch(_) {}
        }

        // Limpiar Nombre del Pre-requisito
        if (ST.nameHost) writeHostValue(ST.nameHost, '');

        // Limpiar Comunicación al cliente
        if (ST.commHost) writeHostValue(ST.commHost, '');

        // Cerrar UI auxiliar
        ST.lockNameOnce = false;
        ST.modalOpen = false;
        ST.choosing = false;
        destroyPicker();
    }

    function onPickChange(e){
        const path = e.composedPath?.() || [];
        const host = path.find(n => n && n.tagName === 'LIGHTNING-COMBOBOX');
        if (!host) return;

        const label = host.label || host.getAttribute?.('label') || '';
        const val = ('value' in host) ? host.value : null;
        if (val == null) return;

        if (label === 'Tipo') {
            ST.tipo = val;
            clearTipoDependents(); // ← limpia Subtipo, Nombre y Comunicación
            return;
        }
        
        if (label === 'Subtipo') {
            ST.subtipo = val;
            applyName();
            applyComm();
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
        destroyPicker();
        document.getElementById('__af_modal_root__')?.remove();
    }

    function install() {
        document.addEventListener('focusin', onFocusIn, true);
        document.addEventListener('change', onPickChange, true);
    }

    // Corregir includes
    (function monitorNewPrereqPage(){
        let lastUrl = location.href;
        const CHECK_INTERVAL = 800;

        setInterval(() => {
            const href = location.href;
            if (href !== lastUrl) {
                lastUrl = href;
                if (href.includes('/lightning/o/Prerequisite__c/new') || href.includes('/lightning/r/Prerequisite__c/')) {
                    resetFormState();
                    setTimeout(() => {
                        ST.nameHost = ST.nameHost || findHostByLabel(NAME_LABEL_RX, ['lightning-input']);
                        applyName();
                        applyComm();
                    }, 400);
                } else {
                    resetFormState();
                }
            }
        }, CHECK_INTERVAL);
    })();
    if (document.readyState === 'complete' || document.readyState === 'interactive') install();
    else document.addEventListener('DOMContentLoaded', install, { once:true });
})();
