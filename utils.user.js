// ==UserScript==
// @name         SF Utils Router (shared)
// @namespace    sf-utils
// @version      1.0.0
// @description  Registro de módulos + ruteo para Salesforce Lightning (SPA) y utilidades básicas.
// @match        https://*.lightning.force.com/*
// @match        https://*.salesforce.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // Evitar carga doble
  if (window.__SF_UTILS__) return;

  const U = {
    // ---------- Utils básicos ----------
    log: (...a) => console.log('[SF]', ...a),
    warn: (...a) => console.warn('[SF]', ...a),
    err: (...a) => console.error('[SF]', ...a),

    sleep: (ms) => new Promise(r => setTimeout(r, ms)),
    q: (sel, root = document) => root.querySelector(sel),
    qq: (sel, root = document) => Array.from(root.querySelectorAll(sel)),
    debounce(fn, wait = 80) {
      let t = null;
      return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
    },

    // ---------- Registro + Router ----------
    _mods: [],       // {name, match(href, doc), init(), dispose(), _active}
    _booted: false,

    register(mod) {
      if (!mod || !mod.name) return;
      mod._active = false;
      this._mods.push(mod);
    },

    boot() {
      if (this._booted) return;
      this._booted = true;

      const onRoute = this.debounce(() => this.route(), 120);

      // Hook SPA history
      const p = history.pushState;
      const r = history.replaceState;
      history.pushState = function () { const ret = p.apply(this, arguments); onRoute(); return ret; };
      history.replaceState = function () { const ret = r.apply(this, arguments); onRoute(); return ret; };
      window.addEventListener('popstate', onRoute);
      window.addEventListener('hashchange', onRoute);

      // Inicial
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this.route(), { once: true });
      } else {
        this.route();
      }
    },

    route() {
      const href = location.href;
      const doc = document;
      this._mods.forEach(m => {
        let should = false;
        try { should = !!(m.match ? m.match(href, doc) : true); } catch (e) { this.err('match error:', m.name, e); }

        if (should && !m._active) {
          try { m.init && m.init(); m._active = true; this.log('init', m.name); } catch (e) { this.err('init error:', m.name, e); }
        } else if (!should && m._active) {
          try { m.dispose && m.dispose(); m._active = false; this.log('dispose', m.name); } catch (e) { this.err('dispose error:', m.name, e); }
        }
      });
    }
  };

  // Exponer en ventana
  window.__SF_UTILS__ = U;
})();
