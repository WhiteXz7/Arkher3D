/* NEXUS — interface, sandbox e integracoes */
'use strict';
const $ = s => document.querySelector(s);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x) n.textContent = x; return n; };
const icon = id => `<svg class="ico"><use href="#${id}"/></svg>`;

/* ---------- abas ---------- */
document.querySelectorAll('.tab').forEach(t => t.onclick = () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x === t));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('on', v.id === 'v-' + t.dataset.v));
});
$('#b-cfg').onclick = () => document.querySelector('.tab[data-v="cfg"]').click();

/* ---------- chat ---------- */
const logEl = $('#log');
function addMsg(who, txt, cls) {
  const m = el('div', 'msg' + (who === 'me' ? ' me' : ''));
  const av = el('div', 'av');
  av.innerHTML = icon(who === 'me' ? 'i-user' : 'i-bolt');
  const b = el('div', 'bub');
  const h = el('div', 'who'); h.textContent = who === 'me' ? 'Você' : 'ARKHER';
  const body = el('div', 'body' + (cls ? ' ' + cls : ''));
  body.textContent = txt || '';
  b.append(h, body); m.append(av, b); logEl.append(m);
  logEl.scrollTop = logEl.scrollHeight;
  return { body, head: h };
}
function fmt(body) {
  const raw = body.textContent;
  const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  body.innerHTML = esc(raw)
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_, l, c) => `<pre><code>${c.replace(/\n$/, '')}</code></pre>`)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>');
}

const history = [];
let busy = false;

async function send() {
  const inp = $('#inp');
  const text = inp.value.trim();
  if (!text || busy) return;
  inp.value = ''; inp.style.height = 'auto';
  addMsg('me', text);
  history.push({ role: 'user', content: text });
  busy = true;
  const out = addMsg('ai', '');
  const dot = $('#d-cur');
  dot.className = 'dot work';
  try {
    const r = await Arkher.ask(history.slice(-12), {
      stage: /codigo|code|script|programa|lua|python|erro/i.test(text) ? 'code' : 'chat',
      onTry: (it, n) => {
        $('#s-cur').textContent = it.id.split('/').pop().slice(0, 22);
        out.head.innerHTML = `ARKHER <span class="tag">${it.src} · tentativa ${n}</span>`;
      },
      onDelta: t => { out.body.textContent += t; logEl.scrollTop = logEl.scrollHeight; },
    });
    if (!out.body.textContent) out.body.textContent = r.text;
    fmt(out.body);
    history.push({ role: 'assistant', content: r.text });
    out.head.innerHTML = `ARKHER <span class="tag">${r.src} · ${r.model.split('/').pop()}</span>`;
    $('#s-cur').textContent = r.model.split('/').pop().slice(0, 22);
    dot.className = 'dot on';
  } catch (e) {
    out.body.className = 'body err';
    out.body.textContent = 'Falhou: ' + e.message
      + '\n\nTodos os modelos das duas listas foram tentados. Verifique o login do Puter e o token HF em Config.';
    dot.className = 'dot bad';
  }
  busy = false;
  refreshBan();
}
$('#b-send').onclick = send;
$('#inp').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});
$('#inp').addEventListener('input', e => {
  e.target.style.height = 'auto';
  e.target.style.height = Math.min(e.target.scrollHeight, 180) + 'px';
});

/* ---------- catalogos ---------- */
async function loadCatalogs() {
  $('#d-net').className = 'dot work';
  let p = 0, h = 0;
  try { p = (await Puter.list()).length; } catch (e) {}
  try { h = HF.token() ? (await HF.list()).length : 0; } catch (e) {}
  $('#n-puter').textContent = p || '—';
  $('#n-hf').textContent = HF.token() ? (h || '—') : 'sem token';
  $('#n-tot').textContent = p + h;
  $('#s-models').textContent = (p + h) + ' modelos';
  $('#d-net').className = 'dot ' + (p + h > 0 ? 'on' : 'bad');
}
function refreshBan() { $('#n-ban').textContent = Breaker.banned.size; }
$('#b-reload').onclick = () => { Puter.models = null; HF.models = null; loadCatalogs(); };
$('#b-unban').onclick = () => { Breaker.clear(); refreshBan(); };

