/* ============================================================
   AUTH — login real via Supabase (e-mail + senha).
   Acesso restrito: so os e-mails da lista ALLOW entram.
   Sem backend proprio; o Supabase faz a verificacao.
   ============================================================ */
'use strict';
if (typeof LS === 'undefined' && typeof require !== 'undefined') { globalThis.LS = require('./core.js').LS; }

const Auth = {
  cfg() { return LS.get('arkher_supabase', { url: '', anon: '' }); },
  setCfg(url, anon) { LS.set('arkher_supabase', { url: String(url || '').replace(/\/+$/, ''), anon: anon || '' }); },

  /** quem pode entrar (lido na hora, nao na carga do arquivo) */
  get ALLOW() { return LS.get('arkher_allow', []); },
  setAllow(list) { LS.set('arkher_allow', list); },

  sess() { return LS.get('arkher_sess', null); },

  ativo() {
    const s = this.sess();
    if (!s || !s.access_token) return false;
    if (s.expires_at && Date.now() / 1000 > s.expires_at) return false;
    return true;
  },

  email() { return this.sess()?.user?.email || ''; },

  permitido(email) {
    const l = (this.ALLOW || []).map(x => String(x).toLowerCase().trim()).filter(Boolean);
    if (!l.length) return true;               // lista vazia = liberado (1o uso)
    return l.includes(String(email).toLowerCase().trim());
  },

  async _post(path, body) {
    const c = this.cfg();
    if (!c.url || !c.anon) throw new Error('Supabase nao configurado');
    const r = await fetch(c.url + '/auth/v1' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': c.anon },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error_description || j.msg || j.error || ('HTTP ' + r.status));
    return j;
  },

  async entrar(email, senha) {
    if (!this.permitido(email)) throw new Error('Este e-mail nao tem acesso.');
    const j = await this._post('/token?grant_type=password', { email, password: senha });
    if (!j.access_token) throw new Error('login sem token');
    LS.set('arkher_sess', j);
    return j;
  },

  async criar(email, senha) {
    if (!this.permitido(email)) throw new Error('Este e-mail nao tem acesso.');
    const j = await this._post('/signup', { email, password: senha });
    if (j.access_token) LS.set('arkher_sess', j);
    return j;
  },

  sair() { LS.set('arkher_sess', null); },
};

if (typeof window !== 'undefined') window.Auth = Auth;
if (typeof module !== 'undefined') module.exports = { Auth };
