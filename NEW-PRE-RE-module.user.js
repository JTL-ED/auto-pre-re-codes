// ==UserScript==
// @name         NEW-PRE-RE (module)
// @namespace    https://your-space.example
// @version      1.0.3
// @description  Relleno/limpieza automática de "Nombre del Pre-requisito" y "Comunicación al cliente (push)" según Tipo/Subtipo, con modal en 01/01 y 01/07; limpieza al cambiar Tipo.
// @match        https://*.lightning.force.com/*
// @match        https://*.salesforce.com/*
// @run-at       document-idle
// @grant        none
// @require      https://cdn.jsdelivr.net/gh/JTL-ED/auto-pre-re-codes@main/utils.user.js
// @updateURL    https://raw.githubusercontent.com/JTL-ED/auto-pre-re-codes/main/NEW-PRE-RE-module.js
// @downloadURL  https://raw.githubusercontent.com/JTL-ED/auto-pre-re-codes/main/NEW-PRE-RE-module.js
// ==/UserScript==

(function () {
  'use strict';
  const U = window.__SF_UTILS__; if (!U) return;

  // 局部资源（供 dispose 清理）
  let mo = null; // MutationObserver
  let installed = false; // 监听是否已安装
  let stateResetOnRoute = false;

  // ─────────────────────────────────────────────────────────
  // 👉【粘贴 A】把你原脚本里的「配置与状态」放到这里
  //    从行：/***  Configuración: definir las reglas reales según los códigos de valor  ***/
  //    到行：const ST = { ... };
  // ─────────────────────────────────────────────────────────

/***  Configuración: definir las reglas reales según los códigos de valor  ***/
// 1) Reglas para “Nombre”: clave = `${tipo}/${subtipo}`. Valor posible: cadena = rellenar directo; cadena vacía = limpiar; array = mostrar modal de selección
const MODAL_WHITELIST = new Set(['01/01', '01/07']);

const NAME_RULES = {
  '01/01': ['PART', 'REQ ORG CLIENT'],
  '01/02': '',
  '01/03': '',
  '01/04': 'CES OC',
  '01/06': 'IE',
  '01/07': ['FASE OBRA', 'ANULAR', 'PTE ACT CLIENT'],
  '01/17': '',
  '01/18': 'OBRA CIVIL',
  '01/19': 'CES',
  '01/20': 'AJUSTAT',
  '01/21': 'ACTA',
  '02/08': 'ESCREIX',

  // Ejemplo: '02/08': 'XXXX',
  //          '03/09': ['AAA','BBB'],
  //          '04/15': 'ZZZ',
};

// 2) Reglas para “Comunicación” (prioridad por 3 claves, luego 2 claves)
// Prioridad: clave = `${tipo}/${subtipo}/${nombreSeleccionado}`
const COMM_RULES_3 = {
  // Ejemplo (sustituir por los textos reales):
  '01/01/PART':           'Pendiente aportación de los permisos de terceros afectados para la realización de los trabajos.',
  '01/01/REQ ORG CLIENT': 'Pendiente aportación de la documentación requerida por los Organismos Oficiales en el proceso de tramitación de permisos.',

  '01/07/FASE OBRA':      'El complimentarà sempre el tècnic d’E&P, d’acord amb les indicacions del tècnic de la UT.',
  '01/07/ANULAR':         'Pendiente aportación carta de anulación, justificante de pago y certificado de titularidad bancaria.',
  '01/07/PTE ACT CLIENT': 'Temporalmente, la gestión del expediente queda suspendida a la espera de la aportación por su parte de los documentos que se le han requerido.',
};
// Segundo nivel: clave = `${tipo}/${subtipo}` (sin diferenciar “Nombre”)
const COMM_RULES_2 = {
  '01/04': 'En breve les serán requeridos los documentos necesarios para realizar la cesión del CT/CM.',
  '01/06': 'Pendiente instalacion de la Caja General de Protección/Caja de Protección y Medida.',
  '01/08': 'Pendiente de pago del sobrecoste  indicado en las condiciones -técnico econòmicas remitidas.',
  '01/18': 'Pendiente recibir información del espacio reservado para ubicar el CT/CM.',
  '01/19': 'En breve les serán requeridos los documentos necesarios para la cesión de las instalaciones.',
  '01/20': 'Pendiente recibir proyecto eléctrico para revisión.',
  '01/21': 'Una vez validado el proyecto eléctrico, tendrá que aportar permisos y autorizaciones concedidas, y cronograma de ejecución de obra para programar Acta de Lanzamiento.',

  '02/08': 'Pendiente de pago del sobrecoste  indicado en las condiciones - técnico econòmicas remitidas.',

  // …Añadir más textos genéricos según necesidad
};

// —— Etiquetas de los campos destino (insensible a mayúsculas/minúsculas/asteriscos) ——
const NAME_LABEL_RX = /Nombre del Pre-?requisito/i;
const COMM_LABEL_RX = /Comunicaci[oó]n al cliente\s*\(push\)/i;

/***  Estado interno  ***/
const ST = {
  tipo: null,
  subtipo: null,
  nameHost: null, // lightning-input
  commHost: null, // lightning-textarea o lightning-input-rich-text
  modalOpen: false,
  choosing: false,
  lastKeyName: null, // Última clave aplicada a Nombre (tipo/subtipo)
  lastTextName: null, // Último texto escrito en Nombre
  lastKeyComm: null, // Última clave aplicada a Comunicación (puede ser 3 o 2 claves)
  lastTextComm: null, // Último texto escrito en Comunicación
};

  // ─────────────────────────────────────────────────────────
  // 👉【粘贴 B】把你原脚本里的「UI/工具函数」放到这里
  //    从行：/***  Utilidad: modal centrado para selección  ***/
  //    到行：async function resolveRuleValueUI(key, rule) { ... }
  // ─────────────────────────────────────────────────────────

/***  Utilidad: modal centrado para selección  ***/
function showChoiceModal(title, choices) {
  if (ST.modalOpen || ST.choosing) return Promise.resolve(null);
  ST.modalOpen = true; ST.choosing = true;
  return new Promise(resolve => {
    const root = document.createElement('div');
    root.id = '__af_modal_root__';
    root.innerHTML = `
      <div class="af-backdrop"></div>
      <div class="af-modal" role="dialog" aria-modal="true" aria-label="${title}">
        <div class="af-header">${title}</div>
        <div class="af-body">
          ${choices.map((c,i)=>`<button class="af-option" data-idx="${i}" type="button">${c}</button>`).join('')}
        </div>
        <div class="af-actions"><button class="af-cancel" type="button">Cancelar</button></div>
      </div>`;
    const style = document.createElement('style');
    style.textContent = `
      #__af_modal_root__{position:fixed;inset:0;z-index:999999;font-family:system-ui,Segoe UI,Arial,Helvetica,sans-serif}
      #__af_modal_root__ .af-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.35)}
      #__af_modal_root__ .af-modal{
        position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
        background:#fff;border-radius:12px;min-width:320px;max-width:520px;box-shadow:0 20px 60px rgba(0,0,0,.3);
        padding:16px;display:flex;flex-direction:column;gap:12px
      }
      #__af_modal_root__ .af-header{font-weight:600;font-size:16px}
      #__af_modal_root__ .af-body{display:flex;flex-wrap:wrap;gap:8px}
      #__af_modal_root__ .af-option{
        flex:1 1 auto;padding:10px 12px;border-radius:10px;border:1px solid #e3e3e3;background:#f6f7f9;cursor:pointer
      }
      #__af_modal_root__ .af-option:hover{background:#eef2ff;border-color:#c7d2fe}
      #__af_modal_root__ .af-actions{display:flex;justify-content:flex-end}
      #__af_modal_root__ .af-cancel{padding:8px 12px;border-radius:8px;border:1px solid #ddd;background:#fff;cursor:pointer}
      #__af_modal_root__ .af-cancel:hover{background:#f7f7f7}
    `;
    document.body.appendChild(style);
    document.body.appendChild(root);
    const cleanup=()=>{ root.remove(); style.remove(); ST.modalOpen=false; ST.choosing=false; };
    root.querySelectorAll('.af-option').forEach(btn=>{
      btn.addEventListener('click',()=>{ const idx=+btn.dataset.idx; const choice=choices[idx]; cleanup(); resolve(choice ?? null); });
    });
    root.querySelector('.af-cancel').addEventListener('click',()=>{ cleanup(); resolve(null); });
    root.querySelector('.af-backdrop').addEventListener('click', ()=>{ cleanup(); resolve(null); });
    const onKey=e=>{ if(e.key==='Escape'){ document.removeEventListener('keydown',onKey); cleanup(); resolve(null); } };
    document.addEventListener('keydown', onKey, { once:true });
  });
}

/***  Recorrido del DOM (incluye shadow DOM cerrado) + búsqueda por etiqueta  ***/
function* walkDeep(root){ const st=[root]; while(st.length){ const n=st.pop(); if(!n)continue; yield n;
  if(n.shadowRoot)st.push(n.shadowRoot); if(n.children)for(const c of n.children)st.push(c);
  if(n instanceof Document||n instanceof ShadowRoot)for(const c of n.children)st.push(c); } }

function findHostByLabel(rx, tags){
  for(const node of walkDeep(document)){
    if(!node.querySelectorAll) continue;
    for(const tag of tags){
      for(const el of node.querySelectorAll(tag)){
        const lab=(el.label ?? el.getAttribute?.('label') ?? '').trim();
        if(rx.test(lab)) return el;
      }
    }
  }
  return null;
}

/***  Escritura (solo asigna valor, sin disparar eventos para evitar errores)  ***/
function writeHostValue(host, text=''){
  try{
    if(!host) return false;
    if(host.value === text) return true;
    host.value = text;
    console.log(text ? `🟩 Escrito: "${text}"` : '🧼 Campo limpiado');
    return true;
  }catch(e){ console.warn('Error al escribir:', e); return false; }
}

/***  Interpretación de reglas (cadena/vacío/array → modal si procede)  ***/
async function resolveRuleValueUI(key, rule){
  if (Array.isArray(rule)) {
    if (!MODAL_WHITELIST.has(key)) {
      // Si no está en la lista blanca: no muestra modal, usa el primero
      return rule[0] ?? '';
    }
    if (ST.modalOpen || ST.choosing) return null;
    return await showChoiceModal(`Seleccione texto para ${key}`, rule);
  }
  return rule ?? '';
}

  // ─────────────────────────────────────────────────────────
  // 👉【粘贴 C】把你原脚本里的「应用规则 + 事件处理 + reset」放到这里
  //    从行：/***  Aplicar a “Nombre”  ***/
  //    到行：function resetFormState() { ... }
  // ─────────────────────────────────────────────────────────

/***  Aplicar a “Nombre”  ***/
const applyName = (() => {
  let t=null;
  return async () => {
    // No ejecutar si no hay Subtipo (evita disparos por cambio de Tipo)
    if (!ST.subtipo) return;
    clearTimeout(t);
    t = setTimeout(async () => {
      const key = `${ST.tipo ?? ''}/${ST.subtipo ?? ''}`;
      if (ST.lastKeyName === key && ST.lastTextName != null) return;
      const rule = NAME_RULES[key];
      // Localizar nameHost
      ST.nameHost = ST.nameHost || findHostByLabel(NAME_LABEL_RX, ['lightning-input']);
      if (rule === undefined) {
        if (ST.lastTextName && ST.lastTextName !== '') {
          if (writeHostValue(ST.nameHost, '')) ST.lastTextName='';
        }
        ST.lastKeyName = key;
        return;
      }
      const text = await resolveRuleValueUI(key, rule);
      if (text === null) return; // Cancelación de modal: sin cambios
      if (writeHostValue(ST.nameHost, text)) ST.lastTextName = text;
      ST.lastKeyName = key;
      // Tras actualizar Nombre, actualizar Comunicación (depende de Nombre)
      applyComm();
    }, 120);
  };
})();

/***  Aplicar a “Comunicación”  ***/
const applyComm = (() => {
  let t=null;
  return async () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const key2 = `${ST.tipo ?? ''}/${ST.subtipo ?? ''}`;
      const nombre = ST.lastTextName || '';
      const key3 = `${key2}/${nombre}`;
      const rule3 = COMM_RULES_3[key3];
      const rule2 = COMM_RULES_2[key2];
      const rule = (rule3 !== undefined) ? rule3 : rule2;

      // Localizar commHost (compatible con textarea / rich-text)
      ST.commHost = ST.commHost || findHostByLabel(COMM_LABEL_RX, ['lightning-textarea','lightning-input-rich-text']);
      if (rule === undefined) {
        if (ST.lastTextComm && ST.lastTextComm !== '') {
          if (writeHostValue(ST.commHost, '')) ST.lastTextComm='';
        }
        ST.lastKeyComm = rule3 !== undefined ? key3 : key2;
        return;
      }
      const pickKey = (rule3 !== undefined) ? key3 : key2;
      const text = await resolveRuleValueUI(pickKey, rule);
      if (text === null) return; // Cancelación de modal: sin cambios
      if (writeHostValue(ST.commHost, text)) ST.lastTextComm = text;
      ST.lastKeyComm = pickKey;
    }, 140);
  };
})();