/* ---------- config ---------- */
$('#f-hf').value = LS.get('arkher_hf_token', '');
$('#f-agent').value = LS.get('arkher_agent', '');
$('#b-savehf').onclick = () => {
  LS.set('arkher_hf_token', $('#f-hf').value.trim());
  HF.models = null; loadCatalogs();
  $('#b-savehf').innerHTML = icon('i-check') + 'Salvo';
  setTimeout(() => $('#b-savehf').innerHTML = icon('i-check') + 'Salvar', 1500);
};
$('#b-saveagent').onclick = () => {
  LS.set('arkher_agent', $('#f-agent').value.trim().replace(/\/+$/, ''));
  $('#b-saveagent').innerHTML = icon('i-check') + 'Salvo';
  setTimeout(() => $('#b-saveagent').innerHTML = icon('i-check') + 'Salvar', 1500);
  pingAgent();
};
$('#b-login').onclick = async () => {
  try { await puter.auth.signIn(); $('#s-who').textContent = 'Conectado.'; loadCatalogs(); }
  catch (e) { $('#s-who').textContent = 'Falhou: ' + e.message; }
};
$('#b-who').onclick = async () => {
  try { const u = await puter.auth.getUser(); $('#s-who').textContent = 'Conta: ' + (u.username || u.email || '?'); }
  catch (e) { $('#s-who').textContent = 'Não conectado.'; }
};

/* ============================================================
   SANDBOX — terminal ligado ao agente do PC (Tailscale)
   ============================================================ */
const termEl = $('#term');
function put(txt, cls) {
  const l = el('div', 'l-' + (cls || 'out'), txt);
  termEl.append(l); termEl.scrollTop = termEl.scrollHeight;
}
put('ARKHER Sandbox — Windows via Tailscale', 'sys');
put('Comandos: qualquer coisa do PowerShell/CMD.', 'sys');
put('Prefixo "ia:" faz a IA escrever e executar o comando pra você.', 'sys');
put('', 'sys');

function agentURL() { return LS.get('arkher_agent', ''); }

async function pingAgent() {
  const u = agentURL();
  const d = $('#d-rdp'), s = $('#s-rdp');
  if (!u) { d.className = 'dot'; s.textContent = 'sem agente'; return false; }
  d.className = 'dot work'; s.textContent = 'checando…';
  try {
    const r = await fetch(u + '/health', { method: 'GET' });
    const j = await r.json();
    d.className = 'dot on';
    s.textContent = (j.cpu ? j.cpu.replace(/\(R\)|\(TM\)|CPU/g,'').trim().slice(0,28) : (j.host||'online'))
      + (j.ram_gb ? ' · ' + j.ram_gb + 'GB' : '') + (j.cpu_count ? ' · ' + j.cpu_count + ' nucleos' : '');
    return true;
  } catch (e) {
    d.className = 'dot bad'; s.textContent = 'offline';
    return false;
  }
}
$('#b-conn').onclick = async () => {
  const ok = await pingAgent();
  put(ok ? '> agente conectado' : '> agente offline — confira a URL em Config e se o workflow está rodando',
      ok ? 'ok' : 'err');
};
$('#b-clear').onclick = () => termEl.innerHTML = '';
$('#b-save').onclick = () => {
  const blob = new Blob([termEl.innerText], { type: 'text/plain' });
  const a = el('a'); a.href = URL.createObjectURL(blob);
  a.download = 'arkher-sessao-' + Date.now() + '.txt'; a.click();
};

