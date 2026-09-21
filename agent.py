#!/usr/bin/env python3
"""
ARKHER AGENT — o "Termux com visual".
Roda no Windows do runner (AMD EPYC 9V74 / 16GB / Win Server-11).
Expoe uma API local que a web UI consome via Tailscale.

  python agent.py

Rotas:
  GET  /health            estado da maquina (cpu, ram, disco, uptime)
  POST /exec              executa e devolve tudo de uma vez
  POST /spawn             executa em BACKGROUND -> job_id
  GET  /job?id=           saida incremental do job (streaming por polling)
  POST /kill              mata um job
  GET  /jobs              lista jobs
  GET  /ls?path=          lista arquivos
  GET  /cat?path=         le arquivo (texto)
  POST /write             escreve arquivo
  GET  /history           historico de comandos (persistido)
  POST /snapshot          salva o estado agora
  GET  /screen?scale=&q=  PRINT da tela (base64 jpeg)  <- os OLHOS
  POST /input             mouse/teclado na VM          <- as MAOS
  POST /app               abre programa (roblox/blender/...)
  GET  /guiready          existe sessao grafica ativa?
So usa a stdlib.
"""
import json, os, platform, shutil, signal, socket, subprocess, sys, threading, time, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

PORT = int(os.environ.get('ARKHER_PORT', '8765'))
STATE = os.environ.get('ARKHER_STATE') or os.path.join(os.path.expanduser('~'), 'arkher_state')
WORK = os.path.join(STATE, 'work')
os.makedirs(WORK, exist_ok=True)
HIST = os.path.join(STATE, 'history.jsonl')
IS_WIN = platform.system() == 'Windows'
BOOT = time.time()
JOBS = {}
LOCK = threading.Lock()


def shell(cmd):
    if IS_WIN:
        return ['powershell', '-NoProfile', '-NonInteractive', '-Command', cmd]
    return ['/bin/bash', '-lc', cmd]


def log_hist(entry):
    try:
        with open(HIST, 'a', encoding='utf-8') as f:
            f.write(json.dumps(entry, ensure_ascii=False) + '\n')
    except Exception:
        pass


def run_sync(cmd, timeout=600, cwd=None):
    t0 = time.time()
    try:
        p = subprocess.run(shell(cmd), capture_output=True, text=True, errors='replace',
                           timeout=timeout, cwd=cwd or WORK)
        out, err, code = p.stdout, p.stderr, p.returncode
    except subprocess.TimeoutExpired:
        out, err, code = '', f'tempo esgotado ({timeout}s) — use /spawn pra tarefas longas', 124
    except Exception as e:
        out, err, code = '', f'{type(e).__name__}: {e}', 1
    ms = int((time.time() - t0) * 1000)
    log_hist({'t': time.time(), 'cmd': cmd, 'code': code, 'ms': ms})
    return {'out': out[-60000:], 'err': err[-20000:], 'code': code, 'ms': ms}


def spawn(cmd, cwd=None):
    """roda em background e vai acumulando a saida — pra Blender, build, etc."""
    jid = uuid.uuid4().hex[:8]
    job = {'id': jid, 'cmd': cmd, 'buf': [], 'done': False, 'code': None,
           'start': time.time(), 'proc': None}
    with LOCK:
        JOBS[jid] = job

    def worker():
        try:
            p = subprocess.Popen(shell(cmd), stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                 text=True, errors='replace', bufsize=1,
                                 cwd=cwd or WORK)
            job['proc'] = p
            for line in p.stdout:
                with LOCK:
                    job['buf'].append(line.rstrip('\n'))
                    if len(job['buf']) > 5000:
                        del job['buf'][:2000]
            p.wait()
            job['code'] = p.returncode
        except Exception as e:
            with LOCK:
                job['buf'].append(f'{type(e).__name__}: {e}')
            job['code'] = 1
        job['done'] = True
        log_hist({'t': time.time(), 'cmd': cmd, 'code': job['code'],
                  'ms': int((time.time() - job['start']) * 1000), 'bg': True})

    threading.Thread(target=worker, daemon=True).start()
    return jid


