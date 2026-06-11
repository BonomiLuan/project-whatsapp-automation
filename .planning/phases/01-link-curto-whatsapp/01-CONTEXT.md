# Phase 1: Link Curto com Preview WhatsApp — Context

**Gathered:** 2026-06-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Implementar um link shortener (`ofertas.thaisbonomi.com.br/r/{code}`) que gera previews com OG tags para o WhatsApp, elimina o salvamento de fotos na galeria dos clientes, e substitui os links longos de afiliado em todos os posts do bot (manual e automático).

</domain>

<spec_lock>
## Requirements (locked via SPEC.md)

**7 requirements são locked.** Ver `01-SPEC.md` para requirements, boundaries e acceptance criteria completos.

Downstream agents MUST read `01-SPEC.md` antes de planejar ou implementar.

**In scope (from SPEC.md):**
- `src/server/links.ts` — módulo de storage de links
- `GET /r/:code` — redirect com OG tags
- `GET /img/:code` — proxy de imagem vinculado ao code
- `GET /api/links` — analytics protegido
- Integração no wizard manual do Telegram
- Integração nos deals automáticos (`sendDealToChats`, `sendDealCard`)
- `data/links.json` — arquivo de dados *(ATUALIZADO: Postgres — ver D-01)*

**Out of scope (from SPEC.md):**
- ~~Expiração de links~~ — **REVISADO: expiração 45 dias IN scope (ver D-05, D-06)**
- Edição de link existente
- Subdomínio mais curto — configuração de DNS/Railway posterior
- Meta API / envio direto para WhatsApp
- Dashboard web de analytics
- QR Code para o link curto

</spec_lock>

<decisions>
## Implementation Decisions

### Storage (D-01 a D-03)

- **D-01: Postgres no Railway, não JSON file** — Volume de 5.000 links/mês (60k/ano) invalida o JSON file que faz `writeFileSync` do array completo a cada operação. Postgres com índice em `code` tem O(1) lookups. Provisionar Postgres no Railway Dashboard → New Service → Database → PostgreSQL.
- **D-02: `pg` (node-postgres) direto, sem ORM** — 1 tabela com 5 operações simples. Prisma seria overhead desnecessário. Usar queries parametrizadas (`WHERE code = $1`).
- **D-03: `DATABASE_URL` via Railway environment** — No serviço Express: Settings → Reference Variable → `${{Postgres.DATABASE_URL}}`. Local: adicionar `DATABASE_URL=postgresql://...` no `.env`. Migração na inicialização do servidor (`CREATE TABLE IF NOT EXISTS`).

**Schema da tabela `links`:**
```sql
CREATE TABLE IF NOT EXISTS links (
  code        VARCHAR(5)    PRIMARY KEY,
  title       TEXT          NOT NULL,
  image_url   TEXT          NOT NULL,
  affiliate_url TEXT        NOT NULL,
  source      VARCHAR(20)   NOT NULL,  -- 'shopee' | 'amazon' | 'ml'
  click_count INTEGER       NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ   NOT NULL  -- created_at + 45 days
);
CREATE INDEX IF NOT EXISTS idx_links_code ON links(code);
```

### Segurança (D-04)

- **D-04: 4 mitigações obrigatórias**
  1. **SSRF allowlist no proxy de imagem** — `/img/:code` só faz `axios.get` para domínios: `*.shopee.com.br`, `*.szcdn.com`, `*.ssl-images-amazon.com`, `*.cloudfront.net`, `*.mlstatic.com`. Qualquer outro domínio retorna 403.
  2. **Validação da affiliateUrl na criação** — Ao criar link, validar que `affiliateUrl` inicia com domínio permitido (Shopee, Amazon, ML, meli.la, ml.bz).
  3. **Rate limiting no `/r/:code`** — Máx 60 requests/min por IP. Usar `express-rate-limit` (já pode estar no projeto ou adicionar).
  4. **SQL parametrizado** — Todas as queries usam `$1, $2...`. Nunca concatenação de string.

### Ciclo de vida dos links (D-05 a D-07)

- **D-05: Links expiram após 45 dias** — `expires_at = created_at + INTERVAL '45 days'`. Esta é uma **revisão ao SPEC** que tinha expiração como out of scope (volume era estimado < 500/ano; usuária confirmou 5.000/mês).
- **D-06: Link expirado → redirect para busca do produto com tag de afiliado** — Quando `NOW() > expires_at`:
  - Shopee: `https://shopee.com.br/search?keyword={title_encoded}&tag={affiliate_id}`
  - Amazon: `https://www.amazon.com.br/s?k={title_encoded}&tag={amazon_tag}`
  - ML: `https://www.mercadolivre.com.br/jm/search?as_word={title_encoded}&matt_tool={publisher_id}&matt_word={matt_word}`
  - O `source` salvo na tabela determina qual plataforma usar.