async function runCmd(cmd) {
  const u = agentURL();
  if (!u) { put('sem agente configurado (aba Config)', 'err'); return; }
  // trava: se o outro estiver usando a VM, avisa em vez de atropelar
  if (typeof Sync !== 'undefined' && Sync.ligado()) {
    try {
      const dono = await Sync.pegarTrava(120);
      if (dono) { put('VM ocupada por ' + String(dono.who).split('@')[0] + ' — aguarde', 'err'); return; }
      Sync.log('cmd', cmd);
    } catch (e) {}
  }
  // tarefas longas vao pra background com saida ao vivo
  const longa = /blender|ffmpeg|choco|winget|pip install|npm i|git clone|build|render|python .*\.py/i.test(cmd);
  try {
    if (longa) {
      const r = await fetch(u + '/spawn', { method:'POST',
        headers:{'Content-Type':'application/json'}, body: JSON.stringify({cmd}) });
      const j = await r.json();
      if (!j.ok) { put('erro: ' + (j.err||'?'), 'err'); return; }
      put('[job ' + j.id + ' em background]', 'sys');
      let from = 0, tick = 0;
      while (true) {
        await new Promise(s => setTimeout(s, 900));
        const q = await (await fetch(u + '/job?id=' + j.id + '&from=' + from)).json();
        if (!q.ok) { put('job sumiu', 'err'); break; }
        for (const ln of q.lines) put(ln, 'out');
        from = q.next;
        if (q.done) { put('[saida ' + q.code + ' · ' + q.sec + 's]', q.code === 0 ? 'ok' : 'err');
          if (typeof Sync !== 'undefined' && Sync.ligado()) Sync.soltarTrava(); break; }
        if (++tick > 1200) { put('[ainda rodando — job ' + j.id + ']', 'sys'); break; }
      }
      return;
    }
    const r = await fetch(u + '/exec', { method:'POST',
      headers:{'Content-Type':'application/json'}, body: JSON.stringify({cmd}) });
    const j = await r.json();
    if (j.out) put(j.out.replace(/\s+$/, ''), 'out');
    if (j.err) put(j.err.replace(/\s+$/, ''), 'err');
    put('[saida ' + (j.code ?? '?') + ' · ' + (j.ms ?? '?') + 'ms]', j.code === 0 ? 'ok' : 'err');
    if (typeof Sync !== 'undefined' && Sync.ligado()) Sync.soltarTrava();
  } catch (e) {
    put('falha ao falar com o agente: ' + e.message, 'err');
    pingAgent();
  }
}

async function termSend() {
  const i = $('#cmd'); const v = i.value.trim();
  if (!v) return;
  i.value = '';
  put('PS> ' + v, 'cmd');
  if (/^ia:/i.test(v)) {
    const pedido = v.replace(/^ia:/i, '').trim();
    put('(pensando…)', 'sys');
    try {
      const r = await Arkher.ask([
        { role: 'system', content: 'Voce gera UM comando PowerShell para Windows. Responda SO o comando, sem crases, sem explicacao.' },
        { role: 'user', content: pedido },
      ], { stage: 'code' });
      const cmd = r.text.trim().replace(/^```\w*\n?|```$/g, '').split('\n')[0];
      put('PS> ' + cmd + '   [' + r.model.split('/').pop() + ']', 'cmd');
      await runCmd(cmd);
    } catch (e) { put('IA falhou: ' + e.message, 'err'); }
    return;
  }
  if (/^http\s/i.test(v)) {
    const m = v.match(/^http\s+(\w+)\s+(\S+)/i) || [];
    try {
      const r = await fetch(m[2], { method: (m[1] || 'GET').toUpperCase() });
      const t = await r.text();
      put('HTTP ' + r.status, r.ok ? 'ok' : 'err');
      put(t.slice(0, 4000), 'out');
    } catch (e) { put('erro: ' + e.message + ' (CORS? use o agente)', 'err'); }
    return;
  }
  await runCmd(v);
}
$('#b-run').onclick = termSend;
$('#cmd').addEventListener('keydown', e => { if (e.key === 'Enter') termSend(); });

