# Phase 1: Link Curto com Preview WhatsApp — Specification

**Created:** 2026-06-11
**Ambiguity score:** 0.16 (gate: ≤ 0.20)
**Requirements:** 7 locked

## Goal

Substituir o envio de foto separada no Telegram por um link curto (`ofertas.thaisbonomi.com.br/r/{code}`) que gera preview com imagem no WhatsApp via OG meta tags, eliminando o salvamento automático de fotos na galeria dos clientes.

## Background

O bot hoje envia `replyWithPhoto(imageUrl)` + caption de texto em todas as saídas (wizard manual, deals automáticos a cada 15 min, sendDealCard). A usuária encaminha do Telegram para o grupo WhatsApp — quando uma foto é encaminhada, o WhatsApp salva na galeria dos participantes automaticamente.

Preview de link (cartão OG gerado por `og:image` + `og:title`) **não salva na galeria**. A solução é:
1. Gerar um link curto com OG tags no momento de cada post
2. O bot envia no Telegram: foto (para a usuária revisar) + caption com texto + link curto
3. A usuária copia a legenda/texto e envia ao WhatsApp → WhatsApp lê OG tags → exibe preview → sem galeria

Código de envio relevante: `sendToTelegram` (line 75), `sendProductToChat` (line 769), `sendDealCard` (line 795), `sendDealToChats` em `bot.ts`.

Não há Meta API ativa (chip ainda não comprado) — o fluxo é 100% manual via Telegram como intermediário.

## Requirements

1. **Link storage module**: `src/server/links.ts` persiste links com contagem de cliques em JSON.
   - Current: Não existe — o único storage é `data/history.json` (padrão similar via `history.ts`)
   - Target: `data/links.json` armazena `{ code, title, imageUrl, affiliateUrl, source, clickCount, createdAt }`. Funções: `createLink(data) → LinkEntry`, `getLink(code) → LinkEntry | null`, `incrementClick(code) → void`
   - Acceptance: `createLink({title, imageUrl, affiliateUrl, source})` retorna entry com `code` de 5 chars; `getLink(code)` retorna a mesma entry; chamada dupla a `incrementClick` resulta em `clickCount === 2` no arquivo

2. **Gerador de código curto**: Códigos de 5 caracteres alfanuméricos sem colisão.
   - Current: Não existe
   - Target: Função interna `generateCode()` gera string de 5 chars `[a-zA-Z0-9]`; se colisão no arquivo, tenta até 10 vezes antes de lançar erro
   - Acceptance: 1000 chamadas consecutivas sem colisão em arquivo vazio; nenhum código gerado tem menos ou mais de 5 chars

3. **Endpoint de redirect com OG tags**: `GET /r/:code` retorna HTML com meta tags e redireciona.
   - Current: Não existe no `src/server/index.ts`
   - Target: Responde com HTML contendo `og:title` (nome do produto), `og:image` (`/img/:code`), `og:description` (preço + source), `og:url` (URL canônica), e `<meta http-equiv="refresh" content="0;url={affiliateUrl}">`. Incrementa `clickCount` antes de responder. Retorna 404 JSON para code inexistente.
   - Acceptance: `GET /r/xK3mP` com code válido retorna status 200, Content-Type `text/html`, body contém `og:image`, `og:title`, e `meta refresh` com a affiliateUrl correta; `GET /r/XXXXX` (inexistente) retorna 404

4. **Proxy de imagem**: `GET /img/:code` serve a imagem do produto do nosso domínio.
   - Current: Existe `/api/image-proxy?url=...` (line 333) mas vinculado a URL arbitrária — não ao code
   - Target: `GET /img/:code` lê o `imageUrl` do link associado ao `code`, faz fetch da imagem original, retorna com `Content-Type` correto e `Cache-Control: public, max-age=86400`. Retorna 404 se code não existe. Retorna 502 se fetch da imagem falhar.
   - Acceptance: `GET /img/xK3mP` retorna imagem (status 200, Content-Type `image/*`); WhatsApp preview bot consegue carregar a imagem sem erro de CORS ou bloqueio de CDN

5. **Integração no wizard (post manual)**: O wizard gera link curto ao confirmar post.
   - Current: `sendToTelegram` envia só `replyWithPhoto(imageUrl)` + caption com `affiliateUrl` longo
   - Target: Ao confirmar post no wizard (step final), cria link curto via `createLink`; `sendToTelegram` envia foto + caption contendo texto formatado com o link curto no lugar da affiliateUrl original. O `affiliateUrl` longo NÃO aparece na caption.
   - Acceptance: Após confirmar um post no wizard do Telegram, a caption da foto recebida contém `ofertas.thaisbonomi.com.br/r/` e NÃO contém a URL longa de afiliado original

6. **Integração em deals automáticos**: Posts automáticos (deals a cada 15 min) usam link curto.
   - Current: `sendDealToChats` e `sendDealCard` enviam `telegramApi.sendPhoto(id, deal.imageUrl, {caption: text})` com `dealUrl` longo
   - Target: Antes de enviar cada deal, cria link curto; substitui o link longo na caption pelo link curto. O botão inline "🛒 Abrir oferta" pode manter o link direto (não é mostrado no WhatsApp).
   - Acceptance: Mensagem enviada para um chat de teste via `sendDealToChats` contém `ofertas.thaisbonomi.com.br/r/` na caption; o link é acessível e redireciona para a URL de afiliado correta

