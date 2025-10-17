// ==UserScript==
// @name         RE-PRE-RE auto v1
// @namespace    sf-autofill-comm
// @version      1.1
// @description  “Reabrir”, Tipo/Subtipo/Nombre del Pre-requisito，rellana “Comunicación al cliente”
// @match        https://*.lightning.force.com/*
// @match        https://*.my.salesforce.com/*
// @match        https://*.salesforce.com/*
// @author       Jiatai + Carles + GPT
// @run-at       document-idle
// @inject-into  page
// @noframes
// @grant        none
// ==/UserScript==

(function () {

    if (window.__COMM_AUTO?.cleanup) { try { window.__COMM_AUTO.cleanup(); } catch {} }
    const NOMBRE_TEXT_MAP = {
        '01/01/PART': 'Es necesario continuar con la gestión de obtención de los permisos de terceros afectados.',
        '01/01/REQ ORG CLIENT': 'Se ha trasladado a revisión la documentación aportada.',
        '01/04/CES OC': 'Continuamos con la gestión de los documentos de cesión.',
        '01/06/IE': 'Se ha trasladado a revisión la documentación aportada.',
        '01/07/ANULAR': 'Proceso de anulación en curso.',
        // '01/07/FASE OBRA': '',
        '01/07/PTE ACT CLIENT': 'La gestión del expediente continua suspendida a la espera de la aportación por su parte de los documentos que se le han requerido.',
        '01/18/OBRA CIVIL': 'Se ha trasladado a revisión la documentación aportada.',
        '01/19/CES': 'Se ha trasladado a revisión la documentación aportada.',
        '01/20/AJUSTAT': 'Se ha trasladado a revisión la documentación aportada.',
        '01/21/ACTA': 'Se ha trasladado a revisión la documentación aportada.',
        '02/08/ESCREIX': 'Continua pendiente el pago del sobrecoste indicado en las condiciones - técnico económicas remitidas.',
    };

    const norm = s => (s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[ \t]+/g,' ')
    .toUpperCase().trim();

    const NOMBRE_INDEX = Object.entries(NOMBRE_TEXT_MAP).map(([k, v]) => {
        const nk = norm(k);
        const tail = nk.split('/').pop(); //  '01/20/AJUSTAT' → 'AJUSTAT'
        return { rawKey: k, text: v, nk, tail };
    });

    function getAutoTextByNombre(nombre) {
        const n = norm(nombre);
        const tail = n.split('/').pop();

        // 1) all
        let hit = NOMBRE_INDEX.find(e => e.nk === n);
        if (hit) return hit.text;

        // 2) prefijo
        hit = NOMBRE_INDEX.find(e => n.startsWith(e.nk));
        if (hit) return hit.text;

        // 3) tail
        hit = NOMBRE_INDEX.find(e => e.tail === tail);
        if (hit) return hit.text;

        // 4) prefijo tail
        hit = NOMBRE_INDEX.find(e => tail.startsWith(e.tail));
        if (hit) return hit.text;

        return null; // Si no cumple condicion, no rellana
    }

    let CLICK_SEQ = 0, LOGGED_SEQ = 0, FILLED_SEQ = 0;

    /* ========== Utils ========== */
    const clean = s => s?.replace(/\u00A0/g,' ').replace(/[ \t]+/g,' ').trim() || '';
    const isVisible = el => {
        if (!el) return false;
        const st = getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity || '1') <= 0.01) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    };

    const deepQueryAll = (root, selector) => {
        const out = [], seen = new Set();
        let cap = 6000; // Max nº escaneo, mejora velocidad, evitar lag.
        (function walk(n){
            if (!n || seen.has(n) || cap-- <= 0) return;
            seen.add(n);
            try { if (n.querySelectorAll) { out.push(...n.querySelectorAll(selector)); return; } } catch {}
            if (n.children) for (const c of n.children) walk(c);
            if (n.shadowRoot) walk(n.shadowRoot);
        })(root);
        return out;
    };

    const isSalesforceErrorModalOpen = () => {
        const all = deepQueryAll(document, '[role="dialog"], .slds-modal').filter(isVisible);
        return all.some(el => {
            const t = (el.textContent || '').toLowerCase();
            return t.includes('sentimos la interrupción') ||
                t.includes('we hit a snag') ||
                t.includes('something has gone wrong');
        });
    };

    /* ========== Busca modal y ventana para introducir texto ========== */
    const findOpenDialog = () => {
        const modals = deepQueryAll(document, '.slds-modal').filter(isVisible);
        const hit = modals.find(m => m.classList.contains('slds-fade-in-open')) || modals[0];
        if (hit) return hit;
        const roles = deepQueryAll(document, '[role="dialog"]').filter(isVisible);
        return roles[0] || null;
    };
    const findCommEditorInModal = (modal) => {
        if (!modal) return null;
        const richHosts = deepQueryAll(modal, 'lightning-input-rich-text');
        for (const host of richHosts) {
            const labelNode = deepQueryAll(host, '[part="rich-text-label"], .slds-form-element__label, label, [aria-label]')[0];
            const labelTxt = (labelNode?.innerText || labelNode?.getAttribute?.('aria-label') || '').trim();
            if (/Comunicaci[oó]n al cliente/i.test(labelTxt)) {
                const ed = deepQueryAll(host, '.ql-editor[contenteditable="true"]')[0];
                if (ed && isVisible(ed)) return ed;
            }
        }
        const editors = deepQueryAll(modal, '.ql-editor[contenteditable="true"]').filter(isVisible);
        if (editors.length === 1) return editors[0];
        for (const ed of editors) {
            const around = (ed.closest?.('.slds-form-element') || modal)?.textContent || '';
            if (/Comunicaci[oó]n al cliente/i.test(around)) return ed;
        }
        return editors[0] || null;
    };

    /* ========== Solo leer 3 textos ========== */
    function postProcessValue(v, label) {
        v = v.replace(/^Modificar\s+/i, '');
        if (label) v = v.replace(new RegExp(`^${label}\\s*[:：-]?\\s*`, 'i'), '');
        return clean(v);
    }
    function extractValueFromFormEl(formEl, label) {
        const ctrl = formEl.querySelector('.slds-form-element__control');
        if (!ctrl) return null;
        const clone = ctrl.cloneNode(true);
        clone.querySelectorAll(
            'button, svg, lightning-icon, .slds-button, .slds-assistive-text, ' +
            '.inline-edit-trigger, .slds-form-element__static, lightning-formatted-text, a'
        ).forEach(n => n.remove());
        let txt = clean(clone.textContent || '');
        if (label) txt = txt.replace(new RegExp(`^${label}\\s*[:：-]?\\s*`, 'i'), '');
        return postProcessValue(txt, label);
    }
    const STOP_BOUND = '(?:\\r?\\n| {2,})\\s*';
    const NEXT_LABEL = '(?:Modificar|Fecha|Proyecto|Comentarios?|Comunicaci[oó]n|Informaci[oó]n|Creado|[ÚU]ltima)\\b';

    function getByLabel(label) {
        //Modificar <label>
        try {
            const btn = deepQueryAll(document, 'button.inline-edit-trigger[title]')
            .find(b => new RegExp(`^Modificar\\s+${label}$`, 'i').test(b.getAttribute('title') || ''));
            const formEl = btn && (btn.closest('.slds-form-element') || btn.parentElement);
            if (formEl) {
                const v = extractValueFromFormEl(formEl, label);
                if (v) return v;
                const raw = clean((formEl.textContent || '').replace(new RegExp(`^${label}\\s*[:：-]?\\s*`, 'i'), ''));
                const m = raw.match(new RegExp(`([^\\n]+?)(?=(${STOP_BOUND})${NEXT_LABEL}|$)`, 'i'));
                const v2 = postProcessValue(m ? m[1] : raw, label);
                if (v2) return v2;
            }
        } catch {}
        //DOM
        try {
            const blocks = [...deepQueryAll(document, '.slds-form-element'), ...(document.querySelectorAll?.('.slds-form-element') || [])];
            for (const el of blocks) {
                const lab = el.querySelector('.slds-form-element__label, label');
                if (!lab) continue;
                if (clean(lab.textContent).toLowerCase() !== label.toLowerCase()) continue;
                const v = extractValueFromFormEl(el, label);
                if (v) return v;
            }
        } catch {}
        // Página principal
        try {
            const body = document.body?.innerText || '';
            const reLine = new RegExp(`(^|[\\r\\n])\\s*${label.replace(/[.*+?^${}()|[\\]\\\\]/g,'\\$&')}\\s*[:：-]?\\s*([^\\r\\n]+)`, 'im');
            let m = body.match(reLine);
            if (m) {
                let v = clean(m[2]);
                v = v.replace(new RegExp(`(${STOP_BOUND})${NEXT_LABEL}[\\s\\S]*$`, 'i'), '');
                v = postProcessValue(v, label);
                if (v) return v;
            }
        } catch {}
        return null;
    }

    function logCampos() {
        const tipo = getByLabel('Tipo');
        const subtipo = getByLabel('Subtipo');
        const nombre = getByLabel('Nombre del Pre-requisito');
        if (tipo) { console.log('Tipo =', tipo); window.PRE_TIPO = tipo; } else { console.warn('未检测到 Tipo'); }
        if (subtipo) { console.log('Subtipo =', subtipo); window.PRE_SUBTIPO = subtipo; } else { console.warn('未检测到 Subtipo'); }
        if (nombre) { console.log('Nombre del Pre-requisito =', nombre); window.NOMBRE_PRE = nombre; } else { console.warn('未检测到 Nombre del Pre-requisito'); }
    }

    /* ========== Rellenar texto（una vez） ========== */
    const writeToQuill = (ed, text) => {
        if (!ed) return;
        ed.focus(); ed.click();
        ed.innerHTML = '<p><br></p>';
        let ok = false;
        try { ed.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: text, bubbles: true, composed: true })); } catch {}
        try { ok = document.execCommand('insertText', false, text); } catch {}
        if (!ok) {
            const sel = window.getSelection(); const range = document.createRange();
            range.selectNodeContents(ed); range.collapse(false);
            sel.removeAllRanges(); sel.addRange(range);
            const tn = document.createTextNode(text);
            range.insertNode(tn); range.setStartAfter(tn); range.setEndAfter(tn);
            sel.removeAllRanges(); sel.addRange(range);
        }
        ed.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
        ed.dispatchEvent(new Event('change', { bubbles: true }));
        console.log('[AUTO] Comunicación al cliente rellenada.');
    };

    /* ========== flujo principal, imprime una vez y autorellena una vez========== */
    const observers = [];
    const waitForModalAndLogThenFill = (seq, timeoutMs = 30000) => {
        const t0 = Date.now();
        let lastRun = 0;
        const step = () => {
            const now = Date.now();
            if (now - lastRun < 120) return false; // limitar gestion script
            lastRun = now;
            if (seq !== CLICK_SEQ) return true;
            if (FILLED_SEQ === seq) return true;
            if (isSalesforceErrorModalOpen()) return true;

            const modal = findOpenDialog();
            if (!modal) return false;

            if (LOGGED_SEQ !== seq) {
                console.log('[MODAL] Detectado Reabrir Pre-requisito modal');
                logCampos();
                LOGGED_SEQ = seq;
            }

            const ed = findCommEditorInModal(modal);
            if (!ed) return false;
            const nombre = window.NOMBRE_PRE ?? getByLabel('Nombre del Pre-requisito');
            const autoText = getAutoTextByNombre(nombre);
            if (!autoText) {
                console.log('[AUTO] No coincide text，no autorrellena. Nombre =', nombre);
                FILLED_SEQ = seq; // 标记本轮已处理，避免一直重试
                return true; // 本轮结束（只打印，不填充）
            }

            writeToQuill(ed, autoText);
            FILLED_SEQ = seq;
            return true;
        };

        if (step()) return;

        const mo = new MutationObserver(() => {
            if (seq !== CLICK_SEQ) { mo.disconnect(); return; }
            if (step()) { mo.disconnect(); }
        });
        mo.observe(document.body, { childList: true, subtree: true }); // no detecta attributes
        //mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class','style'] });
        observers.push(mo);

        let delay = 60;
        const tick = () => {
            if (seq !== CLICK_SEQ) { mo.disconnect(); return; }
            if (step()) { mo.disconnect(); return; }
            if (Date.now() - t0 >= timeoutMs) { mo.disconnect(); return; }
            setTimeout(tick, delay);
            if (delay < 500) delay = Math.min(500, Math.floor(delay * 1.6)); // 60→~500ms
        };
        setTimeout(tick, delay);

    };

    /* ========== detectar（pasado Shadow DOM） ========== */
    const clickHandler = (ev) => {
        const path = ev.composedPath?.() || [];
        const btn = path.find(n => n && n.tagName === 'BUTTON');
        const text = (btn?.textContent || '').trim();
        const name = btn?.getAttribute?.('name') || '';

        if (/^Prerequisite__c\.reabrirPrerequisito$/i.test(name) || /^Reabrir$/i.test(text)) {
            if (isSalesforceErrorModalOpen()) { console.warn('[MODAL] Página errónea，flujo detenido'); return; }
            CLICK_SEQ += 1; LOGGED_SEQ = 0; FILLED_SEQ = 0;
            const seq = CLICK_SEQ;
            console.log('[CLICK] Reabrir（seq=' + seq + '）');
            setTimeout(() => waitForModalAndLogThenFill(seq), 50);
            return;
        }

        if (/^Cancelar$/i.test(text)) {
            console.log('[CLICK] Cancelar（Detectado mouse click）');
            const moClose = new MutationObserver(() => {
                const dlg = findOpenDialog();
                if (!dlg || !isVisible(dlg)) { console.log('[MODAL] Reabrir Pre-requisito modal cerrado.'); moClose.disconnect(); }
            });
            moClose.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class','style'] });
            observers.push(moClose);
        }
    };
    document.addEventListener('click', clickHandler, true);

    /* ========== auto clean ========== */
    window.__COMM_AUTO = {
        cleanup() {
            document.removeEventListener('click', clickHandler, true);
            observers.forEach(o => { try { o.disconnect(); } catch {} });
            observers.length = 0;
            delete window.__COMM_AUTO;
            console.log('[AUTO] Limpiado todo.');
        }
    };

    console.log('[TM] SF Reabrir script cargado.');
})();
