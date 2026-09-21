/* ARKHER PILOT — a IA opera a VM olhando a tela.
   Loop: print -> modelo com visao decide -> executa -> repete.
   Nao e "gerar comando"; e ver e agir, igual gente. */
(function () {
  const A = {};

  A.SYS = `Voce opera um Windows 11 REAL por print de tela. Objetivo do usuario abaixo.
Voce recebe a cada passo: a imagem da tela e o que ja fez.
Responda SO com um JSON, nada de texto fora dele:
{"pensa":"1 frase do que ve e por que","acoes":[...],"fim":false,"resumo":""}

Acoes possiveis (coordenadas em pixels da imagem que voce recebeu):
 {"do":"click","x":100,"y":200}        clique esquerdo
 {"do":"dblclick","x":100,"y":200}
 {"do":"right","x":100,"y":200}
 {"do":"drag","x":10,"y":10,"x2":90,"y2":90}
 {"do":"scroll","x":500,"y":400,"amount":-400}
 {"do":"type","text":"texto"}
 {"do":"key","key":"{ENTER}"}          {TAB} {ESC} {F5} {DEL}
 {"do":"hotkey","combo":"^s"}          ^=ctrl %=alt +=shift
 {"do":"wait","sec":3}
Regras:
 - No maximo 5 acoes por passo. Depois de cada passo voce ve a tela de novo.
 - Programa abrindo/carregando: devolva so [{"do":"wait","sec":5}].
 - Terminou o objetivo: {"fim":true,"resumo":"o que foi feito"}.
 - Travou 3x no mesmo lugar: tente outro caminho ou pare com fim:true explicando.
 - Roblox Studio pode pedir login manual. Se pedir, pare e avise no resumo.`;

  A.parse = function (t) {
    if (!t) return null;
    let s = String(t).replace(/```json/gi, '```').split('```');
    s = s.length > 1 ? s[1] : s[0];
    const i = s.indexOf('{'), j = s.lastIndexOf('}');
    if (i < 0 || j < 0) return null;
    try { return JSON.parse(s.slice(i, j + 1)); } catch (e) {}
    try { return JSON.parse(s.slice(i, j + 1).replace(/,\s*([}\]])/g, '$1')); } catch (e) { return null; }
  };

  A.vm = async function (rota, body, metodo) {
    const base = (typeof LS !== 'undefined' && LS.get('arkher_agent', '')) || '';
    if (!base) throw new Error('sem URL do agente — configure na aba VM');
    const r = await fetch(base.replace(/\/$/, '') + rota, {
      method: metodo || (body ? 'POST' : 'GET'),
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return r.json();
  };

  /* roda o objetivo. cb({tipo,...}) pra UI mostrar ao vivo */
  A.correr = async function (objetivo, cb, opt) {
    opt = opt || {};
    const maxP = opt.passos || 25;
    cb = cb || function () {};
    const hist = [];

    const pronto = await A.vm('/guiready').catch(() => ({ ok: false, err: 'agente offline' }));
    if (!pronto.ok) {
      cb({ tipo: 'erro', txt: 'Sem sessao grafica na VM. ' + (pronto.nota || pronto.err || '') });
      return { ok: false, motivo: 'sem-gui' };
    }

    for (let p = 1; p <= maxP; p++) {
      const sh = await A.vm('/screen?scale=0.5&q=55');
      if (!sh.ok) { cb({ tipo: 'erro', txt: 'print falhou: ' + sh.err }); return { ok: false }; }
      cb({ tipo: 'tela', img: sh.img, passo: p });

      const msg = [
        { role: 'system', content: A.SYS },
        { role: 'user', content: [
            { type: 'text', text:
              `OBJETIVO: ${objetivo}\n\nPasso ${p}/${maxP}. Tela ${sh.w}x${sh.h}.` +
              (hist.length ? `\nJa fiz:\n- ${hist.slice(-6).join('\n- ')}` : '\nPrimeiro passo.') },
            { type: 'image_url', image_url: { url: sh.img } },
        ] },
      ];

      let bruto;
      try {
        const rr = await Arkher.ask(msg, { visao: true, stage: 'visao' });
        bruto = (rr && typeof rr === 'object') ? (rr.text || '') : rr;
        if (rr && rr.model) cb({ tipo: 'modelo', txt: rr.model });
      } catch (e) {
        cb({ tipo: 'erro', txt: 'modelo falhou: ' + e.message }); return { ok: false };
      }

      const d = A.parse(bruto);
      if (!d) { cb({ tipo: 'aviso', txt: 'resposta ilegivel, repetindo' }); continue; }
      if (d.pensa) cb({ tipo: 'pensa', txt: d.pensa, passo: p });

      if (d.fim) { cb({ tipo: 'fim', txt: d.resumo || 'concluido' }); return { ok: true, resumo: d.resumo }; }

      const acoes = (d.acoes || []).slice(0, 5);
      if (!acoes.length) { hist.push('nada a fazer'); continue; }
      cb({ tipo: 'age', acoes: acoes });
      const r = await A.vm('/input', { acts: acoes });
      hist.push(acoes.map(a => a.do + (a.x != null ? `(${a.x},${a.y})` : '') +
                                (a.text ? `"${a.text.slice(0, 25)}"` : '')).join(' + '));
      if (!r.ok) cb({ tipo: 'aviso', txt: 'alguma acao falhou' });
      await new Promise(s => setTimeout(s, 700));
    }
    cb({ tipo: 'fim', txt: `parei em ${maxP} passos (limite)` });
    return { ok: false, motivo: 'limite' };
  };

  A.abrir = function (nome) { return A.vm('/app', { nome: nome, esperar: 8 }); };

  if (typeof window !== 'undefined') window.Pilot = A;
  if (typeof module !== 'undefined') module.exports = A;
})();