def machine():
    info = {'host': socket.gethostname(), 'os': platform.platform()[:70],
            'up': int(time.time() - BOOT), 'state': STATE, 'work': WORK}
    try:
        info['cpu_count'] = os.cpu_count()
    except Exception:
        pass
    try:
        if IS_WIN:
            r = subprocess.run(shell(
                "(Get-CimInstance Win32_Processor).Name; "
                "[math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory/1GB,1); "
                "[math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB,1)"),
                capture_output=True, text=True, timeout=25)
            ls = [x.strip() for x in r.stdout.strip().split('\n') if x.strip()]
            if len(ls) >= 1: info['cpu'] = ls[0]
            if len(ls) >= 2: info['ram_gb'] = ls[1]
            if len(ls) >= 3: info['ram_free_gb'] = ls[2]
        else:
            info['cpu'] = platform.processor() or 'cpu'
        du = shutil.disk_usage(STATE)
        info['disk_free_gb'] = round(du.free / 1e9, 1)
        info['disk_total_gb'] = round(du.total / 1e9, 1)
    except Exception:
        pass
    with LOCK:
        info['jobs'] = len([j for j in JOBS.values() if not j['done']])
    return info


def snapshot():
    """salva tudo que importa antes do runner morrer"""
    try:
        meta = {'saved': time.time(), 'when': time.ctime(), 'machine': machine()}
        with open(os.path.join(STATE, 'SNAPSHOT.json'), 'w', encoding='utf-8') as f:
            json.dump(meta, f, ensure_ascii=False, indent=2)
        return meta
    except Exception as e:
        return {'err': str(e)}



# ================= OLHOS E MAOS (controle da tela) =================
# Windows: usa .NET via PowerShell. Sem pip, so stdlib.
PS_GUI = r"""
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
Add-Type @'
using System;using System.Runtime.InteropServices;
public class M {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,uint d,int e);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h,System.Text.StringBuilder s,int n);
  public static string Title(){ IntPtr h=GetForegroundWindow(); int n=GetWindowTextLength(h);
    var sb=new System.Text.StringBuilder(n+1); GetWindowText(h,sb,sb.Capacity); return sb.ToString(); }
}
'@
"""

def ps(script, timeout=60):
    """roda powershell e devolve stdout cru"""
    p = subprocess.run(['powershell','-NoProfile','-NonInteractive','-STA','-Command', script],
                       capture_output=True, timeout=timeout)
    return p.stdout.decode('utf-8','replace'), p.stderr.decode('utf-8','replace')


def grab_screen(scale=1.0, quality=55):
    """PNG/JPEG da tela inteira -> base64. Devolve (b64, w, h, erro)"""
    if not IS_WIN:
        try:
            out = os.path.join(STATE, 'shot.png')
            subprocess.run(['import','-window','root',out], timeout=30)
            import base64
            return base64.b64encode(open(out,'rb').read()).decode(), 0, 0, None
        except Exception as e:
            return None, 0, 0, str(e)
    f = os.path.join(STATE, 'shot.jpg').replace('\\','\\\\')
    sc = PS_GUI + f"""
$b=[System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height
$g=[System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.X,$b.Y,0,0,$bmp.Size)
$w=[int]($b.Width*{scale}); $h=[int]($b.Height*{scale})
if({scale} -ne 1.0){{ $r=New-Object System.Drawing.Bitmap $bmp,$w,$h; $bmp.Dispose(); $bmp=$r }}
$cod=[System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders()|?{{$_.MimeType -eq 'image/jpeg'}}
$pr=New-Object System.Drawing.Imaging.EncoderParameters 1
$pr.Param[0]=New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality),{quality}
$bmp.Save('{f}',$cod,$pr); $bmp.Dispose()
Write-Output "$w|$h|$($b.Width)|$($b.Height)|$([M]::Title())"
"""
    try:
        out, err = ps(sc, 90)
        parts = (out.strip().splitlines() or [''])[-1].split('|')
        import base64
        raw = open(os.path.join(STATE,'shot.jpg'),'rb').read()
        return (base64.b64encode(raw).decode(),
                int(parts[0]) if len(parts)>1 else 0,
                int(parts[1]) if len(parts)>1 else 0, None)
    except Exception as e:
        return None, 0, 0, f'{e} :: {err[:300] if "err" in dir() else ""}'


