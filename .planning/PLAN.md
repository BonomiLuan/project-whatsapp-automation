# WhatsApp Affiliate Bot — Web Dashboard + Meta API Oficial

**Objetivo:** Sistema web onde você cola o link do produto, o sistema extrai as informações automaticamente, monta a mensagem formatada com imagem e envia para o seu WhatsApp via API oficial Meta. Você encaminha para o grupo manualmente.

**Risco de ban:** Zero (API oficial Meta).
**Custo estimado:** ~R$9,50/mês (30 conversas × $0,0625 USD).

---

## Fluxo Completo

```
Você acessa o site (localhost)
        ↓
Cola o link da Shopee / outro afiliado
        ↓
Clica em "Extrair Produto"
        ↓
Sistema scrapa: nome, preço, imagem
        ↓
Você revisa + adiciona cupom (se houver)
        ↓
Clica em "Enviar para WhatsApp"
        ↓
Meta API envia: imagem + mensagem formatada
        ↓
Mensagem chega no seu WhatsApp
        ↓
Você encaminha para o grupo
```

---

## Arquitetura

```
api-whatsapp/
├── src/
│   ├── server/         # Express — rotas HTTP
│   ├── scraper/        # Playwright — extrai dados do produto
│   ├── api/            # Cliente Meta Cloud API
│   └── content/        # Formata mensagem + templates
├── public/
│   └── index.html      # UI web (formulário + preview)
├── data/
│   └── history.json    # Histórico de mensagens enviadas
├── .env
├── package.json
└── tsconfig.json
```

---

## Stack Tecnológica

| Componente | Tecnologia | Motivo |
|------------|-----------|--------|
| Backend | Node.js + TypeScript + Express | Simples, rápido, mesmo ecossistema |
| Scraper | Playwright (Chromium headless) | Funciona com Shopee (JavaScript dinâmico) |
| Envio WA | Meta WhatsApp Cloud API (REST) | Oficial, zero risco de ban |
| Frontend | HTML + CSS + JS puro | Sem framework — rápido de construir |

---

## Fases de Implementação

---

### Fase 0: Setup do Ambiente e Conta Meta

**Objetivo:** Projeto configurado, dependências instaladas, credenciais Meta funcionando.

**Tarefas — Projeto:**
- [ ] `npm init -y` + instalar TypeScript + `tsx` para dev
- [ ] Instalar dependências: `express`, `playwright`, `dotenv`, `axios`
- [ ] Instalar dev deps: `typescript`, `@types/express`, `@types/node`
- [ ] Criar `tsconfig.json` (`target: ESNext`, `moduleResolution: NodeNext`)
- [ ] Criar `.gitignore` (incluir `node_modules/`, `.env`, `data/auth/`)
- [ ] Rodar `npx playwright install chromium`

**Tarefas — Conta Meta:**
- [ ] Acessar `developers.facebook.com` → criar App tipo "Business"
- [ ] Adicionar produto "WhatsApp" ao app
- [ ] Anotar `PHONE_NUMBER_ID` e `ACCESS_TOKEN`
- [ ] Adicionar seu número pessoal como número de teste (recipient)
- [ ] Criar template de mensagem no Meta Business Manager:
  - Nome: `affiliate_offer`
  - Header: IMAGE (dinâmico)
  - Body: `*{{1}}* por {{2}}\n🎟️ Cupom: {{3}}\n\nCompre: {{4}}\n\n💰 Grupo de ofertas:\n{{5}}`
  - Categoria: Marketing
- [ ] Aguardar aprovação do template (geralmente horas)
- [ ] Testar envio via curl com template aprovado

**Verificação:**
- [ ] `npx tsc --noEmit` sem erros
- [ ] Curl de teste retorna `"id": "..."` e mensagem chega no WhatsApp

**Anti-patterns:**
- NÃO commitar `ACCESS_TOKEN` no git — usar `.env` + `.gitignore`
- NÃO tentar enviar mensagem livre (sem template) — a API rejeita

