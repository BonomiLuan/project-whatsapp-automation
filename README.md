# 🛍️ WhatsApp Affiliate Bot

Automação para montar e enviar ofertas de produtos afiliados para o WhatsApp. Cole o link do produto, preencha o preço e o bot monta a mensagem formatada com imagem — enviando direto no Telegram ou no WhatsApp.

---

## Como funciona

```
Link do produto (Shopee, Amazon, etc.)
        ↓
Scraper extrai: nome + imagem
        ↓
Você preenche: preço + cupom
        ↓
Escolhe o destino: Telegram ou WhatsApp
        ↓
Mensagem formatada pronta para encaminhar ao grupo
```

---

## Funcionalidades

- 🔍 **Extração automática** de nome e imagem do produto via Playwright
- 💬 **Bot Telegram** — fluxo conversacional completo pelo celular
- 🌐 **Painel Web** — interface visual em `localhost:3000`
- 📲 **Envio via WhatsApp** — API oficial Meta (zero risco de ban)
- 💰 **Preço original + promocional** — exibe preço riscado automaticamente
- 🎟️ **Cupom opcional** — linha some da mensagem se não houver cupom
- 📋 **Histórico de envios** — últimos 50 envios salvos localmente

---

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Runtime | Node.js + TypeScript |
| Scraper | Playwright (Chromium headless) |
| Bot | Telegraf (Telegram Bot API) |
| Mensagens | Meta WhatsApp Cloud API v25.0 |
| Servidor | Express |

---

## Pré-requisitos

- Node.js 18+
- Conta no [Meta for Developers](https://developers.facebook.com)
- Bot criado no [@BotFather](https://t.me/BotFather)

---

## Instalação

```bash
git clone https://github.com/seu-usuario/api-whatsapp.git
cd api-whatsapp
npm install
npx playwright install chromium
```

---

## Configuração

Copie o arquivo de exemplo e preencha as variáveis:

```bash
cp .env.example .env
```

```env
# Meta WhatsApp Cloud API
ACCESS_TOKEN=EAAxxxxx
PHONE_NUMBER_ID=1234567890
MY_PHONE_NUMBER=5511999999999   # seu número pessoal (sem +)
TEMPLATE_NAME=affiliate_offer   # ou hello_world para testes

# Telegram
TELEGRAM_BOT_TOKEN=1234567890:AABBccDD...

# App
WHATSAPP_GROUP_URL=https://bit.ly/seugrupo
PORT=3000
```

### Template Meta (WhatsApp)

Crie o template `affiliate_offer` em **WhatsApp Manager → Modelos de mensagem**:

- **Categoria:** Marketing
- **Idioma:** Português (BR)
- **Cabeçalho:** Imagem
- **Corpo:**
```
🛍️ Oferta especial!

*{{1}}* por {{2}}
{{3}}
Compre aqui: {{4}}

💰 Grupo de ofertas: {{5}}

Aproveite enquanto durar! ⏰
```

> Variáveis: `{{1}}` nome · `{{2}}` preço · `{{3}}` cupom (linha some se vazio) · `{{4}}` link · `{{5}}` grupo

---

## Uso

### Iniciar o servidor

```bash
npm run dev
```

Terminal mostra:
```
✅ Servidor rodando em http://localhost:3000
[telegram] ✅ Bot iniciado — @casaemae_ofertas_bot
```

### Via Telegram (recomendado)

1. Abra o bot no Telegram
2. Mande qualquer link de produto
3. Siga o fluxo conversacional:

```
Você:  https://s.shopee.com.br/xxx
Bot:   📦 Nome do Produto · 🖼️ Imagem encontrada
Bot:   💰 Digite o preço:
Você:  120
Bot:   🏷️ Tem preço original? Digite ou /skip
Você:  180
Bot:   🎟️ Tem cupom? Digite ou /skip
Você:  MAMAE10
Bot:   📍 Onde quer enviar?
       [📱 Telegram]  [💬 WhatsApp]  [🔄 Ambos]
```

### Via Painel Web

Acesse `http://localhost:3000`, cole o link, preencha os campos e clique **Enviar para WhatsApp**.

---

## Mensagem gerada

**Com preço original e cupom:**
```
🛍️ Oferta especial!

Cadeirinha de Alimentação Burigotto de R$180,00 por R$120,00
🎟️ Cupom: MAMAE10

Compre aqui: https://...

💰 Grupo de ofertas: https://...

Aproveite enquanto durar! ⏰
```

---

## Deploy (produção)

O projeto inclui `Dockerfile` pronto para Railway, Render ou qualquer plataforma Docker:

```bash
# Railway (recomendado)
# 1. Push para GitHub
# 2. Conectar repositório no railway.app
# 3. Configurar variáveis de ambiente no painel
# Custo: ~$7-8/mês (Railway + Meta API)
```

---

## Roadmap

- [ ] Integração com **Shopee Affiliate API** (acesso solicitado) — substituirá o scraper para produtos Shopee, eliminando dependência do Playwright
- [ ] Agendamento automático de ofertas (cron)
- [ ] Suporte a múltiplos grupos

---

## Notas importantes

- O token Meta expira em 24h no modo de teste. Para produção, gere um **System User Token** permanente no Business Manager.
- O arquivo `.env` não é commitado no Git. Guarde suas credenciais em local seguro.
- Preços digitados sem `R$` são formatados automaticamente (`120` → `R$120,00`).
