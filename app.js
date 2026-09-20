/* ============================================================
   NEXUS — nucleo de IA
   Lista 1: Puter (catalogo vivo)  ->  Lista 2: HF Hub (live)
   Fallback + rollback + circuit breaker. Sem servidor.
   ============================================================ */
'use strict';
if (typeof LS === 'undefined' && typeof require !== 'undefined') { globalThis.LS = require('./core.js').LS; }

/* LS vem de core.js */

/* ---------- ranqueador: sem lista fixa, le o catalogo vivo ---------- */
const TIER = [
  [/fable/i, 100], [/opus/i, 95], [/ultra/i, 88], [/sonnet/i, 80], [/gpt-?5/i, 78],
  [/max/i, 72], [/\bpro\b/i, 66], [/405b/i, 62], [/70b/i, 55],
  [/thinking|reasoning/i, 58], [/flash/i, 40], [/mini/i, 30], [/haiku/i, 30],
  [/lite/i, 22], [/nano/i, 16], [/small|tiny/i, 12], [/fast/i, 20],
];
const FAM = [
  [/claude/i, 30], [/gpt-?5/i, 26], [/gemini/i, 22], [/grok/i, 20],
  [/deepseek/i, 18], [/qwen/i, 14], [/llama/i, 10], [/mistral/i, 10], [/kimi/i, 12],
];
function verBonus(id) {
  const m = String(id).match(/\d+(?:\.\d+)?/g);
  if (!m) return 0;
  let best = 0;
  for (const x of m) { const v = parseFloat(x); if (v > best && v < 100) best = v; }
  return Math.min(best * 3, 30);
}
function scoreModel(id) {
  let sc = 0;
  for (const [re, w] of TIER) if (re.test(id)) sc += w;
  for (const [re, w] of FAM) if (re.test(id)) sc += w;
  sc += verBonus(id);
  if (/:free/i.test(id)) sc += 45;
  if (/preview|experimental|alpha|beta/i.test(id)) sc -= 12;
  if (/:batch/i.test(id)) sc -= 150;
  if (/vl|vision|image|audio|tts|whisper|embed|omni|translat|coder|math|guard|moderat/i.test(id)) sc -= 70;
  return sc;
}
const STAGE_W = {
  plan:    { think: 1.35, big: 1.30, fast: 0.80 },
  code:    { think: 1.20, big: 1.25, fast: 0.90 },
  chat:    { think: 1.00, big: 1.00, fast: 1.10 },
  fast:    { think: 0.85, big: 0.85, fast: 1.35 },
  other:   { think: 1.00, big: 1.00, fast: 1.00 },
};
function scoreFor(id, stage) {
  const w = STAGE_W[stage] || STAGE_W.other;
  let sc = scoreModel(id);
  if (/thinking|reasoning|opus|fable|\br1\b/i.test(id)) sc *= w.think;
  if (/fable|opus|ultra|max|\bpro\b|sonnet|405b|70b/i.test(id)) sc *= w.big;
  if (/flash|mini|nano|lite|fast|haiku/i.test(id)) sc *= w.fast;
  return sc;
}

/* ---------- circuit breaker: modelo que falha sai da roda ---------- */
const Breaker = {
  banned: new Map(),
  ban(id, ms = 10 * 60 * 1000) { this.banned.set(id, Date.now() + ms); },
  ok(id) {
    const t = this.banned.get(id);
    if (!t) return true;
    if (Date.now() > t) { this.banned.delete(id); return true; }
    return false;
  },
  clear() { this.banned.clear(); },
};

/* ---------- LISTA 1: Puter ---------- */
const Puter = {
  models: null,
  async list() {
    if (this.models) return this.models;
    const r = await fetch('https://api.puter.com/puterai/chat/models');
    if (!r.ok) throw new Error('catalogo Puter HTTP ' + r.status);
    const j = await r.json();
    const raw = j.models || j.data || j;
    const ids = (Array.isArray(raw) ? raw : [])
      .map(m => (typeof m === 'string' ? m : (m.id || m.name)))
      .filter(Boolean)
      .filter(id => !/:batch/i.test(id));
    this.models = ids;
    return ids;
  },
  ready() { return typeof puter !== 'undefined' && puter.ai && puter.ai.chat; },
  async ask(model, messages, onDelta) {
    if (!this.ready()) throw new Error('puter.js nao carregou');
    const res = await puter.ai.chat(messages, { model, stream: !!onDelta });
    if (onDelta && res && typeof res[Symbol.asyncIterator] === 'function') {
      let full = '';
      for await (const part of res) {
        const t = (part && (part.text ?? part?.message?.content)) || '';
        if (t) { full += t; onDelta(t); }
      }
      if (!full) throw new Error('resposta vazia');
      return full;
    }
    const txt = typeof res === 'string' ? res
      : (res?.message?.content ?? res?.text ?? res?.content ?? '');
    const out = typeof txt === 'string' ? txt : JSON.stringify(txt);
    if (!out || out.length < 1) throw new Error('resposta vazia');
    return out;
  },
};

