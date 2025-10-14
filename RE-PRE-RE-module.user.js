// ==UserScript==
// @name         RE-PRE-RE (module)
// @namespace    https://accesosede.my.salesforce.com/
// @description  Selector Tipo/Subtipo/Nombre con lectura automática del “Nombre del Pre-requisito”, búsqueda y plantillas. Tema claro/oscuro automático. Sin clics ni APIs.
// @match        https://*.lightning.force.com/*
// @match        https://*.salesforce.com/*
// @version      1.5.1
// @grant        none
// @require      https://cdn.jsdelivr.net/gh/JTL-ED/auto-pre-re-codes@main/utils.user.js
// @updateURL    https://raw.githubusercontent.com/JTL-ED/auto-pre-re-codes/main/RE-PRE-RE-module.user.js
// @downloadURL  https://raw.githubusercontent.com/JTL-ED/auto-pre-re-codes/main/RE-PRE-RE-module.user.js
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';
  const U = window.__SF_UTILS__; if (!U) return;

  // 这些变量用于 dispose() 清理
  let moTheme = null; // 主题观察器
  let moMain = null; // 主 MutationObserver（替代 watchReabrir 自执行）
  let urlTick = null; // setInterval 计时器（替代 watchReabrir 内的定时检测）
  let hotkeyHandler = null; // 键盘处理函数（替代 hotkey 自执行）
  let mq = null; // matchMedia 监听器

  // ─────────────────────────────────────────
  // 👉 BLOCK A【粘贴“主题函数 + 常量”，不粘调用与监听】
  // 从：/* ========== Tema: claro/oscuro (auto) ========== */
  // 到（且仅到）：detectThemeAndApply 函数定义结束
  // ⚠️ 不要粘下面这三段“立即执行/监听”的代码：
  //   detectThemeAndApply();
  //   const moTheme = new MutationObserver(...);
  //   if (window.matchMedia) { ... addEventListener ... }
  // ─────────────────────────────────────────

  /* ========== Tema: claro/oscuro (auto) ========== */
  const THEME_STYLE_ID = 'rp-theme-vars-style';
  const FORCE_THEME = null; // 'light' | 'dark' | null (auto)

  function installThemeStyle() {
    let tag = document.getElementById(THEME_STYLE_ID);
    if (!tag) {
      tag = document.createElement('style');
      tag.id = THEME_STYLE_ID;
      document.head.appendChild(tag);
    }
    tag.textContent = `
/* Oscuro por defecto */
:root {
  --rp-bg: #0f0f10;
  --rp-text: #ffffff;
  --rp-border: #333333;
  --rp-muted: #bdbdbd;
  --rp-shadow: 0 12px 40px rgba(0,0,0,0.6);
  --rp-btn: #222222;
  --rp-btn-text: #ffffff;
  --rp-btn-border: #444444;
  --rp-accent: #22c55e;
  --rp-accent-text: #111111;
  --rp-list-hover: #222222;
  --rp-list-selected: #2a4f2b;
  --rp-panel-width: 460px;
  --rp-list-height: 320px;
  color-scheme: dark;
}

/* Modo claro forzado por clase */
:root.rp-theme-light {
  --rp-bg: #ffffff;
  --rp-text: #111111;
  --rp-border: #d9d9de;
  --rp-muted: #61636b;
  --rp-shadow: 0 12px 40px rgba(0,0,0,0.15);
  --rp-btn: #f6f6f9;
  --rp-btn-text: #111111;
  --rp-btn-border: #d9d9de;
  --rp-accent: #22c55e;
  --rp-accent-text: #0a0a0a;
  --rp-list-hover: #f0f0f5;
  --rp-list-selected: #e7f7ea;
  color-scheme: light;
}

/* Si no hay clase forzada, respeta preferencia del SO */
@media (prefers-color-scheme: light) {
  :root:not(.rp-theme-dark):not(.rp-theme-light) {
    --rp-bg: #ffffff;
    --rp-text: #111111;
    --rp-border: #d9d9de;
    --rp-muted: #61636b;
    --rp-shadow: 0 12px 40px rgba(0,0,0,0.15);
    --rp-btn: #f6f6f9;
    --rp-btn-text: #111111;
    --rp-btn-border: #d9d9de;
    --rp-accent: #22c55e;
    --rp-accent-text: #0a0a0a;
    --rp-list-hover: #f0f0f5;
    --rp-list-selected: #e7f7ea;
    color-scheme: light;
  }
}

/* Panel */
#rp-panel-chooser {
  position: fixed;
  left: 50%; top: 50%; transform: translate(-50%, -50%);
  z-index: 2147483647;
  width: var(--rp-panel-width);
  background: var(--rp-bg);
  color: var(--rp-text);
  border: 1px solid var(--rp-border);
  border-radius: 12px;
  box-shadow: var(--rp-shadow);
  font: 13px/1.35 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
}
#rp-panel-chooser .rp-header {
  padding: 10px 12px;
  font-weight: 700;
  border-bottom: 1px solid var(--rp-border);
}
#rp-panel-chooser .rp-body {
  padding: 12px;
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}
#rp-panel-chooser .rp-msg { min-height: 16px; color: var(--rp-muted); }

/* Botones */
.rp-btn {
  padding: 8px 10px;
  border: 1px solid var(--rp-btn-border);
  border-radius: 8px;
  background: var(--rp-btn);
  color: var(--rp-btn-text);
  cursor: pointer;
}
.rp-btn[disabled]{ opacity: .6; cursor: default; }
.rp-btn-primary{ background: var(--rp-accent); color: var(--rp-accent-text); border-color: transparent; font-weight: 700; }

/* Select (sin paginador) */
.rp-select { position: relative; }
.rp-select-btn {
  width: 100%; text-align: left;
  padding: 8px 28px 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--rp-btn-border);
  background: var(--rp-btn);
  color: var(--rp-btn-text);
  cursor: pointer;
  position: relative;
}
.rp-caret {
  position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
  border-left:5px solid transparent; border-right:5px solid transparent; border-top:6px solid currentColor; opacity:.7;
}
.rp-menu {
  display: none;
  position: absolute; left:0; right:0; top: calc(100% + 6px);
  background: var(--rp-bg); color: var(--rp-text);
  border: 1px solid var(--rp-border);
  border-radius: 8px; box-shadow: var(--rp-shadow);
  z-index: 2147483647;
}
.rp-search {
  width: 100%; box-sizing: border-box; padding: 8px;
  border: 0; border-bottom: 1px solid var(--rp-border);
  background: var(--rp-btn); color: var(--rp-text);
  border-radius: 8px 8px 0 0;
}
.rp-listwrap { max-height: var(--rp-list-height); overflow: hidden; }
.rp-list { max-height: var(--rp-list-height); overflow: auto; }
.rp-item { padding: 8px 10px; cursor: pointer; }
.rp-item:hover { background: var(--rp-list-hover); }
.rp-item.rp-selected { background: var(--rp-list-selected); }
`;
  }

  function detectThemeAndApply() {
    installThemeStyle();
    const root = document.documentElement;

    if (FORCE_THEME === 'light') {
      root.classList.add('rp-theme-light');
      root.classList.remove('rp-theme-dark');
      return;
    }
    if (FORCE_THEME === 'dark') {
      root.classList.add('rp-theme-dark');
      root.classList.remove('rp-theme-light');
      return;
    }
    // Automático por luminosidad del body (evita desajustes con Lightning)
    const bg = getComputedStyle(document.body).backgroundColor || 'rgb(255,255,255)';
    const rgb = bg.match(/\d+/g)?.map(Number) || [255,255,255];
    const [r,g,b] = rgb;
    const lum = (0.2126*r + 0.7152*g + 0.0722*b)/255;
    if (lum >= 0.8) { root.classList.add('rp-theme-light'); root.classList.remove('rp-theme-dark'); }
    else if (lum <= 0.25) { root.classList.add('rp-theme-dark'); root.classList.remove('rp-theme-light'); }
    else { root.classList.remove('rp-theme-light'); root.classList.remove('rp-theme-dark'); }
  }

  // ─────────────────────────────────────────
  // 👉 BLOCK B【粘贴“规则与数据”】
  // 从：/* ========== Reglas de comunicación ========== */
  // 到并包含：MODAL_H2_RE
  // ─────────────────────────────────────────
  /* ========== Reglas de comunicación ========== */
  const RP_RULES_3 = {
    'Pendiente acciones cliente (Requisito)/Presentación de Documentación/PART': 'Es necesario continuar con la gestion de obtención de los permisos de terceros afectados.',
    'Pendiente acciones cliente (Requisito)/Presentación de Documentación/REQ ORG CLIENT': 'Se ha trasladado a revisión la documentación aportada.',
    'Pendiente acciones cliente (Requisito)/Defectos en instalación del cliente: tierras, candados, tubos, peanas/CES OC': 'Continuamos con la gestión de los documentos de cesión.',
    'Pendiente acciones cliente (Requisito)/Acceso a instalación/ACCESO': 'Se requiere facilitar acceso a la instalación para poder realizar las actuaciones pendientes.',
    'Pendiente acciones cliente (Requisito)/Cesión local/terreno para instalación de distribución/CESIÓN': 'Queda pendiente la cesión del local/terreno para la instalación de distribución. Es necesario formalizar la cesión para continuar.',
    'Pendiente acciones cliente (Requisito)/Finalización de instalaciones de cliente con aportación de fotografías de Seccionamiento/CGP/IE': 'Se ha trasladado a revisión la documentación aportada.',
    'Pendiente acciones cliente (Requisito)/Otros/FASE OBRA': 'El complimentarà sempre el tècnic d’E&P, d’acord amb les indicacions del tècnic de la UT.',
    'Pendiente acciones cliente (Requisito)/Otros/ANULAR': 'Proceso de anulación en curso.',
    'Pendiente acciones cliente (Requisito)/Otros/PTE ACT CLIENT': 'La gestión del expediente continua suspendida a la espera de la aportación por su parte de los documentos que se le han requerido.',
    'Pendiente acciones cliente (Requisito)/Trámites de cesión/CES': 'Se ha trasladado a revisión la documentación aportada.',
    'Pendiente acciones cliente (Requisito)/Pendiente de entrega del justificante de pago/PAGO': 'Pendiente aportar el justificante de pago. Adjuntar el comprobante para proseguir con la gestión.',
    'Pendiente acciones cliente (Requisito)/Pendiente ejecución/legalización instalaciones particulares/OBRA CIVIL': 'Se ha trasladado a revisión la documentación aportada.',
    'Pendiente acciones cliente (Requisito)/Revisión proyecto cesión cliente (ajustado)/AJUSTAT': 'Se ha trasladado a revisión la documentación aportada.',
    'Pendiente acciones cliente (Requisito)/Acta del lanzamiento obra cesión/ACTA': 'Se ha trasladado a revisión la documentación aportada.',
    'Pago pendiente del cliente (Requisito)/Pago pendiente cliente/ESCREIX': 'Continua pendiente el pago del sobrecoste indicado en las condiciones - técnico econòmicas remitidas.'
  };
  const RP_RULES_2 = {
    'Pendiente acciones cliente (Requisito)/Presentación de Documentación': '--.',
    'Pendiente acciones cliente (Requisito)/Acceso a instalación':  '--.',
    'Pendiente acciones cliente (Requisito)/Trámites de cesión':  '--.',
    'Pendiente acciones cliente (Requisito)/Pendiente ejecución/legalización instalaciones particulares': '--.',
    'Pago pendiente del cliente (Requisito)/Pago pendiente cliente':  '--.',
  };

  /* ========== Datos ========== */
  const DATA_ROWS = [
    { tipo:'Pendiente acciones cliente (Requisito)', subtipo:'Presentación de Documentación', nombre:'PART / REQ ORG CLIENT' },
    { tipo:'Pendiente acciones cliente (Requisito)', subtipo:'Defectos en instalación del cliente: tierras, candados, tubos, peanas', nombre:'CES OC' },
    { tipo:'Pendiente acciones cliente (Requisito)', subtipo:'Acceso a instalación', nombre:'ACCESO' },
    { tipo:'Pendiente acciones cliente (Requisito)', subtipo:'Cesión local/terreno para instalación de distribución', nombre:'CESIÓN' },
    { tipo:'Pendiente acciones cliente (Requisito)', subtipo:'Finalización de instalaciones de cliente con aportación de fotografías de Seccionamiento/CGP', nombre:'IE' },
    { tipo:'Pendiente acciones cliente (Requisito)', subtipo:'Otros', nombre:'FASE OBRA / ANULAR / PTE ACT CLIENT' },
    { tipo:'Pendiente acciones cliente (Requisito)', subtipo:'Trámites de cesión', nombre:'CES' },
    { tipo:'Pendiente acciones cliente (Requisito)', subtipo:'Pendiente de entrega del justificante de pago', nombre:'PAGO' },
    { tipo:'Pendiente acciones cliente (Requisito)', subtipo:'Pendiente ejecución/legalización instalaciones particulares', nombre:'OBRA CIVIL' },
    { tipo:'Pendiente acciones cliente (Requisito)', subtipo:'Revisión proyecto cesión cliente (ajustado)', nombre:'AJUSTAT' },
    { tipo:'Pendiente acciones cliente (Requisito)', subtipo:'Acta del lanzamiento obra cesión', nombre:'ACTA' },
    { tipo:'Pago pendiente del cliente (Requisito)', subtipo:'Pago pendiente cliente', nombre:'ESCREIX' }
  ];
  const MODAL_H2_RE = /reabrir\s+el\s+pre-?requisito/i;

  // ─────────────────────────────────────────
  // 👉 BLOCK C【粘贴“深层 DOM 工具 + 选项生成工具”】
  // 从：/* ========== Utils deep DOM ========== */
  // 到并包含：getNombreOptions()
  // ─────────────────────────────────────────

  /* ========== Utils deep DOM ========== */
  function* walkDeep(n){ if(!n) return; yield n;
    const kids = n instanceof ShadowRoot || n instanceof DocumentFragment ? n.children : (n.children||[]);
    for(const el of kids){ yield* walkDeep(el); if(el.shadowRoot) yield* walkDeep(el.shadowRoot); }
  }
  function findDeep(pred){ for(const n of walkDeep(document)){ if(n instanceof Element && pred(n)) return n; } return null; }
  function qsDeep(sel){ return findDeep(el => el.matches?.(sel)); }
  function findByText(tagSel, re){ return findDeep(el => el.matches?.(tagSel) && re.test(el.textContent||'')); }
  const unique = (a)=> Array.from(new Set(a));

  /* ========== Opciones ========== */
  function getTipoOptions(){ return unique(DATA_ROWS.map(r=>r.tipo).filter(Boolean)); }
  function getSubtipoOptions(tipo){
    return unique(DATA_ROWS.filter(r=>!tipo || r.tipo===tipo).map(r=>r.subtipo).filter(Boolean));
  }
  function getNombreOptions(tipo, subtipo){
    const rows = DATA_ROWS.filter(r => (!tipo || r.tipo===tipo) && (!subtipo || r.subtipo===subtipo));
    const explode = (nom)=>(nom||'').split('/').map(s=>s.trim()).filter(s=>s && s!=='-');
    const exploded = rows.flatMap(r => explode(r.nombre));
    const singles = rows.map(r => (r.nombre||'').trim()).filter(n => n && n!=='-' && !n.includes('/'));
    return unique([...exploded, ...singles]);
  }

  // ─────────────────────────────────────────
  // 👉 BLOCK D【粘贴“读写编辑器/下拉组件”】
  // 从：/* ========== Leer “Nombre del Pre-requisito” del modal ========== */
  // 到并包含：createDropdown()
  // ─────────────────────────────────────────

