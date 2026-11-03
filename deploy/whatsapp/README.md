# WhatsApp do netzsales por QR Code

A Netz conversa no WhatsApp por uma "ponte" chamada **GOWA**, a mesma do NetzOS.
Ela funciona como um WhatsApp Web sem tela e precisa ficar ligada 24 horas, por
isso mora num servidor e não na Vercel. O resto (telas, Netz, banco) continua
como está.

```
celular ── WhatsApp ── ponte GOWA (servidor) ── túnel Cloudflare ── netzsales (Vercel)
```

- A ponte não abre nenhuma porta no servidor. A Vercel chega nela pelo túnel,
  com usuário e senha.
- Cada mensagem recebida vira um aviso assinado (`X-Hub-Signature-256`) para
  `/api/whatsapp/webhook`. Aviso sem a assinatura certa é recusado.
- Grupos e mensagens do próprio número são ignorados.

## O que precisa

1. Um servidor Linux com Docker (pode ser o mesmo do NetzOS; a ponte do
   netzsales fica numa caixinha separada, com o nome `netzsales-whatsapp`).
2. Um domínio na Cloudflare, para o endereço da ponte
   (ex.: `whatsapp.seudominio.com.br`).
3. Um chip novo, só do netzsales.

## Passo a passo

1. **Criar o túnel na Cloudflare.**
   Entre em https://one.dash.cloudflare.com › Networks › Tunnels ›
   **Create a tunnel** › Cloudflared. Dê o nome `netzsales-whatsapp`.
   Copie o token que aparece no comando (o texto longo que começa com `eyJ`).
   Em **Public hostnames**, adicione: subdomínio `whatsapp`, seu domínio,
   Service `HTTP` e URL `gowa:3000`. Salve.
2. **Subir a ponte no servidor.** Copie esta pasta para o servidor
   (ex.: `/opt/netzsales/whatsapp`) e rode:
   ```bash
   bash setup.sh
   ```
   Ele pergunta o endereço do netzsales e o token do túnel, cria as senhas
   sozinho e mostra as 4 variáveis para a Vercel.
3. **Vercel.** Abra
   https://vercel.com/netz-os/controle-vendas-estoque/settings/environment-variables
   e crie as 4 variáveis que o `setup.sh` mostrou (`WHATSAPP_GOWA_URL`,
   `WHATSAPP_GOWA_USER`, `WHATSAPP_GOWA_PASSWORD`, `WHATSAPP_WEBHOOK_SECRET`).
   Depois, em Deployments, abra o último e toque em **Redeploy**.
4. **Conectar o número.** No netzsales, Plataforma › WhatsApp ›
   **Conectar número**. No celular do chip novo: WhatsApp › Aparelhos
   conectados › Conectar um aparelho, e aponte para o QR Code.
5. **Testar.** No painel, toque no botão do WhatsApp no alto da tela. A
   conversa abre com uma mensagem pronta; envie. Depois escreva "oi".

Para ver as variáveis de novo: `bash setup.sh vercel`.

## Variáveis

| Onde | Nome | Para quê |
| --- | --- | --- |
| Vercel | `WHATSAPP_GOWA_URL` | Endereço público da ponte (o do túnel) |
| Vercel | `WHATSAPP_GOWA_USER` / `WHATSAPP_GOWA_PASSWORD` | Entrar na ponte |
| Vercel | `WHATSAPP_WEBHOOK_SECRET` | Conferir a assinatura dos avisos |
| Vercel (opcional) | `WHATSAPP_DEVICE_ID` | Nome do aparelho na ponte (padrão `netzsales`) |
| Servidor (`.env`) | `NETZSALES_URL`, `TUNNEL_TOKEN`, `GOWA_*` | Criados pelo `setup.sh`; nunca vão para o repositório |

## Cuidados

O QR Code não é o caminho oficial da Meta. Funciona (o NetzOS usa), mas o
número pode ser bloqueado se parecer robô de disparo. Use chip próprio do
netzsales e deixe a Netz só responder quem escreveu para ela. Se um dia
precisar, dá para trocar a ponte pela API oficial sem mudar as telas.
