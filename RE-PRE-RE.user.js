// ==UserScript==
// @name         RE-Pre-requisito Auto
// @namespace    sf-autofill-comm
// @version      1.3.0
// @description  Reabrir: lee Tipo/Subtipo/Nombre del Pre-requisito y rellena “Comunicación al cliente” según reglas.
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

    /* ================= Configuración de reglas ================= */
    // Sugerencia: puedes añadir comodines por Tipo/Subtipo si no hay Nombre:
    //   '01/07/*': 'Texto para cualquier nombre dentro de 01/07'
    const NOMBRE_TEXT_MAP = {
        '01/01/PART': 'Es necesario continuar con la gestión de obtención de los permisos de terceros afectados.',
        '01/01/REQ ORG CLIENT': 'Se ha trasladado a revisión la documentación aportada.',
        '01/04/CES OC': 'Continuamos con la gestión de los documentos de cesión.',
        '01/06/IE': 'Se ha trasladado a revisión la documentación aportada.',
        '01/07/ANULAR': 'Proceso de anulación en curso.',
        '01/07/PTE ACT CLIENT': 'La gestión del expediente continua suspendida a la espera de la aportación por su parte de los documentos que se le han requerido.',
        '01/18/OBRA CIVIL': 'Se ha trasladado a revisión la documentación aportada.',
        '01/19/CES': 'Se ha trasladado a revisión la documentación aportada.',
        '01/20/AJUSTAT': 'Se ha trasladado a revisión la documentación aportada.',
        '01/21/ACTA': 'Se ha trasladado a revisión la documentación aportada.',
        '02/08/ESCREIX': 'Continua pendiente el pago del sobrecoste indicado en las condiciones - técnico económicas remitidas.',
        // Ejemplo comodín por Tipo/Subtipo
        // '01/07/*': 'Texto genérico para 01/07 cuando no hay nombre.',
    };

    /* ================= Utilidades generales ================= */
    const DEBUG = true;
    const log = (...a) => { if (DEBUG) console.log('[RE-PRE-RE]', ...a); };
    const warn = (...a) => console.warn('[RE-PRE-RE]', ...a);
    const clean = s => s?.replace(/\u00A0/g, ' ').replace(/[ \t]+/g, ' ').trim() || '';
    const norm = s => (s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[ \t]+/g,' ')
    .toUpperCase().trim();

    // Recorrido profundo con Shadow DOM, sin cortar la exploración
    function deepQueryAll(root, selector, cap = 8000) {
        const out = [];
        const seen = new Set();
        const stack = [root];
        let left = cap;

        while (stack.length && left-- > 0) {
            const n = stack.pop();
            if (!n || seen.has(n)) continue;
            seen.add(n);

            try {
                if (n.querySelectorAll) {
                    out.push(...n.querySelectorAll(selector));
                }
            } catch {}

            // Entrar en Shadow DOM si existe
            if (n.shadowRoot) stack.push(n.shadowRoot);

            // Recorrer hijos
            const ch = n.children;
            if (ch) for (let i = 0; i < ch.length; i++) stack.push(ch[i]);

            // Document o ShadowRoot: recorrer sus children (ya cubierto por n.children en la mayoría)
            if (n instanceof Document || n instanceof ShadowRoot) {
                const kids = n.children || n.childNodes;
                if (kids) for (let i = 0; i < kids.length; i++) stack.push(kids[i]);
            }
        }
        return out;
    }

    const isVisible = el => {
        if (!el) return false;
        const st = getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity || '1') <= 0.01) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
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

    function findOpenDialog() {
        const modals = deepQueryAll(document, '.slds-modal').filter(isVisible);
        const hit = modals.find(m => m.classList.contains('slds-fade-in-open')) || modals[0];
        if (hit) return hit;
        const roles = deepQueryAll(document, '[role="dialog"]').filter(isVisible);
        return roles[0] || null;
    }

    function findCommEditorInModal(modal) {
        if (!modal) return null;

        // 1) lightning-input-rich-text con etiqueta que contenga "Comunicación al cliente"
        const richHosts = deepQueryAll(modal, 'lightning-input-rich-text');
        for (const host of richHosts) {
            const labelNode = deepQueryAll(host, '[part="rich-text-label"], .slds-form-element__label, label, [aria-label]')[0];
            const labelTxt = (labelNode?.innerText || labelNode?.getAttribute?.('aria-label') || '').trim();
            if (/Comunicaci[oó]n al cliente/i.test(labelTxt)) {
                const ed = deepQueryAll(host, '.ql-editor[contenteditable="true"]')[0];
                if (ed && isVisible(ed)) return ed;
            }
        }

        // 2) Quill editor visible
        const editors = deepQueryAll(modal, '.ql-editor[contenteditable="true"]').filter(isVisible);
        if (editors.length === 1) return editors[0];

        // 3) Heurística por contexto textual
        for (const ed of editors) {
            const around = (ed.closest?.('.slds-form-element') || modal)?.textContent || '';
            if (/Comunicaci[oó]n al cliente/i.test(around)) return ed;
        }
        return editors[0] || null;
    }

    /* ================= Reglas: indexación y matching ================= */
    const RULE_INDEX = (() => {
        const items = Object.entries(NOMBRE_TEXT_MAP).map(([k, v]) => {
            const nk = norm(k);
            const parts = nk.split('/');
            const tipo = parts[0] || '';
            const subtipo = parts[1] || '';
            const tail = parts.slice(2).join('/') || ''; // nombre o '*'
            return { rawKey: k, text: v, nk, tipo, subtipo, tail };
        });
        return items;
    })();

    function getAutoText(tipo, subtipo, nombre) {
        const t = norm(tipo || '');
        const s = norm(subtipo || '');
        const n = norm(nombre || '');
        const tail = n.split('/').pop();

        // 0) comodín por Tipo/Subtipo si existe y nombre vacío o sin match
        const wildcard = RULE_INDEX.find(e => e.tipo === t && e.subtipo === s && e.tail === '*');
        // 1) match exacto tipo/subtipo/nombre
        const exact = RULE_INDEX.find(e => e.nk === `${t}/${s}/${n}`);
        if (exact) return exact.text;

        // 2) prefix del key completo
        const pref = RULE_INDEX.find(e => (`${t}/${s}/${n}`).startsWith(e.nk));
        if (pref) return pref.text;

        // 3) tail exacto (ACTA, AJUSTAT, etc.)
        const tailExact = RULE_INDEX.find(e => e.tail && e.tail === tail);
        if (tailExact) return tailExact.text;

        // 4) tail prefix
        const tailPref = RULE_INDEX.find(e => e.tail && tail.startsWith(e.tail));
        if (tailPref) return tailPref.text;

        // 5) comodín tipo/subtipo
        if (wildcard) return wildcard.text;

        return null;
    }

    /* ================= Lectura de campos por etiqueta (unificada) ================= */
    const LABELS = {
        tipo: 'Tipo',
        subtipo: 'Subtipo',
        nombre: 'Nombre del Pre-requisito',
    };

    function readFieldByLabel(label) {
        const strategies = [
            // A) Botón inline-edit "Modificar <label>"
            () => {
                const btn = deepQueryAll(document, 'button.inline-edit-trigger[title]')
                .find(b => new RegExp(`^Modificar\\s+${label}$`, 'i').test(b.getAttribute('title') || ''));
                const formEl = btn && (btn.closest('.slds-form-element') || btn.parentElement);
                if (!formEl) return null;

                // El valor suele estar en .slds-form-element__control, sin botones/iconos
                const ctrl = formEl.querySelector('.slds-form-element__control');
                if (!ctrl) return null;

                const clone = ctrl.cloneNode(true);
                clone.querySelectorAll('button, svg, lightning-icon, .slds-button, .slds-assistive-text, .inline-edit-trigger, .slds-form-element__static, lightning-formatted-text, a')
                    .forEach(n => n.remove());

                let txt = clean(clone.textContent || '');
                txt = txt.replace(new RegExp(`^${label}\\s*[:：-]?\\s*`, 'i'), '');
                return clean(txt);
            },

            // B) Pareja .slds-form-element__label + control
            () => {
                const blocks = deepQueryAll(document, '.slds-form-element');
                for (const el of blocks) {
                    const lab = el.querySelector('.slds-form-element__label, label');
                    if (!lab) continue;
                    if (clean(lab.textContent).toLowerCase() !== label.toLowerCase()) continue;

                    const ctrl = el.querySelector('.slds-form-element__control');
                    if (!ctrl) continue;

                    const clone = ctrl.cloneNode(true);
                    clone.querySelectorAll('button, svg, lightning-icon, .slds-button, .slds-assistive-text, .inline-edit-trigger, .slds-form-element__static, lightning-formatted-text, a')
                        .forEach(n => n.remove());

                    let txt = clean(clone.textContent || '');
                    txt = txt.replace(new RegExp(`^${label}\\s*[:：-]?\\s*`, 'i'), '');
                    return clean(txt);
                }
                return null;
            },

            // C) Heurística plana por texto de la página
            () => {
                const body = document.body?.innerText || '';
                const STOP_BOUND = '(?:\\r?\\n| {2,})\\s*';
                const NEXT_LABEL = '(?:Modificar|Fecha|Proyecto|Comentarios?|Comunicaci[oó]n|Informaci[oó]n|Creado|[ÚU]ltima)\\b';
                const reLine = new RegExp(`(^|[\\r\\n])\\s*${label.replace(/[.*+?^${}()|[\\]\\\\]/g,'\\$&')}\\s*[:：-]?\\s*([^\\r\\n]+)`, 'im');
                let m = body.match(reLine);
                if (m) {
                    let v = clean(m[2]);
                    v = v.replace(new RegExp(`(${STOP_BOUND})${NEXT_LABEL}[\\s\\S]*$`, 'i'), '');
                    v = v.replace(new RegExp(`^${label}\\s*[:：-]?\\s*`, 'i'), '');
                    return clean(v);
                }
                return null;
            },
        ];

        for (const fn of strategies) {
            try {
                const v = fn();
                if (v) return v;
            } catch {}
        }
        return null;
    }

    function readCamposOnce() {
        const tipo = readFieldByLabel(LABELS.tipo);
        const subtipo = readFieldByLabel(LABELS.subtipo);
        const nombre = readFieldByLabel(LABELS.nombre);
        if (tipo) { window.PRE_TIPO = tipo; log('Tipo =', tipo); } else { warn('Tipo no detectado'); }
        if (subtipo) { window.PRE_SUBTIPO = subtipo; log('Subtipo =', subtipo); } else { warn('Subtipo no detectado'); }
        if (nombre) { window.NOMBRE_PRE = nombre; log('Nombre =', nombre); } else { warn('Nombre del Pre-requisito no detectado'); }
    }

    /* ================= Escritura Quill ================= */
    function writeToQuill(ed, text) {
        if (!ed) return;
        ed.focus(); ed.click();
        ed.innerHTML = '<p><br></p>';

        let ok = false;
        try { ed.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: text, bubbles: true, composed: true })); } catch {}
        try { ok = document.execCommand('insertText', false, text); } catch {}

        if (!ok) {
            const sel = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(ed); range.collapse(false);
            sel.removeAllRanges(); sel.addRange(range);
            const tn = document.createTextNode(text);
            range.insertNode(tn); range.setStartAfter(tn); range.setEndAfter(tn);
            sel.removeAllRanges(); sel.addRange(range);
        }

        ed.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
        ed.dispatchEvent(new Event('change', { bubbles: true }));
        log('Comunicación al cliente rellenada.');
    }

    /* ================= Flujo principal con secuencias ================= */
    let CLICK_SEQ = 0, LOGGED_SEQ = 0, FILLED_SEQ = 0;
    const observers = [];

    function waitForModalAndFill(seq, timeoutMs = 30000) {
        const t0 = Date.now();
        let lastRun = 0;

        const step = () => {
            const now = Date.now();
            if (now - lastRun < 120) return false;
            lastRun = now;

            if (seq !== CLICK_SEQ) return true;        // se aborta por nueva secuencia
            if (FILLED_SEQ === seq) return true;       // ya rellenado
            if (isSalesforceErrorModalOpen()) return true;

            const modal = findOpenDialog();
            if (!modal) return false;

            if (LOGGED_SEQ !== seq) {
                log('Modal detectado: Reabrir Pre-requisito');
                readCamposOnce();
                LOGGED_SEQ = seq;
            }

            const ed = findCommEditorInModal(modal);
            if (!ed) return false;

            const tipo = window.PRE_TIPO || readFieldByLabel(LABELS.tipo);
            const subtipo = window.PRE_SUBTIPO || readFieldByLabel(LABELS.subtipo);
            const nombre = window.NOMBRE_PRE ?? readFieldByLabel(LABELS.nombre);

            const autoText = getAutoText(tipo, subtipo, nombre);
            if (!autoText) {
                log('Sin match. No se autorrellena. Tipo/Subtipo/Nombre =', tipo, '/', subtipo, '/', nombre);
                FILLED_SEQ = seq;
                return true;
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
        mo.observe(document.body, { childList: true, subtree: true });
        observers.push(mo);

        let delay = 60;
        (function tick() {
            if (seq !== CLICK_SEQ) { mo.disconnect(); return; }
            if (step()) { mo.disconnect(); return; }
            if (Date.now() - t0 >= timeoutMs) { mo.disconnect(); return; }
            setTimeout(tick, delay);
            if (delay < 500) delay = Math.min(500, Math.floor(delay * 1.6));
        })();
    }

    function clickHandler(ev) {
        const path = ev.composedPath?.() || [];
        const btn = path.find(n => n && n.tagName === 'BUTTON');
        const text = (btn?.textContent || '').trim();
        const name = btn?.getAttribute?.('name') || '';

        // Reabrir
        if (/^Prerequisite__c\.reabrirPrerequisito$/i.test(name) || /^Reabrir$/i.test(text)) {
            if (isSalesforceErrorModalOpen()) { warn('Página con error. Flujo detenido.'); return; }
            CLICK_SEQ += 1; LOGGED_SEQ = 0; FILLED_SEQ = 0;
            const seq = CLICK_SEQ;
            log('CLICK Reabrir seq=', seq);
            setTimeout(() => waitForModalAndFill(seq), 50);
            return;
        }

        // Cancelar
        if (/^Cancelar$/i.test(text)) {
            log('CLICK Cancelar');
            const moClose = new MutationObserver(() => {
                const dlg = findOpenDialog();
                if (!dlg || !isVisible(dlg)) { log('Modal Reabrir cerrado.'); moClose.disconnect(); }
            });
            moClose.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class','style'] });
            observers.push(moClose);
        }
    }
    document.addEventListener('click', clickHandler, true);

    /* ================= Limpieza ================= */
    window.__COMM_AUTO = {
        cleanup() {
            try { document.removeEventListener('click', clickHandler, true); } catch {}
            observers.forEach(o => { try { o.disconnect(); } catch {} });
            observers.length = 0;
            delete window.__COMM_AUTO;
            log('Limpieza completa.');
        }
    };

    log('Script cargado v1.3.0');
})();