/* ---------- LISTA 2: Hugging Face Hub ---------- */
const HF = {
  models: null,
  token() {
    const t = LS.get('arkher_hf_token', '');
    if (t) return t;
    if (typeof Vault !== 'undefined') { const c = Vault.pick('hf'); if (c) return c.token; }
    return '';
  },
  async list() {
    if (this.models) return this.models;
    const url = 'https://huggingface.co/api/models?inference_provider=all'
      + '&pipeline_tag=text-generation&limit=1000&sort=downloads&direction=-1'
      + '&expand[]=inferenceProviderMapping';
    const r = await fetch(url);
    if (!r.ok) throw new Error('HF Hub HTTP ' + r.status);
    const arr = await r.json();
    const live = [];
    for (const m of arr) {
      const maps = m.inferenceProviderMapping || [];
      if (maps.some(p => p.status === 'live' && p.task === 'conversational')) live.push(m.id);
    }
    this.models = live;
    return live;
  },
  async ask(model, messages, onDelta) {
    // cofre: usa a credencial da vez; se nao houver, cai no campo simples
    let cred = null;
    if (typeof Vault !== 'undefined') cred = Vault.pick('hf');
    const tk = cred ? cred.token : this.token();
    if (!tk) throw new Error('sem token HF');
    const r = await fetch('https://router.huggingface.co/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tk },
      body: JSON.stringify({ model, messages, stream: false, max_tokens: 4096 }),
    });
    if (!r.ok) {
      let d = '';
      try { d = (await r.json())?.error?.message || ''; } catch (e) {}
      const msg = 'HTTP ' + r.status + ' ' + d;
      if (cred && typeof Vault !== 'undefined') Vault.fail(cred.id, msg);
      throw new Error(msg);
    }
    const j = await r.json();
    const t = j?.choices?.[0]?.message?.content;
    if (!t) { if (cred && typeof Vault !== 'undefined') Vault.fail(cred.id, 'vazio'); throw new Error('resposta vazia'); }
    if (cred && typeof Vault !== 'undefined') Vault.ok(cred.id);
    if (onDelta) onDelta(t);
    return t;
  },
};

/* ---------- erro fatal: trocar de modelo nao resolve ---------- */
function fatal(msg) {
  const e = String(msg).toLowerCase();
  return /401|403|invalid api key|unauthorized|permission|sem token/.test(e);
}
/* ---------- erro do modelo: bane e segue ---------- */
function deadModel(msg) {
  const e = String(msg).toLowerCase();
  return /404|not found|does not exist|decommission|model_not_found|400|unsupported|not supported/.test(e);
}

/* ============================================================
   CASCATA: Puter inteiro -> HF inteiro. So falha se TODOS falharem.
   ============================================================ */
const Arkher = {
  async rank(stage) {
    const out = { puter: [], hf: [] };
    try { out.puter = (await Puter.list()).slice().sort((a, b) => scoreFor(b, stage) - scoreFor(a, stage)); }
    catch (e) { out.puterErr = e.message; }
    try { out.hf = (await HF.list()).slice().sort((a, b) => scoreFor(b, stage) - scoreFor(a, stage)); }
    catch (e) { out.hfErr = e.message; }
    return out;
  },

  async ask(messages, opts = {}) {
    const stage = opts.stage || 'chat';
    const onTry = opts.onTry || (() => {});
    const onDelta = opts.onDelta || null;
    const maxTries = opts.maxTries || 25;
    const forced = opts.model;

    const r = await this.rank(stage);
    let fila = [];
    if (forced) {
      fila = [{ src: forced.startsWith('hf:') ? 'hf' : 'puter', id: forced.replace(/^hf:/, '') }];
    } else {
      for (const id of r.puter) fila.push({ src: 'puter', id });
      for (const id of r.hf) fila.push({ src: 'hf', id });
    }
    if (!fila.length) throw new Error('nenhum catalogo disponivel: ' + (r.puterErr || '') + ' ' + (r.hfErr || ''));

    const hasHF = !!HF.token();
    let tried = 0, lastErr = null;
    for (const item of fila) {
      if (tried >= maxTries) break;
      if (item.src === 'hf' && !hasHF) continue;
      if (!Breaker.ok(item.src + ':' + item.id)) continue;
      tried++;
      onTry(item, tried);
      try {
        const t = item.src === 'puter'
          ? await Puter.ask(item.id, messages, onDelta)
          : await HF.ask(item.id, messages, onDelta);
        return { text: t, model: item.id, src: item.src, tried };
      } catch (e) {
        const msg = e?.message || String(e);
        lastErr = msg;
        if (item.src === 'puter' && fatal(msg)) {
          // conta Puter fora do ar -> pula direto pro HF
          if (hasHF) { for (const it of fila) { if (it.src === 'puter') Breaker.ban('puter:' + it.id, 60000); } continue; }
          throw new Error(msg);
        }
        if (deadModel(msg)) Breaker.ban(item.src + ':' + item.id, 30 * 60 * 1000);
        else Breaker.ban(item.src + ':' + item.id, 60 * 1000);
        if (/429|rate/i.test(msg)) await new Promise(s => setTimeout(s, 1200));
      }
    }
    throw new Error((lastErr || 'nenhum modelo respondeu') + ' (tentei ' + tried + ')');
  },
};

if (typeof window !== 'undefined') {
  window.Arkher = Arkher; window.Nexus = Arkher; window.Puter = Puter; window.HF = HF;
  window.Breaker = Breaker; window.scoreFor = scoreFor; window.LS = LS;
}
if (typeof module !== 'undefined') {
  module.exports = { Arkher, Puter, HF, Breaker, scoreFor, fatal, deadModel };
}
