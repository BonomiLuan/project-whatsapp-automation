# Phase 3: Core Domain Extraction - Context

**Gathered:** 2026-06-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Extrair a lógica de negócio dos 3 god-files (`TelegramPublisher.ts` 1129L, `server.ts` 658L, `PelandoScraper.ts` 665L) para use cases em `src/core/usecases/`, protegida por testes de caracterização escritos antes de qualquer split. Após a extração, os god-files contêm apenas wiring de dependências — nenhuma lógica de negócio inline. `tsc --noEmit` passa e Railway permanece deployável após cada commit.

</domain>

<decisions>
## Implementation Decisions

### D-01: Testes de caracterização (safety net antes de qualquer split)

- **D-01a: Estratégia — funções puras inline:** Dentro de cada god-file existem funções puras (filtragem, formatação, lógica de seleção). O safety net é: (1) identificar essas funções, (2) extraí-las para um helper puro sem IO, (3) testar com fixtures/golden master. O "characterization test" é sobre essas unidades puras — não sobre o god-file inteiro.
- **D-01b: Coverage mínimo:** 85% das linhas das funções puras extraídas. IO (chamadas Telegram, queries PG, requests Playwright) excluído do cálculo de coverage.
- **D-01c: Regra de segurança:** Testes de characterization devem existir e passar antes de splittar o god-file. Sem exceção. Ordem obrigatória: identificar função pura → extrair helper → testar → então extrair use case.

### D-02: Migração de tipos (UnifiedDeal → Deal)

- **D-02a:** Cada adapter tem uma função `toDeal(raw): Deal` interna (privada ao módulo). Os use cases sempre recebem `Deal[]` — nunca veem `UnifiedDeal`.
- **D-02b:** `UnifiedDeal` permanece encapsulado dentro dos adapters de scraping e publicação durante a Fase 3. Não é deletado — apenas não vaza para o core.
- **D-02c:** O core domain (`src/core/domain/Deal.ts`) é o único tipo `Deal` que use cases conhecem. Zero imports de adapter types no core.

### D-03: SuggestDeals entra na Fase 3

- **D-03a:** Extrair `SuggestDeals` use case + `CategoryRotation` (lógica pura de round-robin) para `src/core/usecases/`.
- **D-03b:** Implementar `RotationStore` como in-memory simples (`InMemoryRotationStore`) — mantém o comportamento atual de `roundRobinIndex` e `lastSentSource` (ambos em `server.ts:578-586`) mas dentro da estrutura hexagonal.
- **D-03c:** Fase 4 substitui `InMemoryRotationStore` por implementação PG-backed por-tenant. Fase 3 entrega o use case isolado; o mecanismo de persistência muda na Fase 4.

### D-04: Lock port — criar classe PgAdvisoryLock implements Lock

- **D-04a:** A função atual `withCronLock(lockId: number)` em `src/adapters/lock/PgAdvisoryLock.ts` não implementa o port `Lock` (que espera `withLock(key: string)`). Solução: criar classe `PgAdvisoryLock` que implementa `Lock`, converte `key: string` para `lockId: number` via hash simples (ex: `hashCode(key) % 2^31`).
- **D-04b:** A função standalone `withCronLock` pode coexistir temporariamente ou ser internalizada na classe — o planner decide.
- **D-04c:** Jobs (`src/jobs/*.ts`) usam injeção de dependência via `Lock` port a partir da Fase 3. O composition root (`src/index.ts`) instancia `PgAdvisoryLock` e passa como `Lock`.

### D-05: implements Port — adotar na Fase 3

- **D-05a:** `TelegramPublisher` recebe `implements DealPublisher` na Fase 3 (quando os tipos `Deal` core forem usados).
- **D-05b:** `PelandoScraper` e `MercadoLivreScraper` recebem `implements DealScraper` após adotar `toDeal()` interno.
- **D-05c:** `PgDealRepository` e `PgTenantRepository` já têm `implements` declarado — precisam da implementação real (removendo `throw new Error('Not implemented — Phase 3')`).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Architecture spec (fonte primária)
- `docs/superpowers/specs/2026-06-16-hexagonal-architecture-design.md` — Target structure, domain types, port method signatures, use case TypeScript examples (`MonitorDeals`, `FilterDeals`, `SuggestDeals`), composition root wiring, test examples com fakes. **Ler completo antes de criar qualquer use case.**

