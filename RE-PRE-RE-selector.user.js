// ==UserScript==
// @name           RE-Pre-requisito Selector
// @version        2.0
// @namespace      https://accesosede.my.salesforce.com/
// @description    En el modal "Reabrir el Pre-requisito": al enfocar el editor, muestra un popover de Nombres; al elegir, inserta el comentario y opcionalmente rellena el campo Nombre.
// @match          http*://*.force.com/*
// @match          http*://*.salesforce.com/*
// @author         Jiatai + Carles + GPT
// @grant          none
// ==/UserScript==

(() => {
    /* ========== Rules ========== */
    const RP_RULES_3 = {
        '01/01/PART': 'Es necesario continuar con la gestión de obtención de los permisos de terceros afectados.',
        '01/01/REQ ORG CLIENT': 'Se ha trasladado a revisión la documentación aportada.',
        '01/04/CES OC': 'Continuamos con la gestión de los documentos de cesión.',
        '01/06/IE': 'Se ha trasladado a revisión la documentación aportada.',
        '01/07/ANULAR': 'Proceso de anulación en curso.',
        //'01/07/FASE OBRA': '',
        '01/07/PTE ACT CLIENT': 'La gestión del expediente continua suspendida a la espera de la aportación por su parte de los documentos que se le han requerido.',
        '01/18/OBRA CIVIL': 'Se ha trasladado a revisión la documentación aportada.',
        '01/19/CES': 'Se ha trasladado a revisión la documentación aportada.',
        '01/20/AJUSTAT': 'Se ha trasladado a revisión la documentación aportada.',
        '01/21/ACTA': 'Se ha trasladado a revisión la documentación aportada.',

        '02/08/ESCREIX': 'Continua pendiente el pago del sobrecoste indicado en las condiciones - técnico económicas remitidas.',
    };

    const DATA_ROWS = [
        { tipo: '01', subtipo: '01', nombre: 'PART / REQ ORG CLIENT' },
        { tipo: '01', subtipo: '04', nombre: 'CES OC' },
        { tipo: '01', subtipo: '06', nombre: 'IE' },
        { tipo: '01', subtipo: '07', nombre: 'FASE OBRA / ANULAR / PTE ACT CLIENT' },
        { tipo: '01', subtipo: '19', nombre: 'CES' },
        { tipo: '01', subtipo: '18', nombre: 'OBRA CIVIL' },
        { tipo: '01', subtipo: '20', nombre: 'AJUSTAT' },
        { tipo: '01', subtipo: '21', nombre: 'ACTA' },
        { tipo: '02', subtipo: '08', nombre: 'ESCREIX' },

    ];

    // Nombre -> [textos]
    const RP_RULES_N = (() => {
        const m = new Map();
        for (const [k, v] of Object.entries(RP_RULES_3)) {
            const nombre = String(k).split('/').pop().trim();
            if (!nombre) continue;
            if (!m.has(nombre)) m.set(nombre, new Set());
            m.get(nombre).add(v);
        }
        const out = {};
        for (const [n, setTxt] of m.entries()) out[n] = Array.from(setTxt);
        return out;
    })();

    function getNombreOnlyOptions() {
        const explode = (nom) => (nom || '').split('/').map(s => s.trim()).filter(Boolean);
        const all = DATA_ROWS.flatMap(r => explode(r.nombre));
        return Array.from(new Set(all));
    }

    /* ========== Leer y escribir ========== */
    function* walkDeep(n){ if(!n) return; yield n;
                          const kids = n instanceof ShadowRoot || n instanceof DocumentFragment ? n.children : (n.children||[]);
                          for(const el of kids){ yield* walkDeep(el); if(el.shadowRoot) yield* walkDeep(el.shadowRoot); }
                         }
    function findDeep(pred){ for(const n of walkDeep(document)){ if(n instanceof Element && pred(n)) return n; } return null; }
    function qsDeep(sel){ return findDeep(el => el.matches?.(sel)); }
    function findByText(tagSel, re){ return findDeep(el => el.matches?.(tagSel) && re.test(el.textContent||'')); }

    function readNombreFromModal(modalRoot){
        const LABEL_RE = /nombre\s+del\s+pre-?requisito/i;
        let fieldContainer = null;
        for (const el of walkDeep(modalRoot)){
            if (!(el instanceof Element)) continue;
            const isLabel = el.matches?.('label, .slds-form-element__label, legend, lightning-formatted-text, span, div');
            if (isLabel && LABEL_RE.test((el.textContent||'').trim())){
                fieldContainer = el.closest?.('.slds-form-element') || el.parentElement || el;
                break;
            }
        }
        function extractValue(root){
            if (!root) return '';
            const f1 = findDeep(n => n instanceof Element && n.matches?.('lightning-base-combobox-formatted-text'));
            if (f1) return (f1.textContent||'').trim();
            const f2 = findDeep(n => n instanceof Element && n.matches?.('.slds-input_faux'));
            if (f2) return (f2.textContent||'').trim();
            const f3 = findDeep(n => n instanceof HTMLInputElement && (n.readOnly || n.getAttribute('role')==='combobox'));
            if (f3) return (f3.value||'').trim();
            const f4 = findDeep(n => n instanceof Element && (n.getAttribute?.('data-value') || n.getAttribute?.('aria-label')));
            if (f4) return (f4.getAttribute('data-value') || f4.getAttribute('aria-label') || '').trim();
            return '';
        }
        let val = '';
        if (fieldContainer) val = extractValue(fieldContainer);
        if (!val){
            for (const el of walkDeep(modalRoot)){
                if (el instanceof Element && (el.getAttribute('role')==='combobox' || el.matches?.('lightning-combobox'))){
                    const t = (el.textContent||'').trim();
                    if (t) { val = t; break; }
                }
            }
        }
        return (val||'').replace(/\s+/g,' ').trim();
    }
    function destroyPopover(){
        const pop = document.getElementById(POPOVER_ID);
        if (!pop) return;
        try { pop._cleanup && pop._cleanup(); } catch(_) {}
        pop.remove();
    }

    function writeToModal(modalRoot, plainText){
        let ed = null;
        for (const n of walkDeep(modalRoot||document)){
            if (n instanceof Element && n.matches?.('.ql-editor')) { ed = n; break; }
        }
        if (ed){
            const html = '<p>' + plainText.replace(/\n/g,'</p><p>') + '</p>';
            ed.innerHTML = html;
            ed.dispatchEvent(new InputEvent('input', { bubbles:true }));
            return true;
        }
        let ta = null;
        for (const n of walkDeep(modalRoot||document)){
            if (n instanceof Element && n.matches?.('textarea,[contenteditable="true"]')) { ta = n; break; }
        }
        if (ta){
            if ('value' in ta) ta.value = plainText; else ta.textContent = plainText;
            ta.dispatchEvent(new Event('input', { bubbles:true }));
            ta.dispatchEvent(new Event('change', { bubbles:true }));
            return true;
        }
        return false;
    }

    function writeNombreField(modalRoot, nombre){
        const LABEL_RE = /nombre\s+del\s+pre-?requisito/i;
        let field = null;
        for (const el of walkDeep(modalRoot)){
            if (el instanceof Element && LABEL_RE.test((el.textContent||'').trim())){
                field = el.closest?.('.slds-form-element') || el.parentElement || el;
                break;
            }
        }
        if (!field) return;
        for (const n of walkDeep(field)){
            if (n instanceof HTMLInputElement){
                n.value = nombre;
                n.dispatchEvent(new Event('input', {bubbles:true}));
                n.dispatchEvent(new Event('change', {bubbles:true}));
                return;
            }
            if (n instanceof Element && n.getAttribute?.('role') === 'combobox'){
                n.setAttribute('aria-label', nombre);
                n.setAttribute('data-value', nombre);
                n.dispatchEvent(new Event('change', {bubbles:true}));
                return;
            }
        }
    }

    /* ========== Ventana flotante ========== */
    const POPOVER_ID = 'rp-nombre-popover';
    const POPOVER_STYLE_ID = 'rp-nombre-popover-style';

    function parseRGBA(s){
        if(!s) return null;
        const m = s.match(/rgba?\s*\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)/i);
        if(!m) return null;
        return { r:+m[1], g:+m[2], b:+m[3], a: m[4]==null ? 1 : +m[4] };
    }

    function getEffectiveBg(el){
        let cur = el;
        while(cur){
            const cs = getComputedStyle(cur);
            const bg = cs.backgroundColor;
            const c = parseRGBA(bg);
            if(c && c.a > 0.01){ return bg; }
            cur = cur.parentElement || (cur.getRootNode && cur.getRootNode().host) || null;
        }
        const b1 = getComputedStyle(document.body).backgroundColor;
        const c1 = parseRGBA(b1);
        if(c1 && c1.a > 0.01) return b1;
        const b2 = getComputedStyle(document.documentElement).backgroundColor;
        return b2 || 'rgb(255,255,255)';
    }

    function luminanceFromRGBstr(rgbStr){
        const c = parseRGBA(rgbStr) || {r:255,g:255,b:255,a:1};
        const {r,g,b} = c;
        return (0.2126*r + 0.7152*g + 0.0722*b)/255;
    }

    function computePalette(baseEl){
        const eff = getEffectiveBg(baseEl || document.body);
        const lum = luminanceFromRGBstr(eff);
        const dark = lum < 0.42;
        return dark ? {
            bg:'#0f0f10', text:'#ffffff', border:'#333333',
            muted:'#bdbdbd', shadow:'0 12px 40px rgba(0,0,0,0.6)',
            btn:'#222222', btnText:'#ffffff', btnBorder:'#444444', accent:'#22c55e'
        } : {
            bg:'#ffffff', text:'#111111', border:'#d9d9de',
            muted:'#61636b', shadow:'0 12px 40px rgba(0,0,0,0.15)',
            btn:'#f6f6f9', btnText:'#111111', btnBorder:'#d9d9de', accent:'#22c55e'
        };
    }

    function ensurePopover(modalRoot){
        let style = document.getElementById(POPOVER_STYLE_ID);


        if(!style){
            style = document.createElement('style');
            style.id = POPOVER_STYLE_ID;
            style.textContent = `
#${POPOVER_ID}{
  --bg:#111; --text:#fff; --border:#333; --shadow:0 12px 40px rgba(0,0,0,.6);
  --btn:#222; --btnText:#fff; --btnBorder:#444; --accent:#22c55e;
  position: fixed; z-index: 2147483647; width: 320px; max-height: 420px;
  background: var(--bg); color: var(--text); border:1px solid var(--border);
  border-radius: 10px; box-shadow: var(--shadow); padding:10px; overflow:auto;
  font: 13px/1.35 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
}
#${POPOVER_ID} .rp-title{ font-weight:700; margin-bottom:8px; }
#${POPOVER_ID} .rp-grid{ display:grid; grid-template-columns:1fr 1fr; gap:6px; }
#${POPOVER_ID} .chip{
  padding:8px 10px; border:1px solid var(--btnBorder); border-radius:8px; cursor:pointer;
  background: var(--btn); color: var(--btnText);
}
#${POPOVER_ID} .chip:hover{ outline: 2px solid var(--accent); }
`;
            document.head.appendChild(style);
        }

        let pop = document.getElementById(POPOVER_ID);
        if (!pop){
            pop = document.createElement('div');
            pop.id = POPOVER_ID;
            pop.innerHTML = `
        <div class="rp-title">Selección del Pre-requisito</div>
        <div class="rp-grid" id="rp-grid"></div>
      `;
            document.body.appendChild(pop);

            // Condición de cierre
            const onDocDown = (e)=>{ if (pop && !pop.contains(e.target)) destroyPopover(); };
            const onEsc = (e)=>{ if (e.key === 'Escape') destroyPopover(); };
            document.addEventListener('mousedown', onDocDown, true);
            document.addEventListener('keydown', onEsc, true);
            pop._cleanup = ()=> {
                document.removeEventListener('mousedown', onDocDown, true);
                document.removeEventListener('keydown', onEsc, true);
            };

            // orden abc
            const grid = pop.querySelector('#rp-grid');
            grid.innerHTML = '';

            const names = getNombreOnlyOptions()
            .slice()
            .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));

            names.forEach(n => {
                const d = document.createElement('div');
                d.className = 'chip';
                d.textContent = n;
                d.onclick = () => onPickNombre(n, modalRoot);
                grid.appendChild(d);
            });

        }
        return pop;
    }

    function applyPopoverTheme(pop, baseEl){
        const p = computePalette(baseEl);
        pop.style.setProperty('--bg', p.bg);
        pop.style.setProperty('--text', p.text);
        pop.style.setProperty('--border', p.border);
        pop.style.setProperty('--shadow', p.shadow);
        pop.style.setProperty('--btn', p.btn);
        pop.style.setProperty('--btnText', p.btnText);
        pop.style.setProperty('--btnBorder', p.btnBorder);
        pop.style.setProperty('--accent', p.accent);
    }

    function showPopoverAt(modalRoot, anchorEl){
        // cerrar flotante
        destroyPopover();
        const pop = ensurePopover(modalRoot);
        const editorBgEl = (modalRoot && modalRoot.querySelector?.('.ql-editor')) || anchorEl || modalRoot || document.body;
        applyPopoverTheme(pop, editorBgEl);

        const r = (anchorEl || pop).getBoundingClientRect();
        const top = Math.max(8, r.top - 8);
        const left = Math.min(window.innerWidth - 340, r.right + 8);
        pop.style.top = `${top}px`;
        pop.style.left = `${left}px`;
        pop.style.display = 'block';

        const current = readNombreFromModal(modalRoot);
        if (current) {
            for (const el of pop.querySelectorAll('.chip')) {
                el.style.outline = (el.textContent.trim().toLowerCase() === current.toLowerCase()) ? '2px solid var(--accent)' : 'none';
            }
        }
    }

    function hidePopover(){
        const pop = document.getElementById(POPOVER_ID);
        if (pop) pop.style.display = 'none';
    }

    function onPickNombre(nombre, modalRootHint){
        const root = getReabrirModalRoot() || modalRootHint || document;
        writeNombreField(root, nombre); 
        const variants = RP_RULES_N[nombre] || [];
        const text = variants[0] || '';
        if (text) writeToModal(root, text);
        destroyPopover();
    }

    /* ========== detectar campo de texto ========== */
    const MODAL_H2_RE = /reabrir\s+el\s+pre-?requisito/i;

    function getReabrirModalRoot(){
        const header = findByText('h2', MODAL_H2_RE);
        if (!header) return null;
        const dlg = header.closest?.('lightning-quick-action-panel')
        || header.closest?.('[role="dialog"]')
        || qsDeep('lightning-quick-action-panel')
        || qsDeep('[role="dialog"]')
        || header;
        if (!dlg) return null;
        const rect = dlg.getBoundingClientRect();
        if (!(rect.width > 0 && rect.height > 0)) return null;

        for (const n of walkDeep(dlg)){
            if (n instanceof Element && (n.matches?.('.ql-editor') || n.matches?.('lightning-input-rich-text, textarea,[contenteditable="true"]'))){
                return dlg;
            }
        }
        return null;
    }

    function bindEditorPopover(modalRoot){
        if (!modalRoot) return;
        // buscar editor texto
        let editorEl = null;
        for (const n of walkDeep(modalRoot)){
            if (n instanceof Element &&
                (n.matches?.('.ql-editor') || n.matches?.('lightning-input-rich-text, [contenteditable="true"]'))){
                editorEl = n; break;
            }
        }
        if (!editorEl) return;

        const container =
              editorEl.closest?.('[role="group"], .slds-form-element, .ql-container') || editorEl;
        if (!container || container._rpPopoverBound) return;
        container._rpPopoverBound = true;

        // Mostrar flotante al detectar editor
        container.addEventListener('focusin', ()=>{
            const anchor = container.querySelector?.('.ql-toolbar') || editorEl;
            if (anchor) showPopoverAt(modalRoot, anchor);
        });
    }

    // Observar los cambios de página y enlazarlos cuando aparece un cuadro de diálogo; ocultar la ventana flotante cuando se cierra el cuadro de diálogo
    (function watch(){
        let deb = null;
        const obs = new MutationObserver(()=>{
            clearTimeout(deb);
            deb = setTimeout(()=>{
                const modalRoot = getReabrirModalRoot();
                if (!modalRoot){
                    hidePopover();
                    return;
                }
                bindEditorPopover(modalRoot);
            }, 120);
        });
        obs.observe(document.documentElement, { childList:true, subtree:true });

        //Contraer la ventana flotante cuando cambia la ruta
        let lastHref = location.href;
        setInterval(()=>{
            if (location.href !== lastHref){
                lastHref = location.href;
                hidePopover();
            }
        }, 800);
    })();

})();