/* ---------- integracoes ---------- */
const INTEGRACOES = [
  ['Blender', 'renderizar / modelar 3D', 'blender --background --python-expr "import bpy; bpy.ops.mesh.primitive_cube_add()"'],
  ['Roblox Studio', 'abrir projeto', 'Start-Process "C:\\Program Files\\Roblox\\Versions\\RobloxStudioLauncherBeta.exe"'],
  ['Python', 'rodar script', 'python -c "print(\'ola do PC\')"'],
  ['Node.js', 'rodar JS', 'node -e "console.log(process.version)"'],
  ['FFmpeg', 'converter vídeo', 'ffmpeg -version'],
  ['Git', 'clonar repositório', 'git clone https://github.com/usuario/repo'],
  ['Arquivos', 'listar pasta', 'Get-ChildItem C:\\ | Select-Object -First 20'],
  ['Sistema', 'CPU e memória', 'Get-CimInstance Win32_ComputerSystem | Format-List'],
  ['Download', 'baixar arquivo', 'Invoke-WebRequest -Uri URL -OutFile arquivo'],
  ['Winget', 'instalar programa', 'winget install --id Git.Git -e'],
  ['API livre', 'chamada HTTP', 'http GET https://api.github.com'],
  ['Captura', 'print da tela', 'Add-Type -AssemblyName System.Windows.Forms'],
];
const g = $('#g-integ');
INTEGRACOES.forEach(([nm, ds, cmd]) => {
  const t = el('div', 'itile');
  t.innerHTML = `<div class="nm">${nm}</div><div class="ds">${ds}</div>`;
  t.onclick = () => {
    document.querySelector('.tab[data-v="term"]').click();
    $('#cmd').value = cmd; $('#cmd').focus();
  };
  g.append(t);
});

/* ---------- boot ---------- */
addMsg('ai', 'Pronto. Pergunte qualquer coisa — se um modelo falhar eu troco sozinho, '
  + 'primeiro pelo catálogo do Puter e depois pelo Hugging Face.\n\n'
  + 'Na aba Sandbox você comanda seu PC Windows pelo Tailscale.');
loadCatalogs();
pingAgent();
setInterval(pingAgent, 30000);

/* ============================================================
   LOGIN
   ============================================================ */
(function(){
  const gate=$('#gate');
  const c=Auth.cfg();
  $('#g-url').value=c.url||''; $('#g-anon').value=c.anon||'';
  $('#g-allow').value=(LS.get('arkher_allow',[])||[]).join(', ');
  function show(v){ gate.style.display=v?'flex':'none'; }
  function msg(t,err){ const m=$('#g-msg'); m.textContent=t; m.style.color=err?'var(--err)':'var(--dim)'; }
  $('#g-save').onclick=()=>{
    Auth.setCfg($('#g-url').value,$('#g-anon').value);
    Auth.setAllow($('#g-allow').value.split(',').map(s=>s.trim()).filter(Boolean));
    msg('Configuração salva.');
  };
  $('#g-in').onclick=async()=>{
    try{ msg('entrando…'); await Auth.entrar($('#g-mail').value.trim(),$('#g-pass').value);
      show(false); boot(); }catch(e){ msg(e.message,true); }
  };
  $('#g-up').onclick=async()=>{
    try{ msg('criando…'); const j=await Auth.criar($('#g-mail').value.trim(),$('#g-pass').value);
      msg(j.access_token?'Conta criada. Entrando…':'Confirme o e-mail e volte pra entrar.');
      if(j.access_token){ show(false); boot(); } }catch(e){ msg(e.message,true); }
  };
  $('#b-out').onclick=()=>{ Auth.sair(); location.reload(); };
  window.__gate=show;
  if(!Auth.ativo()) show(true);
})();

/* ============================================================
   CAPACIDADES
   ============================================================ */
(function(){
  const g=$('#g-skills');
  Object.entries(SKILLS).forEach(([k,v])=>{
    const t=el('div','itile');
    t.innerHTML=`<div class="nm">${k}</div><div class="ds">${v.desc}</div>`;
    t.onclick=()=>{ document.querySelector('.tab[data-v="chat"]').click();
      $('#inp').value='use a ferramenta '+k+' para: '; $('#inp').focus(); };
    g.append(t);
  });
  $('#sk-go').onclick=async()=>{
    const o=$('#sk-out'); o.textContent='consultando o Hub…';
    try{
      const l=await Exec.melhorModelo($('#sk-task').value);
      o.innerHTML='<b>Top de hoje:</b><br>'+l.slice(0,8).map((m,i)=>
        `${i+1}. <code>${m.id}</code> — ${(m.downloads/1000).toFixed(0)}k downloads`).join('<br>');
    }catch(e){ o.textContent='falhou: '+e.message; }
  };
})();

/* ============================================================
   3D
   ============================================================ */