---

### Fase 1: Web Scraper de Produtos

**Objetivo:** Dado um URL de produto (Shopee, Amazon, etc.), extrair nome, preço e URL da primeira imagem.

**Tarefas:**
- [ ] Criar `src/scraper/productScraper.ts`
- [ ] Função `scrapeProduct(url: string): Promise<ProductData>`
- [ ] Usar Playwright para abrir página com Chromium headless
- [ ] Estratégia de extração por ordem de prioridade:
  1. Meta tags Open Graph: `og:title`, `og:price:amount`, `og:image`
  2. JSON-LD schema: `Product > name`, `offers > price`, `image`
  3. Seletores específicos Shopee como fallback
- [ ] Retornar: `{ name, price, imageUrl, originalUrl }`
- [ ] Tratar timeout e páginas que falham

**Interface de retorno:**
```typescript
interface ProductData {
  name: string
  price: string        // ex: "R$299,90"
  imageUrl: string     // URL pública da imagem
  originalUrl: string
}
```

**Verificação:**
- [ ] Script `test-scraper.ts` com URL da Shopee imprime os 4 campos
- [ ] Imagem URL abre no browser (confirmar que é pública)
- [ ] Funciona com pelo menos: Shopee, Amazon BR, Americanas

**Anti-patterns:**
- NÃO assumir seletores CSS fixos — Shopee muda o HTML frequentemente
- Priorizar Open Graph/JSON-LD (mais estável que seletores)

---

### Fase 2: Cliente da Meta Cloud API

**Objetivo:** Módulo TypeScript para enviar template de mensagem com imagem dinâmica.

**Tarefas:**
- [ ] Criar `src/api/metaClient.ts`
- [ ] Função `sendTemplateMessage(to, templateVars, imageUrl)`
- [ ] POST para `https://graph.facebook.com/v21.0/{PHONE_NUMBER_ID}/messages`
- [ ] Body do request (template com imagem dinâmica):
```json
{
  "messaging_product": "whatsapp",
  "to": "{{MY_PHONE_NUMBER}}",
  "type": "template",
  "template": {
    "name": "affiliate_offer",
    "language": { "code": "pt_BR" },
    "components": [
      {
        "type": "header",
        "parameters": [{ "type": "image", "image": { "link": "{{imageUrl}}" } }]
      },
      {
        "type": "body",
        "parameters": [
          { "type": "text", "text": "{{name}}" },
          { "type": "text", "text": "{{price}}" },
          { "type": "text", "text": "{{coupon}}" },
          { "type": "text", "text": "{{affiliateUrl}}" },
          { "type": "text", "text": "{{groupUrl}}" }
        ]
      }
    ]
  }
}
```
- [ ] Tratar erros da API com mensagem clara

**Verificação:**
- [ ] `test-api.ts` envia mensagem de teste com imagem pública e recebe no WhatsApp
- [ ] Campos aparecem corretamente formatados na mensagem

---

### Fase 3: Formatador de Mensagem

**Objetivo:** Conectar dados do scraper com o formato do template Meta.

**Tarefas:**
- [ ] Criar `src/content/messageBuilder.ts`
- [ ] Função `buildTemplateVars(product, coupon, groupUrl): TemplateVars`
- [ ] Limitar `name` a 60 caracteres (limite Meta)
- [ ] Formatar price: garantir formato `R$xxx,xx`
- [ ] Validar que `imageUrl` é HTTPS (requisito Meta)

**Verificação:**
- [ ] `buildTemplateVars` com dados mock retorna objeto correto
- [ ] Nomes longos são truncados com `...`

---

### Fase 4: Servidor Web (API + Frontend)

**Objetivo:** Interface web para usar o sistema sem precisar de terminal.