/* ========== Leer “Nombre del Pre-requisito” del modal ========== */
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

  /* ========== Escribir en editor ========== */
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

  /* ========== Dropdown sin paginador ========== */
  function createDropdown({placeholder, options=[], onChange}){
    const root = document.createElement('div');
    root.className = 'rp-select';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rp-select-btn';
    btn.innerHTML = `<span class="rp-select-label" style="opacity:.9">${placeholder||''}</span>
                     <span class="rp-caret"></span>`;

    const menu = document.createElement('div');
    menu.className = 'rp-menu';

    const search = document.createElement('input');
    search.type = 'text';
    search.placeholder = 'Buscar...';
    search.className = 'rp-search';

    const listWrap = document.createElement('div');
    listWrap.className = 'rp-listwrap';

    const list = document.createElement('div');
    list.className = 'rp-list';

    menu.appendChild(search);
    menu.appendChild(listWrap);
    listWrap.appendChild(list);

    root.appendChild(btn);
    root.appendChild(menu);

    let all = options.slice();
    let filtered = all.slice();
    let selectedValue = '';
    let disabled = false;

    function render(){
      list.innerHTML = '';
      filtered.forEach((opt)=>{
        const item = document.createElement('div');
        item.textContent = opt;
        item.tabIndex = 0;
        item.className = 'rp-item' + (opt===selectedValue ? ' rp-selected' : '');
        item.onclick = ()=>{
          if (disabled) return;
          selectedValue = opt;
          btn.querySelector('.rp-select-label').textContent = opt;
          hide();
          onChange && onChange(opt);
        };
        list.appendChild(item);
      });
    }

    function show(){ if(disabled) return; menu.style.display = 'block'; search.focus(); render(); }
    function hide(){ menu.style.display = 'none'; }

    btn.onclick = (e)=>{ e.stopPropagation(); menu.style.display==='none' ? show() : hide(); };

    search.oninput = ()=>{
      const q = search.value.trim().toLowerCase();
      filtered = !q ? all.slice() : all.filter(v => v.toLowerCase().includes(q));
      render();
    };

    menu.addEventListener('keydown', (e)=>{
      if(e.key==='Escape'){ hide(); btn.focus(); }
      if(e.key==='Enter'){
        const first = filtered[0];
        if (first && !disabled){
          selectedValue = first;
          btn.querySelector('.rp-select-label').textContent = first;
          hide();
          onChange && onChange(first);
        }
      }
    });

    document.addEventListener('click', (e)=>{ if(!root.contains(e.target)) hide(); }, true);

    return {
      el: root,
      setOptions(listArr){
        all = listArr.slice();
        filtered = all.slice();
        selectedValue = '';
        btn.querySelector('.rp-select-label').textContent = placeholder||'';
        render();
      },
      setValue(val){
        selectedValue = val || '';
        btn.querySelector('.rp-select-label').textContent = selectedValue || (placeholder||'');
      },
      getValue(){ return selectedValue; },
      open(){ show(); },
      close(){ hide(); },
      setDisabled(v){
        disabled = !!v;
        btn.disabled = disabled;
        btn.style.opacity = disabled ? '.6' : '1';
        if (disabled) hide();
      }
    };
  }

  // ─────────────────────────────────────────
  // 👉 BLOCK E【粘贴“面板 + 逻辑 + 加锁”】
  // 从：/* ========== Panel + lógica ========== */
  // 到并包含：showPanel(modalRoot)
  // ─────────────────────────────────────────

  /* ========== Panel + lógica ========== */
  const modalLocks = new WeakMap(); // modalRoot -> {locked:true, reason:'manual-close'|'inserted'}
  let rpSuppressUntil = 0; // supresión temporal tras cerrar/insertar

  function isModalLocked(modalRoot){ const s = modalLocks.get(modalRoot); return !!(s && s.locked); }
  function lockModal(modalRoot, reason){ modalLocks.set(modalRoot, { locked:true, reason: reason||'' }); }

  function showPanel(modalRoot){
    if (!modalRoot || isModalLocked(modalRoot)) return;
    if (Date.now() < rpSuppressUntil) return;
    if (document.getElementById('rp-panel-chooser')) return;

    const wrap = document.createElement('div');
    wrap.id = 'rp-panel-chooser';
    wrap.innerHTML = `
      <div class="rp-header">Reabrir · Selección</div>
      <div class="rp-body">
        <div>
          <div style="margin-bottom:6px; opacity:.85;">Tipo</div>
          <div id="rp-tipo"></div>
        </div>
        <div>
          <div style="margin-bottom:6px; opacity:.85;">Subtipo</div>
          <div id="rp-subtipo"></div>
        </div>
        <div>
          <div style="margin-bottom:6px; opacity:.85;">Nombre del Pre-requisito</div>
          <div id="rp-nombre"></div>
        </div>
        <div id="rp-msg" class="rp-msg"></div>
        <div style="display:flex; gap:8px;">
          <button id="rp-insert" class="rp-btn rp-btn-primary" style="flex:1;">Insertar</button>
          <button id="rp-close"  class="rp-btn">Cerrar</button>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);

    const setMsg = (t,c)=>{ const m=wrap.querySelector('#rp-msg'); m.textContent=t; if(c) m.style.color=c; };

    const tipoDD = createDropdown({ placeholder:'Selecciona Tipo', options:getTipoOptions(), onChange: onTipoChange });
    const subtipoDD = createDropdown({ placeholder:'Selecciona Subtipo', options:[], onChange: onSubtipoChange });
    const nombreDD = createDropdown({ placeholder:'Selecciona Nombre', options:[], onChange: ()=>setMsg('') });

    wrap.querySelector('#rp-tipo').appendChild(tipoDD.el);
    wrap.querySelector('#rp-subtipo').appendChild(subtipoDD.el);
    wrap.querySelector('#rp-nombre').appendChild(nombreDD.el);

    function autoPickNombre(){
      const tipo = tipoDD.getValue();
      const subtipo = subtipoDD.getValue();
      const opts = getNombreOptions(tipo, subtipo);
      nombreDD.setOptions(opts);

      const uiVal = readNombreFromModal(modalRoot);
      function norm(s){ return (s||'').toLowerCase().replace(/\s+/g,' ').trim(); }
      const nOpts = opts.map(norm);
      const uNorm = norm(uiVal);

      let matched = -1;
      if (uNorm){
        matched = nOpts.indexOf(uNorm);
        if (matched < 0) matched = nOpts.findIndex(o => o.includes(uNorm) || uNorm.includes(o));
      }

      if (matched >= 0){
        nombreDD.setValue(opts[matched]); nombreDD.setDisabled(true);
        setMsg(`Nombre detectado automáticamente: "${opts[matched]}".`);
      } else if (opts.length === 1){
        nombreDD.setValue(opts[0]); nombreDD.setDisabled(true);
        setMsg(`Nombre único disponible seleccionado automáticamente: "${opts[0]}".`);
      } else {
        nombreDD.setValue(''); nombreDD.setDisabled(false);
        setMsg(opts.length ? 'Selecciona el Nombre.' : 'No hay opciones de Nombre para esta combinación.', opts.length ? '' : '#f87171');
      }
    }

    function onTipoChange(){
      const subs = getSubtipoOptions(tipoDD.getValue());
      subtipoDD.setOptions(subs);
      nombreDD.setOptions([]); nombreDD.setDisabled(true);
      setMsg('');
    }
    function onSubtipoChange(){ autoPickNombre(); }

    // Inicial
    tipoDD.setOptions(getTipoOptions());

    // Cerrar (manual) -> bloquear + supresión breve
    wrap.querySelector('#rp-close').onclick = ()=>{
      lockModal(modalRoot, 'manual-close');
      rpSuppressUntil = Date.now() + 1500;
      wrap.remove();
    };

    // Insertar -> cierre optimista SIEMPRE
    wrap.querySelector('#rp-insert').onclick = ()=>{
      const tipo = tipoDD.getValue();
      const subtipo = subtipoDD.getValue();
      const nombre = nombreDD.getValue() || '';

      if (!tipo || !subtipo){
        setMsg('Selecciona Tipo y Subtipo antes de insertar.', '#f87171');
        return;
      }

      const key3 = `${tipo}/${subtipo}/${nombre}`;
      const key2 = `${tipo}/${subtipo}`;
      const text = RP_RULES_3[key3] ?? RP_RULES_2[key2] ?? '';

      if (!text){
        setMsg(`No hay texto configurado para:\n${key3}\nAñade la regla en RP_RULES_3 o RP_RULES_2 y vuelve a intentar.`, '#f87171');
        return;
      }

      const modalRoot2 = getReabrirModalRoot() || modalRoot;
      // Intento de escritura
      try { writeToModal(modalRoot2, text); } catch(e){ /* noop */ }

      // Cierre optimista + bloqueo
      lockModal(modalRoot2, 'inserted');
      rpSuppressUntil = Date.now() + 1500;
      wrap.remove();
    };
  }

  // ─────────────────────────────────────────
  // 👉 BLOCK F【粘贴“检测 Reabrir 对话框”】
  // 从：/* ========== Detección robusta del modal ========== */
  // 到并包含：getReabrirModalRoot()
  // ─────────────────────────────────────────

  /* ========== Detección robusta del modal ========== */
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
    const visible = rect.width > 0 && rect.height > 0;
    if (!visible) return null;

    let hasEditor = false;
    for (const n of walkDeep(dlg)){
      if (n instanceof Element && (n.matches?.('.ql-editor') || n.matches?.('lightning-input-rich-text, textarea,[contenteditable="true"]'))){
        hasEditor = true; break;
      }
    }
    if (!hasEditor) return null;

    return dlg;
  }


  // 路由匹配：仅在“Reabrir el Pre-requisito”对话框相关页面启用
  const matchReabrir = (href, doc) =>
    /actionName=Reabrir/i.test(href) ||
    /reabrir\s+el\s+pre-?requisito/i.test(doc?.innerText || '');

  // 统一注册为模块，由 utils 调度
  U.register({
    name: 'RE-PRE-RE',
    match: matchReabrir,

    init() {
      console.log('[RE-PRE-RE] init');

      // 1) 主题：调用 + 监听（这是你原先“主题自执行”的迁移位置）
      if (typeof detectThemeAndApply === 'function') {
        detectThemeAndApply();
        moTheme = new MutationObserver(() => detectThemeAndApply());
        moTheme.observe(document.documentElement, { attributes:true, attributeFilter:['class','style'] });

        if (window.matchMedia) {
          mq = window.matchMedia('(prefers-color-scheme: dark)');
          // 兼容 addEventListener/addListener
          mq.addEventListener?.('change', detectThemeAndApply);
          mq.addListener?.(detectThemeAndApply);
        }
      }

      // 2) 主观察器（这是你原来 IIFE: watchReabrir() 的迁移位置）
      //    👉 把 watchReabrir() 里面“MutationObserver 的回调 & 防抖 + showPanel 条件逻辑”
      //       的内部主体复制到下面 debounced 回调里（我帮你留了形状一致的框架）。
      let deb = null;
      moMain = new MutationObserver(() => {
        clearTimeout(deb);
        deb = setTimeout(() => {
          // ===== PASTE：把 watchReabrir() 里 setTimeout 的内部逻辑搬到这里 =====
          // 参考你原来的：
          // const modalRoot = getReabrirModalRoot();
          // if (!modalRoot) { document.getElementById('rp-panel-chooser')?.remove(); return; }
          // if (isModalLocked(modalRoot)) return;
          // if (Date.now() < rpSuppressUntil) return;
          // if (!document.getElementById('rp-panel-chooser')) { showPanel(modalRoot); }
          // ===========================================================
          const modalRoot = getReabrirModalRoot();
          if (!modalRoot) {
            document.getElementById('rp-panel-chooser')?.remove();
            return;
          }
          if (isModalLocked(modalRoot)) return;
          if (Date.now() < rpSuppressUntil) return;

          if (!document.getElementById('rp-panel-chooser')) {
            showPanel(modalRoot);
          }
        }, 120);
      });
      moMain.observe(document.documentElement, { childList:true, subtree:true });

        // 3) URL 变化/可见性检测（把 watchReabrir() 里的 setInterval 迁移过来）
        let lastHref = location.href;
        urlTick = setInterval(() => {
            // URL 变化：移除面板
            if (location.href !== lastHref) {
                lastHref = location.href;
                document.getElementById('rp-panel-chooser')?.remove();
            }
            // 有面板但 modal 不在：移除面板
            if (document.getElementById('rp-panel-chooser') && !getReabrirModalRoot()) {
                document.getElementById('rp-panel-chooser')?.remove();
            }
        }, 800);


      // 4) 热键（把 hotkey() IIFE 里的内容迁移到监听器里，记得保存 handler 引用以便清理）
      hotkeyHandler = (e) => {
        if (e.ctrlKey && e.altKey && (e.key === 'r' || e.key === 'R')) {
          const modalRoot = getReabrirModalRoot();
          if (modalRoot && !isModalLocked(modalRoot) && Date.now() >= rpSuppressUntil) {
            if (!document.getElementById('rp-panel-chooser')) showPanel(modalRoot);
          } else {
            console.warn('No se detecta el diálogo o está bloqueado/temporalmente suprimido.');
          }
        }
        // 也可以顺便接管 Esc 关闭面板（当没有 modal）
        if (e.key === 'Escape' && !getReabrirModalRoot()) {
          document.getElementById('rp-panel-chooser')?.remove();
        }
      };
      document.addEventListener('keydown', hotkeyHandler, true);
    },

      dispose() {
      console.log('[RE-PRE-RE] dispose');

      // 清理面板
      document.getElementById('rp-panel-chooser')?.remove();

      // 断开观察器
      try { moMain && moMain.disconnect(); } catch(e) {}
      moMain = null;

      try { moTheme && moTheme.disconnect(); } catch(e) {}
      moTheme = null;

      // 清理定时器
      if (urlTick) { clearInterval(urlTick); urlTick = null; }

      // 移除键盘监听
      if (hotkeyHandler) {
        document.removeEventListener('keydown', hotkeyHandler, true);
        hotkeyHandler = null;
      }

      // 取消 matchMedia 监听
      if (mq) {
        try { mq.removeEventListener?.('change', detectThemeAndApply); } catch(e){}
        try { mq.removeListener?.(detectThemeAndApply); } catch(e){}
        mq = null;
      }
    }
  });

  // 由任一脚本调用一次即可；重复调用也安全
  U.boot();
})();