(function(){
  $('#t3-setup').onclick=async()=>{
    const o=$('#t3-out'); o.textContent='instalando dependências na VM (demora)…';
    try{
      const id=await Exec.vmJob('pip install torch --index-url https://download.pytorch.org/whl/cpu; pip install trimesh transformers accelerate');
      o.innerHTML='job <code>'+id+'</code> rodando. Veja o progresso na aba Sandbox.';
    }catch(e){ o.textContent='falhou: '+e.message; }
  };
  $('#t3-go').onclick=async()=>{
    const o=$('#t3-out'); const p=$('#t3-p').value.trim();
    if(!p){ o.textContent='descreva o que criar'; return; }
    o.textContent='escolhendo o melhor motor de hoje…';
    try{
      const r=await runTool({tool:'gerar_3d',args:{prompt:p}}, t=>{o.textContent=t;});
      o.innerHTML='motor escolhido: <code>'+(r.motor||'?')+'</code><br>'+(r.nota||'')
        +'<br><br>Para gerar de fato, instale as dependências (botão ao lado) — o TRELLIS roda em CPU, porém devagar.';
    }catch(e){ o.textContent='falhou: '+e.message; }
  };
  $('#t3-ls').onclick=async()=>{
    const o=$('#t3-files'); const u=LS.get('arkher_agent','');
    if(!u){ o.textContent='VM não configurada'; return; }
    try{ const j=await (await fetch(u+'/ls')).json();
      o.innerHTML=j.items?.length? j.items.map(i=>`<code>${i.name}</code> ${i.dir?'(pasta)':(i.size+' B')}`).join('<br>') : 'pasta vazia';
    }catch(e){ o.textContent='falhou: '+e.message; }
  };
})();

/* ============================================================
   VM
   ============================================================ */
