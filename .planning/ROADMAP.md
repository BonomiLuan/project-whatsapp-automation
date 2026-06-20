# Roadmap: api-whatsapp

## Milestones

- ✅ **v1.0 Bot de Afiliados Operacional** - Phase 1 (shipped 2026-06-16)
- 🚧 **v2.0 Hexagonal Architecture** - Phases 2-4 (in progress)

## Phases

<details>
<summary>✅ v1.0 Bot de Afiliados Operacional (Phase 1) - SHIPPED 2026-06-16</summary>

### Phase 1: Link Curto WhatsApp

**Goal**: Infraestrutura base operacional com link shortener rastreável e bot de afiliados funcional
**Plans**: Complete

Plans:

- [x] 01-01: Link shortener com PostgreSQL e redirecionamento rastreável
- [x] 01-02: Scraping Pelando (Playwright + Cloudflare bypass) com suporte a cupons
- [x] 01-03: Scraping Mercado Livre com detecção de deals reais
- [x] 01-04: Distributed lock via PG advisory + deduplicação persistida
- [x] 01-05: Filtros (Prime-exclusive, app-only, imagens baixa qualidade) + cron de monitoramento

</details>

---

### 🚧 v2.0 Hexagonal Architecture (In Progress)

**Milestone Goal:** Migrar para arquitetura hexagonal (Ports & Adapters) como base para evolução SaaS multi-tenant, sem quebrar produção em nenhum passo.

## Phase Details

### Phase 2: Hexagonal Structure

**Goal**: O repositório tem a estrutura hexagonal completa com todos os arquivos nos lugares certos — sem nenhuma alteração de comportamento
**Depends on**: Phase 1
**Requirements**: STRUCT-01, STRUCT-02, STRUCT-03, STRUCT-04, STRUCT-05, STRUCT-06, STRUCT-07, STRUCT-08, STRUCT-09, STRUCT-10
**Success Criteria** (what must be TRUE):

  1. `src/core/domain/`, `src/core/ports/` e `src/core/usecases/` existem com tipos e interfaces corretos
  2. `tsc --noEmit` passa sem erros após cada commit de move
  3. Produção no Railway continua deployável e funcional após todos os moves
  4. Cada adapter (scrapers, publishers, affiliates, db, lock, scheduler) está na pasta `src/adapters/` correspondente
  5. Nenhum comportamento de negócio foi alterado — apenas paths de import e localização de arquivos mudaram

**Plans**: 6 plans

Plans:

- [x] 02-01-PLAN.md — Core skeleton: domain types + 10 port interfaces + NodeCronScheduler stub + directory scaffold
- [x] 02-02-PLAN.md — Leaf adapters: AmazonAffiliate, MLAffiliate, ShopeeAffiliate, HistoryRepository moves
- [x] 02-03-PLAN.md — Second-tier moves: format.ts, WhatsAppPublisher, ProductScraper
- [ ] 02-04-PLAN.md — Scraper moves: PelandoScraper, MercadoLivreScraper (with dynamic import fix)
- [x] 02-05-PLAN.md — links.ts split: PgLinkRepository + PgAdvisoryLock + pool.ts
- [ ] 02-06-PLAN.md — God-file moves: TelegramPublisher, web/server.ts, jobs extraction, composition root + package.json

**UI hint**: no

### Phase 3: Core Domain Extraction

**Goal**: God-files são reduzidos a wiring puro, com use cases isolados no core e uma rede de segurança de testes que garante zero regressão
**Depends on**: Phase 2
**Requirements**: EXTRACT-01, EXTRACT-02, EXTRACT-03, EXTRACT-04, EXTRACT-05, EXTRACT-06, EXTRACT-07, EXTRACT-08
**Success Criteria** (what must be TRUE):

  1. Testes de caracterização (snapshot/integration) existem para `bot.ts`, `index.ts` e `pelando.ts` antes de qualquer split
  2. Use cases `FilterDeals` e `MonitorDeals` vivem em `src/core/usecases/` com testes unitários passando
  3. Ports `DealRepository` e `DealPublisher` têm implementações adapter concretas e testadas
  4. God-files (`bot.ts`, `index.ts`, `pelando.ts`) não contêm lógica de negócio inline — apenas wiring de dependências

**Plans**: 5 plans

Plans:
**Wave 1**

- [x] 03-01-PLAN.md — Pure-logic safety net: filterDeals + CategoryRotation + formatMessage helper, each with characterization tests (D-01c)
- [x] 03-02-PLAN.md — Leaf adapters: PgAdvisoryLock implements Lock, InMemoryRotationStore, real PgDealRepository + PgTenantRepository SQL

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 03-03-PLAN.md — Core use cases: MonitorDeals + SuggestDeals with fake-port unit tests
- [ ] 03-04-PLAN.md — Adapter port adoption: TelegramPublisher implements DealPublisher, scrapers implement DealScraper (toDeal)

**Wave 3** *(blocked on Wave 2 completion)*

- [ ] 03-05-PLAN.md — Composition root wiring + reduce god-files to wiring (jobs DI, server.ts business logic removed)

**UI hint**: no

### Phase 4: Multi-Tenancy

**Goal**: O sistema suporta tenant único migrado com schema versionado, dedupe por-tenant, rotação persistida e API REST operacional
**Depends on**: Phase 3
**Requirements**: TENANT-01, TENANT-02, TENANT-03, TENANT-04, TENANT-05, TENANT-06, TENANT-07
**Success Criteria** (what must be TRUE):

  1. Migrations `node-pg-migrate` criam tabelas `tenants`, `channels`, `deal_history`, `rotation_state`, `deal_feedback` sem perda de dados do tenant existente
  2. `DealRepository.findRecentlySentIds(tenantId, withinDays)` filtra dedupe corretamente por tenant
  3. `RotationStore` persiste cursor de rotação por-tenant no banco e sobrevive a restarts
  4. API REST responde: `GET /api/tenants` (200), `GET /api/config` (200), `GET /api/deals` (200)
  5. `AffiliateLinkBuilder` composite integra Amazon, ML e Shopee via port no use case `SuggestDeals`

**Plans**: TBD
**UI hint**: no

---

## Progress

**Execution Order:** 1 → 2 → 3 → 4

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Link Curto WhatsApp | v1.0 | 5/5 | Complete | 2026-06-16 |
| 2. Hexagonal Structure | v2.0 | 4/6 | In Progress|  |
| 3. Core Domain Extraction | v2.0 | 2/5 | In Progress|  |
| 4. Multi-Tenancy | v2.0 | 0/TBD | Not started | - |

---
*Roadmap created: 2026-06-17 for milestone v2.0*