### Planning documents
- `.planning/ROADMAP.md` §Phase 3 — Goal, requirements EXTRACT-01 a EXTRACT-08, success criteria
- `.planning/REQUIREMENTS.md` §Fase 2 (EXTRACT-01 a EXTRACT-08) — Checklist completo
- `.planning/PROJECT.md` §Constraints — Deploy sem interrupção, tsc após cada commit, sem schema changes na Fase 3

### Prior phase context
- `.planning/phases/02-hexagonal-structure/02-CONTEXT.md` — Decisões da Fase 2 (D-01 a D-04) que definem o estado atual do código

### God-files a extrair (codebase)
- `src/adapters/publishers/TelegramPublisher.ts` (1129L) — god-file com lógica Telegram; `implements DealPublisher` pendente
- `src/web/server.ts` (658L) — god-file com Express + lógica `sendNextSuggestion`; `roundRobinIndex`/`lastSentSource` em :578-586
- `src/adapters/scrapers/PelandoScraper.ts` (665L) — god-file com scraping; `implements DealScraper` pendente

### Adapters com stubs a implementar
- `src/adapters/db/PgDealRepository.ts` — stub, throws "Not implemented — Phase 3"
- `src/adapters/db/PgTenantRepository.ts` — stub, throws "Not implemented — Phase 3"
- `src/adapters/lock/PgAdvisoryLock.ts` — função `withCronLock(number)` sem `implements Lock`

</canonical_refs>

<code_context>
## Existing Code Insights

### Test framework
- **Vitest** (v4.1.8) — `vitest run --reporter=verbose`. Testes existentes em `tests/links.test.ts` e `tests/routes.test.ts` (16 testes passando).

### Funções puras a identificar/extrair nos god-files
- **PelandoScraper.ts** — lógica de filtragem de deals (Prime-exclusive, app-only, imagens baixa qualidade); candidata a `FilterDeals`
- **TelegramPublisher.ts** — lógica de formatação de mensagens; candidata a pure helper de formatação
- **server.ts** — `sendNextSuggestion`, `CategoryRotation` logic: `roundRobinIndex`, `lastSentSource` (`:578-586`); candidata a `SuggestDeals`

### Adapters que já implementam ports
- `NodeCronScheduler implements Scheduler` — único adapter com `implements` formal e implementação real (Fase 2)
- `PgDealRepository implements DealRepository` — declarado mas stub
- `PgTenantRepository implements TenantRepository` — declarado mas stub

### Composition root
- `src/index.ts` — criado na Fase 2 como ponto de entrada. Deve receber wiring dos use cases na Fase 3.

### Integration Points
- `src/jobs/monitorPelando.ts`, `src/jobs/monitorML.ts` — chamam lógica que será extraída para `MonitorDeals`; devem receber `MonitorDeals` via DI
- `src/jobs/cronLock.ts` — usa `withCronLock()` diretamente; deve passar a usar `Lock` port via DI

</code_context>

<specifics>
## Specific Ideas

- A spec (`docs/superpowers/specs/2026-06-16-hexagonal-architecture-design.md`) tem exemplos TypeScript concretos de `MonitorDeals`, `FilterDeals`, e `SuggestDeals` com assinaturas exatas — o planner deve usá-los como base.
- A função `withCronLock` atual usa `pg_try_advisory_lock` com integer — a conversão `key → number` na nova classe deve usar um hash determinístico (ex: FNV-32 ou `hashCode % 2^31`) para que a mesma string sempre produza o mesmo lock ID.
- `InMemoryRotationStore` para Fase 3 deve manter exatamente o comportamento atual: round-robin por `ALL_CATEGORIES`, sem repetir o mesmo source consecutivo.

</specifics>

<deferred>
## Deferred Ideas

- **RotationStore PG-backed** — Fase 4, junto com multi-tenant. `InMemoryRotationStore` não sobrevive a restart; aceitável para Fase 3 pois é o comportamento atual.
- **RecordFeedback use case** — não está nos requirements EXTRACT-* da Fase 3; pode entrar na Fase 4 junto com `FeedbackRepository` adapter concreto.
- **ManageTenant use case** — Fase 4 (multi-tenancy).
- **`AffiliateLinker` composite** — spec lista como use case do core, mas EXTRACT-07 menciona apenas o port. Planner decide se o composite entra na Fase 3 ou 4.

None of the above were scope-creep suggestions from the user — all are natural phase-sequencing deferrals.

</deferred>

---

*Phase: 3-Core Domain Extraction*
*Context gathered: 2026-06-19*
