# ARKHER AI

Plataforma de IA com acesso restrito, VM Windows compartilhada e piloto autonomo
(a IA olha a tela e opera a maquina).

## O que tem

| Aba | O que faz |
|---|---|
| Chat | Cascata infinita: Puter -> HuggingFace. Na frente, 1 modelo so |
| Sandbox | Terminal real na VM Windows (streaming por polling) |
| Capacidades | 6 ferramentas que qualquer modelo da cascata pode chamar |
| 3D | Busca no HF o melhor motor 3D do dia (sem lista fixa) |
| VM | Specs, rclone (MediaFire/Drive), VM compartilhada do time |
| **Piloto** | **A IA ve a tela e opera a VM: mouse, teclado, Roblox Studio, Blender** |
| Integracoes | Tokens e cofre de rotacao |
| Config | Supabase, login, lista de acesso |

## Subir o site

Qualquer host estatico serve (GitHub Pages, Netlify, Cloudflare Pages).
Sao arquivos estaticos puros, sem build.

**GitHub Pages:** Settings -> Pages -> Source: `main` / root.

## Antes de usar

1. **Supabase** — crie o projeto e rode o SQL que esta em `PUBLICAR.txt`
   (2 tabelas + RLS). Sem isso o login e a VM compartilhada nao funcionam.
2. **Secrets do Actions** (Settings -> Secrets -> Actions):
   - `TAILSCALE_AUTH_KEY` — chave reutilizavel do Tailscale
   - `PAT_TOKEN` — Personal Access Token com escopo `workflow`
     (o `GITHUB_TOKEN` padrao NAO consegue religar o workflow sozinho)
3. **Actions -> Read and write permissions** em Settings -> Actions -> General.

## Ligar a VM

Actions -> *ARKHER Sandbox* -> **Run workflow**. Em ~4 min o step
**COMO ACESSAR** imprime:

```
http://100.x.y.z:8765      <- cole na aba VM do site
RDP: 100.x.y.z  usuario: nexus  senha: ...
```

Cole no site e clique em **Publicar minha VM** — seu amigo pega automatico.

> Na primeira sessao conecte por RDP uma vez. Isso garante a sessao grafica,
> sem ela o Piloto tira print preto.

## Arquivos

```
index.html   UI (8 abas, icones SVG, zero emoji)
core.js      storage
vault.js     cofre de tokens com rotacao e cooldown
auth.js      login Supabase (email + senha)
sync.js      VM compartilhada: presenca, log, trava anticolisao
pilot.js     loop autonomo: ve a tela -> decide -> clica
skills.js    catalogo de capacidades e ferramentas
app.js       cascata Puter -> HF, ranking de modelos
ui.js        toda a interface
agent.py     agente HTTP que roda NA VM (so stdlib)
.github/workflows/arkher.yml   sobe a VM Windows e religa sozinha
```

## Limites reais

- Sessao da VM dura ~6h e religa sozinha; o **IP muda** a cada sessao.
- Repo privado: 2.000 min/mes de Actions. Uso 24/7 nao e o previsto.
- Roblox Studio instala, mas o **login na conta Roblox e manual**.
- Piloto leva ~4-8s por passo. E autonomo, nao e instantaneo.
- Nenhum modelo 3D do HF tem API hospedada: roda na VM (CPU, lento) ou via Spaces.