- **D-07: Nunca deletar registros do banco** — Dados de cliques têm valor analítico. Postgres aguenta 60k+/ano sem problema.

### Cache do proxy de imagem (D-08)

- **D-08: In-memory LRU Map (200 entradas) + Cache-Control: 24h**
  - Map `code → { buffer, contentType, cachedAt }` em memória, max 200 entradas (LRU: remove a mais antiga ao atingir limite)
  - `Cache-Control: public, max-age=86400` em todas as respostas de imagem
  - Timeout de 8s no `axios.get` da imagem original; retornar 502 em falha
  - Cache reset no restart do servidor (aceitável — Railway reinicia com deploys)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements locked
- `.planning/phases/01-link-curto-whatsapp/01-SPEC.md` — 7 requirements locked; boundaries e acceptance criteria. Ler antes de qualquer planning.

### Storage pattern existente
- `src/server/history.ts` — padrão atual de storage em JSON (será substituído por Postgres para links; manter JSON para history)
- `src/server/index.ts` — onde adicionar as novas rotas `/r/:code`, `/img/:code`, `/api/links`

### Bot integration points
- `src/telegram/bot.ts` — funções `sendToTelegram` (line 75), `sendProductToChat` (line 769), `sendDealCard` (line 795): 3 pontos onde gerar e incluir o link curto na caption
- `src/telegram/bot.ts:750` — `sendDealToChats`: deals automáticos, também precisa de link curto

### Affiliate tag patterns
- `src/api/mercadoLivreAffiliate.ts:100` — `injectMLTag`: referência para construção da URL de busca expirada para ML
- `src/api/shopeeAffiliate.ts` — affiliate tag Shopee para URL de busca expirada

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/server/history.ts` — padrão de módulo de storage; o `links.ts` segue estrutura similar mas com Postgres em vez de JSON
- Middleware de auth em `src/server/index.ts:52` — reutilizar para proteger `GET /api/links`
- `/api/image-proxy?url=...` (line 333 em index.ts) — proxy de imagem existente; o novo `/img/:code` é variante com allowlist e cache

### Established Patterns
- Todas as rotas da API vivem em `src/server/index.ts` — adicionar as 3 novas rotas lá
- `.env` para variáveis de ambiente — adicionar `DATABASE_URL`
- TypeScript com ESM (`import/export`) — manter padrão

### Integration Points
- **Wizard manual** (bot.ts): após `sendToTelegram`, gerar `createLink()` e incluir `r/${code}` na caption
- **Deals automáticos** (bot.ts): antes de `sendDealToChats` / `sendDealCard`, gerar link curto e usar na mensagem
- **Inicialização do servidor** (index.ts ou server startup): executar migration DDL (`CREATE TABLE IF NOT EXISTS`)

</code_context>

<specifics>
## Specific Ideas

- A usuária quer que links expirados redirecionem para **busca do produto na plataforma original com tag de afiliado** — não mostrar página de erro. O cliente sempre chega em algum lugar útil.
- Volume real: **5.000 links/mês** (não 500/ano como assumido no SPEC) — justifica Postgres e expiração.
- Bot usa fluxo **Telegram → encaminhar manual para WhatsApp** (Meta API ainda não configurada, chip pendente). Toda mudança é no output do Telegram.
- Copiar legenda do Telegram para WhatsApp: o cliente copia só o texto (sem a foto), WhatsApp lê OG tags e gera preview.

</specifics>

<deferred>
## Deferred Ideas

- **Subdomínio mais curto** (ex: `l.thaisbonomi.com.br`) — configuração de DNS/Railway, sem código novo, fase posterior
- **Meta API integration** — chip pendente de compra; quando configurado, os mesmos links curtos servem para envio direto
- **Dashboard web de analytics** — `GET /api/links` é suficiente por ora; dashboard visual é fase separada
- **Renovação de link expirado** — redirecionar para busca resolve o imediato; um futuro "renovar deal" com novo preço é feature de gestão separada
- **QR Code** — geração automática de QR para cada link curto; fase separada

</deferred>

---

*Phase: 01-link-curto-whatsapp*
*Context gathered: 2026-06-11*