def do_input(act):
    """act = {do:'move|click|dblclick|right|drag|scroll|type|key|hotkey', ...}"""
    d = act.get('do')
    x, y = int(act.get('x', 0)), int(act.get('y', 0))
    if not IS_WIN:
        return {'ok': False, 'err': 'controle de tela so no Windows'}
    S = PS_GUI
    if d == 'move':
        S += f"[M]::SetCursorPos({x},{y})"
    elif d in ('click','dblclick','right','middle'):
        down, up = (2, 4) if d in ('click','dblclick') else ((8, 16) if d == 'right' else (32, 64))
        S += f"[M]::SetCursorPos({x},{y});Start-Sleep -m 60;"
        S += f"[M]::mouse_event({down},0,0,0,0);[M]::mouse_event({up},0,0,0,0);"
        if d == 'dblclick':
            S += f"Start-Sleep -m 90;[M]::mouse_event({down},0,0,0,0);[M]::mouse_event({up},0,0,0,0);"
    elif d == 'drag':
        x2, y2 = int(act.get('x2',0)), int(act.get('y2',0))
        S += (f"[M]::SetCursorPos({x},{y});Start-Sleep -m 80;[M]::mouse_event(2,0,0,0,0);"
              f"Start-Sleep -m 120;")
        for i in range(1, 11):
            S += f"[M]::SetCursorPos({x+(x2-x)*i//10},{y+(y2-y)*i//10});Start-Sleep -m 25;"
        S += "[M]::mouse_event(4,0,0,0,0);"
    elif d == 'scroll':
        amt = int(act.get('amount', -400))
        S += f"[M]::SetCursorPos({x},{y});[M]::mouse_event(2048,0,0,{amt & 0xFFFFFFFF},0);"
    elif d == 'type':
        txt = (act.get('text') or '').replace('`','``').replace('"','`"').replace('$','`$')
        txt = txt.replace('{','{{').replace('}','}}').replace('+','{+}').replace('^','{^}')
        txt = txt.replace('%','{%}').replace('~','{~}').replace('(','{(}').replace(')','{)}')
        txt = txt.replace('[','{[}').replace(']','{]}')
        S += f'[System.Windows.Forms.SendKeys]::SendWait("{txt}")'
    elif d == 'key':
        S += f'[System.Windows.Forms.SendKeys]::SendWait("{act.get("key","")}")'
    elif d == 'hotkey':
        S += f'[System.Windows.Forms.SendKeys]::SendWait("{act.get("combo","")}")'
    elif d == 'wait':
        time.sleep(min(float(act.get('sec', 1)), 30)); return {'ok': True}
    else:
        return {'ok': False, 'err': f'acao desconhecida: {d}'}
    try:
        out, err = ps(S, 60)
        return {'ok': True, 'out': out.strip()[:400], 'err': err.strip()[:400] or None}
    except Exception as e:
        return {'ok': False, 'err': str(e)}


def gui_ready():
    """checa se existe sessao grafica de verdade (senao a tela sai preta)"""
    if not IS_WIN:
        return {'ok': True, 'nota': 'nao-windows'}
    try:
        out, _ = ps("(quser) 2>&1 | Out-String", 30)
        ativo = 'Active' in out or 'Ativo' in out
        return {'ok': ativo, 'sessoes': out.strip()[:500],
                'nota': None if ativo else
                'SEM SESSAO GRAFICA ATIVA — conecte por RDP uma vez e rode o step tscon'}
    except Exception as e:
        return {'ok': False, 'err': str(e)}


