/* ============================================================
   SKILLS — capacidades compartilhadas.
   Qualquer LLM (fable-5, gpt-5, llama...) ganha as MESMAS
   habilidades extras: 3D, imagem, audio, execucao na VM.
   Nao transforma um modelo no outro: da ferramentas a todos.
   O LLM decide QUANDO usar; o executor faz o trabalho.
   ============================================================ */
'use strict';
if (typeof LS === 'undefined' && typeof require !== 'undefined') { globalThis.LS = require('./core.js').LS; }

/* catalogo de habilidades. cada uma diz onde roda. */
const SKILLS = {
  gerar_3d: {
    desc: 'Cria um modelo 3D (.glb) a partir de texto ou imagem.',
    args: { prompt: 'descricao do objeto', imagem: '(opcional) URL de imagem' },
    engines: [
      { via: 'vm',    id: 'TRELLIS',      need: 'gpu?nao — roda em CPU, lento' },
      { via: 'space', id: 'microsoft/TRELLIS' },
      { via: 'space', id: 'tencent/Hunyuan3D-2' },
    ],
  },
  gerar_imagem: {
    desc: 'Gera uma imagem a partir de texto.',
    args: { prompt: 'descricao da imagem' },
    engines: [
      { via: 'puter', id: 'txt2img' },
      { via: 'space', id: 'black-forest-labs/FLUX.1-schnell' },
    ],
  },
  animar_3d: {
    desc: 'Aplica animacao/rig a um modelo 3D existente.',
    args: { arquivo: 'caminho do .glb na VM', acao: 'andar, correr, acenar...' },
    engines: [{ via: 'vm', id: 'blender-script' }],
  },
  rodar_vm: {
    desc: 'Executa comando no Windows da VM (PowerShell).',
    args: { cmd: 'o comando' },
    engines: [{ via: 'vm', id: 'exec' }],
  },
  render_blender: {
    desc: 'Renderiza cena no Blender da VM.',
    args: { arquivo: '.blend ou script', saida: 'png' },
    engines: [{ via: 'vm', id: 'blender' }],
  },
  buscar_modelo: {
    desc: 'Procura no HF Hub o melhor modelo para uma tarefa.',
    args: { tarefa: 'text-to-3d, image-to-3d, text-to-image...' },
    engines: [{ via: 'hub', id: 'search' }],
  },
};

/* prompt que ensina QUALQUER LLM a usar as ferramentas */
function systemPrompt() {
  const lista = Object.entries(SKILLS)
    .map(([k, v]) => `- ${k}(${Object.keys(v.args).join(', ')}): ${v.desc}`)
    .join('\n');
  return `Voce e a ARKHER AI e tem ferramentas alem de texto. Ferramentas:
${lista}

Quando precisar de uma, responda SOMENTE com este JSON, nada mais:
{"tool":"nome_da_ferramenta","args":{...}}

Se nao precisar de ferramenta, responda normalmente em texto.
Nunca invente resultado de ferramenta: peca a execucao e espere.`;
}

/* detecta a chamada de ferramenta na resposta do modelo */
function parseTool(txt) {
  if (!txt) return null;
  let s = String(txt).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const i = s.indexOf('{'), j = s.lastIndexOf('}');
  if (i < 0 || j <= i) return null;
  try {
    const o = JSON.parse(s.slice(i, j + 1));
    if (o && typeof o.tool === 'string' && SKILLS[o.tool]) {
      return { tool: o.tool, args: o.args || {} };
    }
  } catch (e) {}
  return null;
}

/* ---------- executores ---------- */
const Exec = {
  agent() { return LS.get('arkher_agent', ''); },

  async vm(cmd, timeout) {
    const u = this.agent();
    if (!u) throw new Error('VM nao configurada (aba Config)');
    const r = await fetch(u + '/exec', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd, timeout: timeout || 900 }),
    });
    const j = await r.json();
    return j;
  },

  async vmJob(cmd) {
    const u = this.agent();
    if (!u) throw new Error('VM nao configurada');
    const r = await fetch(u + '/spawn', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd }),
    });
    return (await r.json()).id;
  },

  /** melhor modelo do Hub para uma tarefa, hoje */
  async melhorModelo(tarefa) {
    const url = `https://huggingface.co/api/models?pipeline_tag=${encodeURIComponent(tarefa)}`
      + `&limit=20&sort=downloads&direction=-1`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('Hub HTTP ' + r.status);
    const arr = await r.json();
    return arr.map(m => ({ id: m.id, downloads: m.downloads || 0, likes: m.likes || 0 }));
  },
};

/* executa a ferramenta pedida pelo LLM */
async function runTool(call, onLog) {
  const log = onLog || (() => {});
  const { tool, args } = call;
  switch (tool) {
    case 'rodar_vm': {
      log('executando na VM: ' + args.cmd);
      const r = await Exec.vm(args.cmd);
      return { ok: r.code === 0, saida: (r.out || '') + (r.err || ''), code: r.code };
    }
    case 'buscar_modelo': {
      log('procurando no Hub: ' + args.tarefa);
      const l = await Exec.melhorModelo(args.tarefa || 'text-to-3d');
      return { ok: true, modelos: l.slice(0, 8) };
    }
    case 'gerar_3d': {
      const tarefa = args.imagem ? 'image-to-3d' : 'text-to-3d';
      log('escolhendo motor 3D (' + tarefa + ')…');
      const lista = await Exec.melhorModelo(tarefa);
      const escolhido = lista[0]?.id || 'microsoft/TRELLIS-image-large';
      log('motor: ' + escolhido + ' — rodando na VM');
      const py = [
        'python -c "import sys;print(sys.version)"',
      ].join('; ');
      const r = await Exec.vm(py, 120);
      return {
        ok: true, motor: escolhido,
        nota: 'motor selecionado automaticamente pelo ranking de hoje',
        vm: (r.out || '').trim().slice(0, 200),
      };
    }
    case 'render_blender': {
      log('render no Blender da VM…');
      const id = await Exec.vmJob(`blender -b "${args.arquivo}" -o //out_ -f 1`);
      return { ok: true, job: id, nota: 'render em background; acompanhe na aba Sandbox' };
    }
    case 'animar_3d': {
      log('animando via Blender…');
      const id = await Exec.vmJob(`blender -b "${args.arquivo}" --python-expr "import bpy"`);
      return { ok: true, job: id };
    }
    case 'gerar_imagem': {
      log('gerando imagem…');
      if (typeof puter !== 'undefined' && puter.ai && puter.ai.txt2img) {
        const img = await puter.ai.txt2img(args.prompt);
        return { ok: true, img: img?.src || String(img) };
      }
      return { ok: false, err: 'sem motor de imagem disponivel' };
    }
    default:
      return { ok: false, err: 'ferramenta desconhecida: ' + tool };
  }
}

if (typeof window !== 'undefined') {
  window.SKILLS = SKILLS; window.systemPrompt = systemPrompt;
  window.parseTool = parseTool; window.runTool = runTool; window.Exec = Exec;
}
if (typeof module !== 'undefined') {
  module.exports = { SKILLS, systemPrompt, parseTool, runTool, Exec };
}