7. **Endpoint de analytics**: `GET /api/links` retorna links com contagem de cliques.
   - Current: Não existe
   - Target: `GET /api/links` (protegido pelo middleware de autenticação da API) retorna array de `LinkEntry[]` ordenado por `createdAt` decrescente, máximo 100 entradas
   - Acceptance: Após criar 3 links via posts, `GET /api/links` com auth correta retorna array com 3 entradas; sem auth retorna 401

## Boundaries

**In scope:**
- `src/server/links.ts` — módulo de storage de links (JSON, igual ao `history.ts`)
- `GET /r/:code` — redirect com OG tags
- `GET /img/:code` — proxy de imagem vinculado ao code
- `GET /api/links` — analytics protegido
- Integração no wizard manual do Telegram
- Integração nos deals automáticos (`sendDealToChats`, `sendDealCard`)
- `data/links.json` — arquivo de dados

**Out of scope:**
- Expiração de links — volume pequeno, destino já lida com produto fora de stock
- Edição de link existente (trocar affiliateUrl depois de criado) — pode ser adicionado manualmente se necessário
- Subdomínio mais curto (ex: `l.thaisbonomi.com.br`) — configuração de DNS/Railway, zero código, feito depois
- Meta API / envio direto para WhatsApp — chip ainda não comprado
- Dashboard web de analytics — `GET /api/links` é suficiente para consulta manual
- QR Code para o link curto — fora do escopo desta fase

## Constraints

- Storage em JSON (não SQLite/Postgres) — consistente com `history.ts` existente; volume esperado < 500 links/ano
- URL base do link: `ofertas.thaisbonomi.com.br` — domínio já configurado no Railway; não requer nova infraestrutura
- O proxy de imagem deve ter timeout de 8s e retornar 502 em falha — evita travamento do bot se CDN estiver lento
- O `og:image` da resposta HTML em `/r/:code` deve apontar para `/img/:code` (não para a CDN original) — garante que o WhatsApp consiga carregar independente do CDN

## Acceptance Criteria

- [ ] `GET /r/{code_válido}` retorna 200 HTML com `og:image`, `og:title`, `og:description`, e `meta refresh` para affiliateUrl
- [ ] `GET /r/{code_inválido}` retorna 404
- [ ] `GET /img/{code_válido}` retorna 200 com `Content-Type: image/*` e a imagem do produto
- [ ] `GET /api/links` sem autenticação retorna 401
- [ ] `GET /api/links` com autenticação retorna array com links e `clickCount`
- [ ] Caption de post manual no Telegram contém `ofertas.thaisbonomi.com.br/r/` e NÃO contém a URL longa de afiliado
- [ ] Caption de deal automático no Telegram contém `ofertas.thaisbonomi.com.br/r/`
- [ ] Após clicar no link curto, `clickCount` do entry correspondente incrementa em 1 no arquivo JSON
- [ ] Clicar no link curto redireciona para a affiliateUrl original (Shopee / Amazon / ML)

## Ambiguity Report

| Dimension          | Score | Min  | Status | Notes                                          |
|--------------------|-------|------|--------|------------------------------------------------|
| Goal Clarity       | 0.90  | 0.75 | ✓      | Fluxo Telegram→WA manual claramente definido   |
| Boundary Clarity   | 0.85  | 0.70 | ✓      | Meta API e expiração explicitamente out        |
| Constraint Clarity | 0.80  | 0.65 | ✓      | JSON storage, proxy obrigatório, timeout 8s    |
| Acceptance Criteria| 0.75  | 0.70 | ✓      | 9 critérios pass/fail; verificação manual WA   |
| **Ambiguity**      | 0.16  | ≤0.20| ✓      |                                                |

## Interview Log

| Round | Perspectiva     | Pergunta                                         | Decisão locked                                          |
|-------|-----------------|--------------------------------------------------|--------------------------------------------------------|
| 1     | Researcher      | Fluxo de envio: só manual ou também Meta API?    | Só manual (Telegram → encaminhar WA); Meta API out     |
| 1     | Simplifier      | Posts automáticos usam link curto?               | Sim — ambos manual e automático                        |
| 2     | Boundary Keeper | Formato no Telegram após mudança?                | Foto + caption com link curto (uma mensagem)           |
| 2     | Boundary Keeper | Fallback se imagem não carregar no WA?           | Proxy de imagem no servidor (IN scope)                 |
| 2     | Clarification   | Como usuária copia sem a foto?                   | Copia só o texto da legenda no Telegram; WhatsApp gera preview |

---

*Phase: 01-link-curto-whatsapp*
*Spec created: 2026-06-11*
*Next step: /gsd:discuss-phase 1 — decisões de implementação (padrões de código, estrutura de rotas, etc.)*