**Tarefas — Backend:**
- [ ] Criar `src/server/index.ts` — servidor Express na porta 3000
- [ ] Rota `POST /api/scrape` — recebe `{ url }`, retorna `ProductData`
- [ ] Rota `POST /api/send` — recebe `{ productData, coupon, groupUrl }`, envia WhatsApp
- [ ] Rota `GET /api/history` — retorna últimas mensagens enviadas
- [ ] Salvar cada envio em `data/history.json`

**Tarefas — Frontend (`public/index.html`):**
- [ ] Campo: URL do produto (input text)
- [ ] Botão: "Extrair Produto" → chama `/api/scrape`
- [ ] Preview automático: imagem + nome + preço extraídos
- [ ] Campos editáveis: nome, preço (caso scraping seja impreciso)
- [ ] Campo: Cupom (opcional)
- [ ] Campo: Link do grupo (pré-preenchido do `.env`)
- [ ] Botão: "Enviar para WhatsApp"
- [ ] Feedback: "Enviado!" ou mensagem de erro
- [ ] Seção: histórico dos últimos 10 envios

**Verificação:**
- [ ] Abrir `localhost:3000` no browser
- [ ] Colar URL da Shopee → imagem e nome aparecem em <10 segundos
- [ ] Clicar "Enviar" → mensagem chega no WhatsApp em <30 segundos
- [ ] Histórico mostra o envio feito

---

### Fase 5: Deploy e Confiabilidade

**Objetivo:** Sistema rodando 24/7, acessível pelo browser quando precisar.

**Tarefas:**
- [ ] Instalar PM2: `npm i -g pm2`
- [ ] Criar `ecosystem.config.js`
- [ ] Build TypeScript: `npm run build`
- [ ] Iniciar: `pm2 start ecosystem.config.js`
- [ ] Startup automático: `pm2 startup` + `pm2 save`

**Verificação:**
- [ ] `pm2 status` mostra `online`
- [ ] Após reiniciar o Mac, servidor volta automaticamente
- [ ] `localhost:3000` acessível normalmente

---

## Arquivo `.env`

```env
# Meta API
ACCESS_TOKEN=EAAxxxxxxxxxxxx
PHONE_NUMBER_ID=1234567890
MY_PHONE_NUMBER=5511999999999

# App
WHATSAPP_GROUP_URL=https://bit.ly/seugrupo
TEMPLATE_NAME=affiliate_offer
PORT=3000
```

---

## Mockup da Interface Web

```
┌─────────────────────────────────────────┐
│  🛍️ WhatsApp Offer Sender               │
├─────────────────────────────────────────┤
│  URL do produto:                        │
│  [https://s.shopee.com.br/...     ] [↗] │
│                            [Extrair]    │
├──────────────┬──────────────────────────┤
│  [imagem]    │  Nome: Cadeirinha Bebê   │
│              │  Preço: R$299,90         │
│              │  Cupom: [MAMAE10    ]    │
│              │  Grupo: [pré-preenchido] │
├──────────────┴──────────────────────────┤
│              [Enviar para WhatsApp ✓]   │
├─────────────────────────────────────────┤
│  Histórico                              │
│  • Cadeirinha Bebê — hoje 14:32 ✓      │
│  • Mamadeira Philips — ontem 18:01 ✓   │
└─────────────────────────────────────────┘
```

---

## Riscos e Mitigações

| Risco | Mitigação |
|-------|-----------|
| Shopee bloqueia scraping | Playwright com delay humano + user-agent real |
| Imagem do produto não é pública | Baixar imagem e hospedar temporariamente via URL base64 ou upload Meta |
| Template reprovado pela Meta | Seguir exatamente as diretrizes; categoria Marketing é aceita para ofertas |
| Token Meta expira | Usar System User Token (permanente) no lugar do token temporário |

---

## Ordem de Execução

```
Fase 0 → Fase 1 → Fase 2 → Fase 3 → Fase 4 → Fase 5
Setup     Scraper  Meta API  Builder  Web UI   PM2
```
