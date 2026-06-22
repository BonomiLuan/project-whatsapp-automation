# ML API POC + Cost Reduction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduzir custo de Railway cortando a frequência do ML scraper de 30min para 2h, e validar se a ML API pública já existente em `MLAffiliate.ts` substitui o Playwright por completo.

**Architecture:** Dois entregáveis independentes: (1) mudança de cron em `monitorML.ts` — ganho imediato de 75% nas execuções Playwright; (2) script standalone `src/scraper/test-ml-api.ts` que reutiliza `fetchMLDealsByKeyword` (já existente em `MLAffiliate.ts`) para rodar as 5 buscas do nicho e imprimir um relatório de validação.

**Tech Stack:** Node.js, TypeScript, axios (já presente), `npx tsx` para execução do script

## Global Constraints

- TypeScript strict — sem `any` não justificado
- Sem alterações em código de produção fora de `monitorML.ts`
- O script de POC não tem side-effects: não publica, não grava no banco, não altera estado
- Roda com `npx tsx src/scraper/test-ml-api.ts` sem variáveis de ambiente obrigatórias
- `ML_PUBLISHER_ID` e `ML_MATT_WORD` opcionais — sem eles os permalinks saem sem tag de afiliado (já é o comportamento de `injectMLTag`)

---

### Task 1: Reduzir frequência do cron ML de 30min para 2h

**Files:**
- Modify: `src/jobs/monitorML.ts:16`
- Modify: `tests/wiring/composition.test.ts:105`

**Interfaces:**
- Produces: `registerMLMonitor` registra cron com expressão `'0 8-22/2 * * *'`

- [ ] **Step 1: Atualizar o teste para a nova expressão**

Em `tests/wiring/composition.test.ts`, linha 105, mudar:
```typescript
expect(scheduler.scheduled[0].cron).toBe('*/30 * * * *')
```
para:
```typescript
expect(scheduler.scheduled[0].cron).toBe('0 8-22/2 * * *')
```

- [ ] **Step 2: Rodar o teste para confirmar que falha**

```bash
npm test -- --reporter=verbose 2>&1 | grep "ml-monitor"
```
Expected: `× registerMLMonitor schedules the ml-monitor job`

- [ ] **Step 3: Atualizar a expressão cron em `monitorML.ts`**

Em `src/jobs/monitorML.ts`, linha 16, mudar:
```typescript
'*/30 * * * *',
```
para:
```typescript
'0 8-22/2 * * *',
```

- [ ] **Step 4: Rodar todos os testes e confirmar que passam**

```bash
npm test -- --reporter=verbose 2>&1 | tail -6
```
Expected:
```
Test Files  13 passed (13)
Tests  115 passed | 14 todo (129)
```

- [ ] **Step 5: Commit**

```bash
git add src/jobs/monitorML.ts tests/wiring/composition.test.ts
git commit -m "fix: reduzir cron ML de 30min para 0 8-22/2 — corta 75% das execucoes Playwright"
```

---

### Task 2: Script de POC da ML API pública

**Files:**
- Create: `src/scraper/test-ml-api.ts`

**Interfaces:**
- Consumes: `fetchMLDealsByKeyword(keyword: string, limit?: number): Promise<MLDeal[]>` de `src/adapters/affiliates/MLAffiliate.ts`
- `MLDeal` shape: `{ id, title, price, originalPrice?, discountPercent, imageUrl, affiliateUrl, permalink, store }`
- Produces: relatório impresso no stdout, processo sai com código 0 (sucesso) ou 1 (bloqueado por IP)

- [ ] **Step 1: Criar o script**

Criar `src/scraper/test-ml-api.ts` com o conteúdo abaixo:

```typescript
import 'dotenv/config'
import { fetchMLDealsByKeyword } from '../adapters/affiliates/MLAffiliate.js'

// Mesmas buscas do MercadoLivreScraper atual
const SEARCHES = [
  'fralda descartavel bebe',
  'lenco umedecido bebe',
  'carrinho de bebe',
  'mamadeira bebe',
  'roupinha bebe conjunto',
]

const MIN_DISCOUNT = 15
const LIMIT_PER_SEARCH = 50

interface SearchResult {
  query: string
  total: number
  withDiscount: number
  durationMs: number
  blocked: boolean
  top3: Array<{ title: string; price: string; originalPrice: string; discount: number }>
}

async function runSearch(query: string): Promise<SearchResult> {
  const t0 = Date.now()
  const deals = await fetchMLDealsByKeyword(query, LIMIT_PER_SEARCH)
  const durationMs = Date.now() - t0

  // fetchMLDealsByKeyword já filtra ≥10% — aqui aplicamos o limiar do Playwright (≥15%)
  const filtered = deals.filter(d => d.discountPercent >= MIN_DISCOUNT)

  const blocked = deals.length === 0 && durationMs < 1000

  const top3 = filtered
    .sort((a, b) => b.discountPercent - a.discountPercent)
    .slice(0, 3)
    .map(d => ({
      title: d.title,
      price: d.price,
      originalPrice: d.originalPrice ?? '—',
      discount: d.discountPercent,
    }))

  return { query, total: deals.length, withDiscount: filtered.length, durationMs, blocked, top3 }
}

async function main() {
  console.log('[ml-api-poc] Iniciando validação da ML API pública...\n')

  const results: SearchResult[] = []
  for (const query of SEARCHES) {
    const result = await runSearch(query)
    results.push(result)

    if (result.blocked) {
      console.log(`[ml-api-poc] ✗ "${query}" — SEM RESPOSTA (possível bloqueio de IP)`)
    } else {
      console.log(`[ml-api-poc] "${query}"`)
      console.log(`  Total: ${result.total} | Com desconto ≥${MIN_DISCOUNT}%: ${result.withDiscount} | Tempo: ${(result.durationMs / 1000).toFixed(1)}s`)
      for (const d of result.top3) {
        console.log(`  • ${d.title.slice(0, 55)} — ${d.price} (era ${d.originalPrice}) — ${d.discount}% OFF`)
      }
    }
    console.log()

    // Pausa entre buscas para evitar rate limit
    if (query !== SEARCHES[SEARCHES.length - 1]) {
      await new Promise(r => setTimeout(r, 300))
    }
  }

  const totalWithDiscount = results.reduce((s, r) => s + r.withDiscount, 0)
  const totalTime = results.reduce((s, r) => s + r.durationMs, 0)
  const anyBlocked = results.some(r => r.blocked)
  const allBlocked = results.every(r => r.blocked)

  console.log('─'.repeat(60))
  console.log('[ml-api-poc] RESUMO')
  console.log(`  Buscas: ${SEARCHES.length} | Total c/ desconto ≥${MIN_DISCOUNT}%: ${totalWithDiscount} | Tempo total: ${(totalTime / 1000).toFixed(1)}s`)
  console.log()

  if (allBlocked) {
    console.log('  → Resultado: BLOQUEADO POR IP — a API não funcionará no Railway')
    console.log('  → Plano B: manter Playwright com frequência reduzida (0 8-22/2)')
    process.exit(1)
  }

  if (anyBlocked) {
    console.log('  → Resultado: PARCIALMENTE BLOQUEADO — algumas buscas falharam')
  } else if (totalWithDiscount >= 20) {
    console.log(`  → Resultado: APROVADO — ${totalWithDiscount} produtos com desconto encontrados`)
    console.log('  → Próximo passo: integrar ao MercadoLivreScraper substituindo Playwright')
  } else {
    console.log(`  → Resultado: INSUFICIENTE — apenas ${totalWithDiscount} produtos com desconto (mínimo: 20)`)
    console.log('  → Considere aumentar o limite por busca ou revisar o critério de desconto')
  }
}

main().catch(err => {
  console.error('[ml-api-poc] Erro fatal:', err)
  process.exit(1)
})
```

- [ ] **Step 2: Rodar o script e observar o relatório**

```bash
npx tsx src/scraper/test-ml-api.ts
```

Expected (se API acessível):
```
[ml-api-poc] "fralda descartavel bebe"
  Total: 48 | Com desconto ≥15%: 22 | Tempo: 0.4s
  • Fralda Pampers Premium Care [...] — R$49,90 (era R$79,90) — 38% OFF
  ...

[ml-api-poc] RESUMO
  Buscas: 5 | Total c/ desconto ≥15%: 87 | Tempo total: 1.8s
  → Resultado: APROVADO
```

Expected (se IP bloqueado):
```
[ml-api-poc] ✗ "fralda descartavel bebe" — SEM RESPOSTA (possível bloqueio de IP)
...
  → Resultado: BLOQUEADO POR IP
```

- [ ] **Step 3: Confirmar que os testes de produção ainda passam**

```bash
npm test -- --reporter=verbose 2>&1 | tail -6
```
Expected:
```
Test Files  13 passed (13)
Tests  115 passed | 14 todo (129)
```

- [ ] **Step 4: Commit**

```bash
git add src/scraper/test-ml-api.ts
git commit -m "feat: adicionar script POC de validacao da ML API publica"
```
