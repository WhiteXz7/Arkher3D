/* ============================================================
   VAULT — cofre de credenciais com rotacao automatica.
   Voce cadastra os tokens que JA TEM (varias contas suas).
   Quando um esgota (429/402/limite), passa pro proximo sozinho.
   Todos voltam a valer no "reset diario".
   ============================================================ */
'use strict';
if (typeof LS === 'undefined' && typeof require !== 'undefined') { globalThis.LS = require('./core.js').LS; }

const Vault = {
  KEY: 'arkher_vault_v1',

  _load() {
    const d = LS.get(this.KEY, null);
    if (d && d.items) return d;
    return { items: [], lastReset: 0 };
  },
  _save(d) { LS.set(this.KEY, d); },

  /** todas as credenciais de um provedor */
  all(provider) {
    return this._load().items.filter(i => i.provider === provider);
  },

  add(provider, token, label) {
    const d = this._load();
    token = String(token || '').trim();
    if (!token) return false;
    if (d.items.some(i => i.provider === provider && i.token === token)) return false;
    d.items.push({
      id: 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      provider, token,
      label: label || (provider + ' #' + (this.all(provider).length + 1)),
      cooldownUntil: 0, fails: 0, uses: 0, lastOk: 0,
    });
    this._save(d);
    return true;
  },

  remove(id) {
    const d = this._load();
    d.items = d.items.filter(i => i.id !== id);
    this._save(d);
  },

  /** reset diario: tudo volta a valer (cotas costumam zerar por dia) */
  maybeReset() {
    const d = this._load();
    const hoje = new Date().toISOString().slice(0, 10);
    if (d.lastResetDay !== hoje) {
      for (const i of d.items) { i.cooldownUntil = 0; i.fails = 0; }
      d.lastResetDay = hoje;
      this._save(d);
      return true;
    }
    return false;
  },

  /** proxima credencial disponivel (menos usada primeiro) */
  pick(provider) {
    this.maybeReset();
    const now = Date.now();
    const livres = this.all(provider)
      .filter(i => (i.cooldownUntil || 0) < now)
      .sort((a, b) => (a.uses || 0) - (b.uses || 0));
    return livres[0] || null;
  },

  /** marca sucesso */
  ok(id) {
    const d = this._load();
    const i = d.items.find(x => x.id === id);
    if (i) { i.uses = (i.uses || 0) + 1; i.lastOk = Date.now(); i.fails = 0; this._save(d); }
  },

  /** marca falha; cota estourada = descansa ate o reset */
  fail(id, motivo) {
    const d = this._load();
    const i = d.items.find(x => x.id === id);
    if (!i) return;
    i.fails = (i.fails || 0) + 1;
    const m = String(motivo || '').toLowerCase();
    if (/429|quota|rate|limit|exceeded|402|credit|payment|insufficient/.test(m)) {
      i.cooldownUntil = Date.now() + 6 * 3600 * 1000;   // dorme 6h
      i.motivo = 'cota';
    } else if (/401|403|invalid|unauthorized/.test(m)) {
      i.cooldownUntil = Date.now() + 24 * 3600 * 1000;  // token ruim
      i.motivo = 'invalido';
    } else {
      i.cooldownUntil = Date.now() + 2 * 60 * 1000;     // instabilidade
      i.motivo = 'instavel';
    }
    this._save(d);
  },

  stats(provider) {
    const now = Date.now();
    const a = this.all(provider);
    return { total: a.length, livres: a.filter(i => (i.cooldownUntil || 0) < now).length };
  },
};

if (typeof window !== 'undefined') window.Vault = Vault;
if (typeof module !== 'undefined') module.exports = { Vault };