class H(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def _s(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
        self.end_headers()
        try:
            self.wfile.write(body)
        except Exception:
            pass

    def do_OPTIONS(self):
        self._s({'ok': True})

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        p = u.path
        if p == '/health':
            self._s({'ok': True, **machine()})
        elif p == '/job':
            jid = (q.get('id') or [''])[0]
            frm = int((q.get('from') or ['0'])[0])
            with LOCK:
                j = JOBS.get(jid)
                if not j:
                    self._s({'ok': False, 'err': 'job nao existe'}, 404); return
                lines = j['buf'][frm:]
                self._s({'ok': True, 'id': jid, 'lines': lines,
                         'next': frm + len(lines), 'done': j['done'], 'code': j['code'],
                         'sec': int(time.time() - j['start'])})
        elif p == '/jobs':
            with LOCK:
                self._s({'ok': True, 'items': [
                    {'id': j['id'], 'cmd': j['cmd'][:90], 'done': j['done'],
                     'code': j['code'], 'sec': int(time.time() - j['start'])}
                    for j in JOBS.values()]})
        elif p == '/ls':
            path = (q.get('path') or [WORK])[0]
            try:
                items = []
                for n in sorted(os.listdir(path))[:500]:
                    fp = os.path.join(path, n)
                    try:
                        items.append({'name': n, 'dir': os.path.isdir(fp),
                                      'size': os.path.getsize(fp) if os.path.isfile(fp) else 0})
                    except Exception:
                        pass
                self._s({'ok': True, 'path': os.path.abspath(path), 'items': items})
            except Exception as e:
                self._s({'ok': False, 'err': str(e)}, 400)
        elif p == '/cat':
            path = (q.get('path') or [''])[0]
            try:
                with open(path, encoding='utf-8', errors='replace') as f:
                    self._s({'ok': True, 'path': path, 'text': f.read(200000)})
            except Exception as e:
                self._s({'ok': False, 'err': str(e)}, 400)
        elif p == '/screen':
            sc = float((q.get('scale') or ['0.5'])[0])
            qa = int((q.get('q') or ['55'])[0])
            b64, w, h, err = grab_screen(sc, qa)
            if err:
                self._s({'ok': False, 'err': err}, 500)
            else:
                self._s({'ok': True, 'img': 'data:image/jpeg;base64,' + b64,
                         'w': w, 'h': h})
        elif p == '/guiready':
            self._s(gui_ready())
        elif p == '/history':
            items = []
            try:
                with open(HIST, encoding='utf-8') as f:
                    items = [json.loads(x) for x in f.read().strip().split('\n') if x][-200:]
            except Exception:
                pass
            self._s({'ok': True, 'items': items})
        else:
            self._s({'ok': False, 'err': 'rota desconhecida'}, 404)

    def do_POST(self):
        n = int(self.headers.get('Content-Length', 0) or 0)
        try:
            b = json.loads(self.rfile.read(n) or b'{}')
        except Exception:
            self._s({'ok': False, 'err': 'json invalido'}, 400); return
        p = urlparse(self.path).path
        if p == '/exec':
            cmd = (b.get('cmd') or '').strip()
            if not cmd:
                self._s({'ok': False, 'err': 'cmd vazio'}, 400); return
            r = run_sync(cmd, int(b.get('timeout') or 600), b.get('cwd'))
            self._s({'ok': r['code'] == 0, **r})
        elif p == '/spawn':
            cmd = (b.get('cmd') or '').strip()
            if not cmd:
                self._s({'ok': False, 'err': 'cmd vazio'}, 400); return
            self._s({'ok': True, 'id': spawn(cmd, b.get('cwd'))})
        elif p == '/kill':
            with LOCK:
                j = JOBS.get(b.get('id'))
            if j and j.get('proc'):
                try:
                    j['proc'].kill()
                except Exception:
                    pass
            self._s({'ok': True})
        elif p == '/write':
            try:
                path = b.get('path') or 'arquivo.txt'
                if not os.path.isabs(path):
                    path = os.path.join(WORK, path)
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with open(path, 'w', encoding='utf-8') as f:
                    f.write(b.get('content') or '')
                self._s({'ok': True, 'path': path})
            except Exception as e:
                self._s({'ok': False, 'err': str(e)}, 400)
        elif p == '/input':
            acts = b.get('acts') or ([b] if b.get('do') else [])
            res = []
            for a in acts[:60]:
                res.append(do_input(a))
                time.sleep(float(a.get('after', 0.25)))
            shot = None
            if b.get('shot'):
                im, w, h, e = grab_screen(float(b.get('scale') or 0.5))
                if im: shot = 'data:image/jpeg;base64,' + im
            self._s({'ok': all(r.get('ok') for r in res), 'res': res, 'img': shot})
        elif p == '/app':
            # abre programa por nome amigavel
            nome = (b.get('nome') or '').lower()
            mapa = {
                'roblox': r'%LOCALAPPDATA%\\Roblox\\Versions\\RobloxStudioLauncherBeta.exe',
                'blender': 'blender',
                'explorer': 'explorer.exe',
                'notepad': 'notepad.exe',
                'cmd': 'cmd.exe',
            }
            alvo = b.get('caminho') or mapa.get(nome)
            if not alvo:
                self._s({'ok': False, 'err': f'nao sei abrir "{nome}"'}, 400); return
            try:
                jid = spawn(f'Start-Process "{alvo}"')
                time.sleep(float(b.get('esperar') or 6))
                im, w, h, e = grab_screen(0.5)
                self._s({'ok': True, 'job': jid,
                         'img': ('data:image/jpeg;base64,' + im) if im else None})
            except Exception as e:
                self._s({'ok': False, 'err': str(e)}, 400)
        elif p == '/snapshot':
            self._s({'ok': True, 'meta': snapshot()})
        else:
            self._s({'ok': False, 'err': 'rota desconhecida'}, 404)

    def log_message(self, *a):
        pass


def on_die(*_):
    snapshot()
    sys.exit(0)


if __name__ == '__main__':
    for s in ('SIGTERM', 'SIGINT', 'SIGBREAK'):
        if hasattr(signal, s):
            try:
                signal.signal(getattr(signal, s), on_die)
            except Exception:
                pass
    # salva sozinho a cada 2 min (se o runner cair de repente, nao perde tudo)
    def autosave():
        while True:
            time.sleep(120)
            snapshot()
    threading.Thread(target=autosave, daemon=True).start()

    srv = ThreadingHTTPServer(('0.0.0.0', PORT), H)
    m = machine()
    print(f"ARKHER AGENT :{PORT}  {m.get('cpu','?')}  {m.get('ram_gb','?')}GB  work={WORK}", flush=True)
    srv.serve_forever()
