/* ============================================================
   SYNC — estado COMPARTILHADO entre as contas (via Supabase).
   Os dois usuarios enxergam a MESMA VM, o mesmo historico e
   quem esta online. Nada fica preso num navegador so.

   Tabela no Supabase (SQL no PUBLICAR.txt):
     arkher_state(k text primary key, v jsonb, updated_at timestamptz)
     arkher_log(id bigserial, who text, kind text, txt text, at timestamptz)
   ============================================================ */
'use strict';
if (typeof LS === 'undefined' && typeof require !== 'undefined') { globalThis.LS = require('./core.js').LS; }

const Sync = {
  _lastLogId: 0,
  _timer: null,

  cfg() { return (typeof Auth !== 'undefined') ? Auth.cfg() : LS.get('arkher_supabase', {}); },
  tok() { return (typeof Auth !== 'undefined') ? (Auth.sess()?.access_token || '') : ''; },
  me() { return (typeof Auth !== 'undefined') ? (Auth.email() || 'anon') : 'anon'; },

  ligado() { const c = this.cfg(); return !!(c && c.url && c.anon); },

  _h() {
    const c = this.cfg();
    const t = this.tok();
    return {
      'Content-Type': 'application/json',
      'apikey': c.anon,
      'Authorization': 'Bearer ' + (t || c.anon),
      'Prefer': 'resolution=merge-duplicates',
    };
  },

  async _rest(path, opt) {
    const c = this.cfg();
    if (!c.url) throw new Error('Supabase nao configurado');
    const r = await fetch(c.url + '/rest/v1' + path, { headers: this._h(), ...opt });
    if (!r.ok) {
      let d = ''; try { d = (await r.json())?.message || ''; } catch (e) {}
      throw new Error('sync HTTP ' + r.status + ' ' + d);
    }
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  },

  /* ---------- chave/valor compartilhado ---------- */
  async set(k, v) {
    return this._rest('/arkher_state', {
      method: 'POST',
      body: JSON.stringify([{ k, v, updated_at: new Date().toISOString() }]),
    });
  },

  async get(k, dflt) {
    try {
      const r = await this._rest('/arkher_state?k=eq.' + encodeURIComponent(k) + '&select=v', { method: 'GET' });
      return (r && r[0]) ? r[0].v : dflt;
    } catch (e) { return dflt; }
  },

  /* ---------- a VM: um endereco pros dois ---------- */
  async setVM(url) {
    await this.set('agent_url', { url, por: this.me(), em: Date.now() });
  },
  async getVM() {
    const v = await this.get('agent_url', null);
    return v && v.url ? v : null;
  },

  /* ---------- presenca: quem esta online ---------- */
  async bater() {
    try {
      await this.set('presence:' + this.me(), { who: this.me(), at: Date.now() });
    } catch (e) {}
  },
  async online() {
    try {
      const r = await this._rest('/arkher_state?k=like.presence:*&select=k,v', { method: 'GET' });
      const lim = Date.now() - 90000;
      return (r || []).map(x => x.v).filter(v => v && v.at > lim);
    } catch (e) { return []; }
  },

  /* ---------- log compartilhado (o amigo ve o que voce fez) ---------- */
  async log(kind, txt) {
    try {
      await this._rest('/arkher_log', {
        method: 'POST',
        body: JSON.stringify([{ who: this.me(), kind, txt: String(txt).slice(0, 2000) }]),
      });
    } catch (e) {}
  },

  async novos() {
    try {
      const r = await this._rest(
        '/arkher_log?id=gt.' + this._lastLogId + '&order=id.asc&limit=40&select=id,who,kind,txt', { method: 'GET' });
      if (r && r.length) this._lastLogId = r[r.length - 1].id;
      return r || [];
    } catch (e) { return []; }
  },

  async iniciarLog() {
    try {
      const r = await this._rest('/arkher_log?order=id.desc&limit=1&select=id', { method: 'GET' });
      this._lastLogId = (r && r[0]) ? r[0].id : 0;
    } catch (e) {}
  },

  /* ---------- trava: evita os dois mandarem comando junto ---------- */
  async pegarTrava(seg) {
    const atual = await this.get('lock', null);
    const agora = Date.now();
    if (atual && atual.who !== this.me() && atual.until > agora) return atual;  // ocupado
    await this.set('lock', { who: this.me(), until: agora + (seg || 60) * 1000 });
    return null;
  },
  async soltarTrava() {
    const a = await this.get('lock', null);
    if (a && a.who === this.me()) await this.set('lock', { who: null, until: 0 });
  },
};

if (typeof window !== 'undefined') window.Sync = Sync;
if (typeof module !== 'undefined') module.exports = { Sync };