/***  Escucha: captura los campos al enfocarse (cuando el shadow DOM está cerrado)  ***/
function onFocusIn(e){
  const path = e.composedPath?.() || [];
  const tag = n => n && n.tagName;
  const inputHost = path.find(n => tag(n)==='LIGHTNING-INPUT');
  const areaHost = path.find(n => tag(n)==='LIGHTNING-TEXTAREA' || tag(n)==='LIGHTNING-INPUT-RICH-TEXT');

  if (inputHost) {
    const label = inputHost.label || inputHost.getAttribute?.('label') || '';
    if (NAME_LABEL_RX.test(label) && !ST.nameHost) {
      ST.nameHost = inputHost;
      console.log('🔗 Caché establecida para “Nombre del Pre-requisito”');
      applyName();
    }
  }
  if (areaHost) {
    const label = areaHost.label || areaHost.getAttribute?.('label') || '';
    if (COMM_LABEL_RX.test(label) && !ST.commHost) {
      ST.commHost = areaHost;
      console.log('🔗 Caché establecida para “Comunicación al cliente (push)”');
      applyComm();
    }
  }
}


/***  Escucha: cambios en Tipo/Subtipo (los eventos atraviesan shadow DOM)  ***/
function onPickChange(e){
  const path = e.composedPath?.() || [];
  const host = path.find(n => n && n.tagName === 'LIGHTNING-COMBOBOX');
  if (!host) return;

  const label = host.label || host.getAttribute?.('label') || '';
  const val = ('value' in host) ? host.value : null;
  if (val == null) return;

  if (label === 'Tipo') {
    // ✅ Cambio de Tipo: registrar y limpiar todo el contenido dependiente
    ST.tipo = val;
    ST.subtipo = null;
    ST.lastTextName = '';
    ST.lastTextComm = '';

    // Localizar y limpiar los campos (para evitar valores antiguos)
    ST.nameHost = ST.nameHost || findHostByLabel(NAME_LABEL_RX, ['lightning-input']);
    ST.commHost = ST.commHost || findHostByLabel(COMM_LABEL_RX, ['lightning-textarea','lightning-input-rich-text']);
    if (ST.nameHost) writeHostValue(ST.nameHost, '');
    if (ST.commHost) writeHostValue(ST.commHost, '');

    console.log('🧹 Nombre y Comunicación limpiados (cambio de Tipo)');
    return; // No mostrar modal
  }

  if (label === 'Subtipo') {
    // ✅ Solo aplicar reglas cuando se selecciona Subtipo (evita falsos disparos)
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
  ST.modalOpen = false;
  ST.choosing = false;
  document.getElementById('__af_modal_root__')?.remove();
  console.log('🔄 [Autofill] Nuevo formulario detectado, estado reiniciado');
}


  // 注：你原来的「install()」和「monitorNewPrereqPage() 自执行 + setInterval」不再使用，
  // 因为模块由 utils 统一生命周期控制；我们在 init()/dispose() 里完成安装和清理。

  // 可选：进入“新建/查看 Prerequisite”页面时的路由判断（修复你原代码里的 || 写法）
  function isPrereqPage(href, doc) {
    // 你原来写的是 href.includes('/lightning/o/Prerequisite__c/new' || '/lightning/r/Prerequisite__c')
    // 会只判断第一个字符串。这里改为显式判断两者：
    return /\/lightning\/o\/Prerequisite__c\/new/i.test(href) ||
           /\/lightning\/r\/Prerequisite__c\//i.test(href) ||
           /Prerequisito/i.test(doc?.innerText || '');
  }

  // 将原先的“安装事件监听 + 首次执行 + DOM 观察”收敛为 init()
  function installListeners() {
    if (installed) return;
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('change', onPickChange, true);
    installed = true;
    console.log('[NEW-PRE-RE] listeners installed');
  }

  function uninstallListeners() {
    if (!installed) return;
    document.removeEventListener('focusin', onFocusIn, true);
    document.removeEventListener('change', onPickChange, true);
    installed = false;
    console.log('[NEW-PRE-RE] listeners removed');
  }

  function runOnce() {
    // 进入/切换到该页面时，重置状态并尝试应用一次
    resetFormState();
    // 给 LWC 一点渲染时间，再执行
    setTimeout(() => { try { applyName(); applyComm(); } catch(e){ console.error(e); } }, 400);
  }

  // 统一注册为一个模块，由 utils 路由调度
  U.register({
    name: 'NEW-PRE-RE',
    // 你可以放宽到 Prerequisite 相关页面，或更严格的 URL 规则
    match: (href, doc) => isPrereqPage(href, doc),

    init() {
      // 1) 安装事件监听
      installListeners();

      // 2) 初次执行（相当于你原来的 install() + 首次 apply）
      runOnce();

      // 3) 观察 DOM（Lightning SPA 中反复渲染）
      mo = new MutationObserver(U.debounce(() => {
        // 由于我们有事件监听 + apply 的去抖，这里一般不需要重复太多逻辑
        // 但保证在 DOM 发生较大变化时，能再次尝试（如刚刚渲染完）
        applyName();
        applyComm();
      }, 120));
      mo.observe(document.body, { childList: true, subtree: true });

      // 4) 如果你希望在路由变化时强制重置一次（进入新表单）
      //    utils.hookHistory() 已在 utils.boot() 内部装好；只要你在 match 中切换页面，路由器会先 dispose 再 init。
      stateResetOnRoute = true;
      console.log('[NEW-PRE-RE] init');
    },

    dispose() {
      try { if (mo) mo.disconnect(); } catch(e) {}
      mo = null;
      uninstallListeners();
      // 确保把弹出的 modal 清掉，避免遗留
      document.getElementById('__af_modal_root__')?.remove();
      stateResetOnRoute = false;
      console.log('[NEW-PRE-RE] dispose');
    }
  });

  // 由任意一个脚本负责启动路由器（若 CINCO 里已经调用过 U.boot()，这里再次调用也没关系）
  U.boot();
})();
