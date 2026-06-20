# Phase 3: Core Domain Extraction - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-19
**Phase:** 3-Core Domain Extraction
**Areas discussed:** Testes de caracterização, UnifiedDeal → Deal, SuggestDeals na Fase 3, Mismatch do Lock port

---

## Testes de caracterização

| Option | Description | Selected |
|--------|-------------|----------|
| Testar as funções puras inline | Extrair funções puras dos god-files para helper puro, testar com fixtures. Safety net sobre a lógica extraída, não sobre o god-file inteiro. | ✓ |
| Mocks pesados no god-file | Instanciar o god-file inteiro com deps mockados (Telegram, PG, Playwright). Alto custo de setup. | |
| Apenas testes do use case extraído | Pular characterization do god-file; safety net = tsc + testes do use case com port fakes. | |

**User's choice:** Testar as funções puras inline
**Coverage:** 85% das funções puras extraídas (IO excluído do cálculo)
**Notes:** O usuário especificou 85% explicitamente (resposta freeform). Confirmado que se aplica às pure functions extraídas, não ao arquivo inteiro.

---

## UnifiedDeal → Deal

| Option | Description | Selected |
|--------|-------------|----------|
| Função de conversão no adapter | `toDeal(raw): Deal` interno em cada adapter; use case recebe `Deal[]`. Padrão hexagonal correto. | ✓ |
| Renomear UnifiedDeal para Deal | Substituir em todos os arquivos. Mudança maior mas elimina tipo intermediário de vez. | |
| Use case aceita UnifiedDeal temporariamente | Core importa tipo de adapter — viola regra hexagonal. | |

**User's choice:** Função de conversão no adapter
**Notes:** `UnifiedDeal` fica encapsulado nos adapters; core nunca vê esse tipo.

---

## SuggestDeals na Fase 3?

| Option | Description | Selected |
|--------|-------------|----------|
| Fase 3 com RotationStore in-memory | Extrair SuggestDeals + CategoryRotation. InMemoryRotationStore mantém comportamento atual. Fase 4 troca por PG-backed. | ✓ |
| Fase 4 junto com multi-tenant | SuggestDeals aguarda RotationStore persistido. Menos refactor no futuro. | |
| Fase 3 só a parte pura | Extrair CategoryRotation, deixar use case SuggestDeals para Fase 4. | |

**User's choice:** Fase 3 com RotationStore in-memory
**Notes:** `roundRobinIndex` e `lastSentSource` (server.ts:578-586) se tornam `InMemoryRotationStore`. Fase 4 substitui por PG-backed por-tenant.

---

## Mismatch do Lock port

| Option | Description | Selected |
|--------|-------------|----------|
| Criar classe PgAdvisoryLock implements Lock | Converter string key para lockId numérico via hash. Jobs usam DI via `Lock` port desde Fase 3. | ✓ |
| Mudar o port Lock para aceitar number | Expor integer ID de PG no core — viola hexagonal. | |
| Defer para Fase 4 | Jobs continuam chamando `withCronLock(number)` diretamente. Sem DI via Lock port na Fase 3. | |

**User's choice:** Criar classe PgAdvisoryLock implements Lock
**Notes:** Hash string→number deve ser determinístico (ex: FNV-32 ou `hashCode % 2^31`).

---

## Claude's Discretion

- Escolha do algoritmo de hash para conversão `key → lockId` no `PgAdvisoryLock` (FNV-32, DJB2, etc.)
- Se a função standalone `withCronLock` é internalizada ou coexiste com a nova classe
- Decisão sobre `AffiliateLinker` composite (em ou fora da Fase 3)

## Deferred Ideas

- RotationStore PG-backed → Fase 4
- RecordFeedback use case → Fase 4
- ManageTenant use case → Fase 4
- AffiliateLinker composite → planner decide se é Fase 3 ou 4