(function(){
  async function ref(){
    const u=LS.get('arkher_agent',''); if(!u) return;
    try{
      const j=await (await fetch(u+'/health')).json();
      $('#vm-cpu').textContent=(j.cpu||'—').replace(/\(R\)|\(TM\)/g,'').slice(0,34);
      $('#vm-ram').textContent=(j.ram_gb?j.ram_gb+' GB':'—')+(j.ram_free_gb?' ('+j.ram_free_gb+' livre)':'');
      $('#vm-cores').textContent=j.cpu_count||'—';
      $('#vm-disk').textContent=j.disk_free_gb?j.disk_free_gb+' / '+j.disk_total_gb+' GB':'—';
      $('#vm-up').textContent=j.up?Math.floor(j.up/60)+' min':'—';
    }catch(e){}
  }
  $('#vm-ref').onclick=ref;
  $('#vm-vnc').onclick=async()=>{
    const o=$('#vm-vncout'); o.textContent='instalando servidor de tela…';
    try{
      const id=await Exec.vmJob('choco install -y tightvnc --no-progress');
      o.innerHTML='job <code>'+id+'</code>. Depois use o app Remote Desktop com o IP do Tailscale — é mais estável que noVNC.';
    }catch(e){ o.textContent='falhou: '+e.message; }
  };
  $('#vm-open').onclick=()=>{
    const u=LS.get('arkher_agent','').replace(/^https?:\/\//,'').split(':')[0];
    $('#vm-vncout').innerHTML=u? 'No app <b>Remote Desktop</b>: <code>'+u+'</code> · usuário <code>nexus</code> · senha no log do workflow' : 'configure a VM primeiro';
  };
  $('#vm-rclone').onclick=async()=>{
    const o=$('#vm-cloud'); o.textContent='instalando rclone…';
    try{ const id=await Exec.vmJob('choco install -y rclone --no-progress');
      o.innerHTML='job <code>'+id+'</code>. Depois rode <code>rclone config</code> pelo RDP para ligar Drive/MediaFire.';
    }catch(e){ o.textContent='falhou: '+e.message; }
  };
  $('#vm-push').onclick=async()=>{
    const o=$('#vm-cloud'); o.textContent='enviando…';
    try{ const id=await Exec.vmJob('rclone copy arkher_state\\work remoto:arkher -P');
      o.innerHTML='job <code>'+id+'</code> — acompanhe no Sandbox.';
    }catch(e){ o.textContent='falhou: '+e.message; }
  };
  setInterval(()=>{ if($('#v-vm').classList.contains('on')) ref(); }, 15000);
  window.__vmref=ref;
})();

/* ============================================================
   COFRE
   ============================================================ */
(function(){
  function draw(){
    const box=$('#v-list'); const prov=$('#v-prov').value;
    const items=Vault.all(prov); const st=Vault.stats(prov);
    if(!items.length){ box.textContent='nenhum token cadastrado'; return; }
    box.innerHTML='<b>'+st.livres+' de '+st.total+' disponíveis</b><br>'+items.map(i=>{
      const on=(i.cooldownUntil||0)<Date.now();
      return `<span style="color:${on?'var(--ok)':'var(--warn)'}">●</span> ${i.label}`
        +` — ${i.uses||0} usos${on?'':' (descansando: '+(i.motivo||'?')+')'}`
        +` <a href="#" data-del="${i.id}" style="color:var(--err)">remover</a>`;
    }).join('<br>');
    box.querySelectorAll('[data-del]').forEach(a=>a.onclick=e=>{
      e.preventDefault(); Vault.remove(a.dataset.del); draw(); });
  }
  $('#v-add').onclick=()=>{
    const ok=Vault.add($('#v-prov').value,$('#v-tok').value,$('#v-lab').value.trim());
    if(ok){ $('#v-tok').value=''; $('#v-lab').value=''; }
    draw();
  };
  $('#v-prov').onchange=draw;
  window.__vaultdraw=draw;
  draw();
})();

/* boot pos-login */
function boot(){
  loadCatalogs(); pingAgent();
  if(window.__vmref) window.__vmref();
  if(window.__vaultdraw) window.__vaultdraw();
}
if(Auth.ativo()) boot();

/* ============================================================
   EQUIPE — VM compartilhada entre as contas
   ============================================================ */
(function(){
  if (typeof Sync === 'undefined') return;
  const msg=t=>{ const m=$('#crew-msg'); if(m) m.textContent=t; };

  async function puxar(){
    if(!Sync.ligado()) return;
    try{
      const vm=await Sync.getVM();
      if(vm){
        $('#crew-url').textContent=vm.url;
        $('#crew-by').textContent=vm.por||'—';
        // adota automaticamente se eu ainda nao tenho
        if(!LS.get('arkher_agent','')){ LS.set('arkher_agent',vm.url); pingAgent(); }
      }
      const on=await Sync.online();
      const nomes=on.map(o=>String(o.who).split('@')[0]);
      $('#crew-on').textContent=nomes.join(', ')||'só você';
      const sc=$('#s-crew'); if(sc) sc.textContent=on.length+' online';
      const lk=await Sync.get('lock',null);
      $('#crew-lock').textContent=(lk&&lk.until>Date.now())?('com '+String(lk.who).split('@')[0]):'livre';
      const novos=await Sync.novos();
      if(novos.length){
        const box=$('#crew-log');
        novos.forEach(l=>{ const d=el('div',null,String(l.who).split('@')[0]+' › '+l.txt); box.prepend(d); });
        while(box.children.length>40) box.lastChild.remove();
      }
    }catch(e){}
  }

  $('#crew-pub').onclick=async()=>{
    const u=LS.get('arkher_agent','');
    if(!u){ msg('configure a URL do agente em Config primeiro'); return; }
    try{ await Sync.setVM(u); msg('publicado — seu amigo já pode usar'); puxar(); }
    catch(e){ msg('falhou: '+e.message); }
  };
  $('#crew-pull').onclick=async()=>{
    try{
      const vm=await Sync.getVM();
      if(!vm){ msg('ninguém publicou ainda'); return; }
      LS.set('arkher_agent',vm.url);
      const f=$('#f-agent'); if(f) f.value=vm.url;
      msg('usando a VM de '+vm.por); pingAgent();
    }catch(e){ msg('falhou: '+e.message); }
  };

  // registra na nuvem o que rodou na VM
  const _run=window.runCmd;
  if(typeof runCmd==='function'){
    const orig=runCmd;
    window.runCmd=async function(cmd){
      try{ await Sync.log('cmd',cmd); }catch(e){}
      return orig(cmd);
    };
  }

  (async()=>{
    if(!Sync.ligado()) return;
    await Sync.iniciarLog();
    Sync.bater(); puxar();
    setInterval(()=>{ Sync.bater(); }, 45000);
    setInterval(puxar, 12000);
  })();
  window.__crew=puxar;
})();
