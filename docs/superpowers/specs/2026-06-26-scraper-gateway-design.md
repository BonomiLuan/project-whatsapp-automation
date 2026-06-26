# Design: Remoção do Playwright e Gateway Manual de Produtos

**Data:** 2026-06-26
**Status:** Aprovado

## Contexto

O workspace no Railway foi bloqueado provavelmente por uso de Playwright (Chromium headless) no servidor principal. A solução é eliminar o Playwright e scrapers automáticos, substituindo o fluxo de scraping por um formulário manual com auto-preenchimento leve via axios.

## Objetivo

- Remover toda dependência de Playwright e scrapers automáticos do servidor principal
- Manter o fluxo de envio de ofertas via WhatsApp/Telegram intacto
- Permitir que o usuário forneça dados do produto manualmente, com auto-preenchimento opcional
- Suportar upload de imagem como alternativa à URL de imagem externa

## O que é removido

| Item | Arquivo(s) |
|---|---|
| `scrapeProduct` (Playwright) | `src/adapters/scrapers/ProductScraper.ts` |
| `monitorPelando` + `_monitorPelando` | `src/web/server.ts` |
| `monitorML` | `src/web/server.ts` |
| Scraper automático Pelando | `src/adapters/scrapers/PelandoScraper.ts` |
| Scraper automático ML | `src/adapters/scrapers/MercadoLivreScraper.ts` |
| Jobs de cron ML/Pelando | `src/jobs/monitorML.ts`, `src/jobs/monitorPelando.ts` |
| Dependências npm | `playwright`, `playwright-extra`, `puppeteer-extra-plugin-stealth` |

## O que é mantido

- `quickFetchProduct` (axios puro) — auto-preenchimento opcional
- Shopee affiliate API — não é scraping, sem risco
- `POST /api/send` — envio WhatsApp, inalterado
- `POST /api/send-telegram` — envio Telegram, inalterado
- Link shortener (`/r/:code`, `/img/:code`) — inalterado
- Dashboard completo

## Novo fluxo

```
1. Usuário cola URL do produto no dashboard
2. Frontend chama POST /api/scrape (axios)
   → retorna dados parciais: { partial: true, name?, price?, imageUrl? }
   → nunca retorna erro 500; dados vazios são OK
3. Campos do formulário são preenchidos automaticamente se disponíveis
4. Usuário revisa e edita: nome, preço, imagem
5. Para imagem: aceita URL externa OU upload de arquivo
   → Upload: POST /api/upload-image (multipart) → bytes salvos no DB → retorna URL /img/temp-xxx
6. Usuário clica "Enviar WhatsApp" ou "Enviar Telegram"
7. POST /api/send ou /api/send-telegram (inalterado)
```

## Endpoints modificados

### `POST /api/scrape` (modificado)
- **Antes:** chamava `scrapeProduct` (Playwright), retornava dados completos ou 500
- **Depois:** chama `quickFetchProduct` (axios), retorna o que encontrar
- **Response:** `{ partial: boolean, name: string, price: string, imageUrl: string, originalUrl: string }`
- **Nunca** retorna 500 — em caso de falha retorna `{ partial: true, name: '', price: '', imageUrl: '', originalUrl: url }`

### `POST /api/upload-image` (novo)
- **Input:** `multipart/form-data` com campo `image` (arquivo)
- **Validação:** apenas `image/jpeg`, `image/png`, `image/webp`; máximo 5MB
- **Armazenamento:** bytes salvos na tabela `links` com código temporário (prefixo `tmp-`)
- **Response:** `{ imageUrl: "https://servidor/img/tmp-abc123" }`
- **TTL:** entradas temporárias expiram em 24h se nenhum link for criado com elas

## Dashboard — mudanças de UX

O formulário de envio de produto ganha campos editáveis:

```
URL do produto:  [https://amazon.com.br/...    ]  [Buscar]

Nome:            [Tênis Nike Air Max...         ]  ← editável
Preço:           [R$299,90                      ]  ← editável
Imagem:          [https://...url...             ]  ← editável
                 [ou] [📎 Upload de imagem      ]
                 [ preview da imagem ]

Cupom:           [CUPOM10                       ]

[Enviar WhatsApp]  [Enviar Telegram]
```

- Botão "Enviar" habilitado quando `name` + `originalUrl` estiverem preenchidos (`imageUrl` é opcional)
- Se `quickFetchProduct` retornar dados, campos são preenchidos automaticamente
- Usuário pode sobrescrever qualquer campo

## Arquitetura de imagens (upload)

O upload segue a mesma infraestrutura existente de bytes de imagem:

```
Upload → bytes armazenados no DB (tabela links, coluna image_data)
       → código tmp-xxx gerado
       → /img/tmp-xxx serve os bytes (mesmo handler existente)
       → imageUrl = "https://servidor/img/tmp-xxx"
       → fluxo de criação de link usa essa URL normalmente
```

Não há nova tabela ou infraestrutura — reusa `getLinkImageData` e o handler `/img/:code`.

## Scrapers de deals (Shopee apenas)

- `refreshDeals()` mantida apenas para Shopee
- Removidas as chamadas a `monitorPelando()` e `monitorML()` do `index.ts` e `server.ts`
- `dealsCache` continua existindo mas só com deals Shopee

## Dependências a remover

```bash
npm uninstall playwright playwright-extra puppeteer-extra-plugin-stealth
```

## Critérios de sucesso

- `npm run build` passa sem erros após remoção
- `POST /api/scrape` retorna dados parciais sem erro quando axios falha
- Upload de imagem funciona e retorna URL acessível via `/img/:code`
- Envio de oferta WA/Telegram funciona com dados 100% manuais
- Nenhum processo Chromium/Playwright é iniciado durante operação normal
