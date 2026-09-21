/* NEXUS — base compartilhada (carrega primeiro) */
'use strict';
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};
if (typeof window !== 'undefined') window.LS = LS;
if (typeof module !== 'undefined') module.exports = { LS };
