# Product Relevance Filtering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a topic-keyword allowlist to PelandoScraper so only deals relevant to the housewife niche reach the pipeline.

**Architecture:** Insert a single `TOPIC_KEYWORDS` allowlist constant in `PelandoScraper.ts`. Non-coupon deals are checked against this list immediately after the temperature/status gate (before any downstream HTTP calls). Coupon deals are exempt because their titles are generic. The existing `filterDeals` / tenant `excludeKeywords` infrastructure is unchanged.

**Tech Stack:** TypeScript, Vitest (existing test runner)

## Global Constraints

- Target file: `src/adapters/scrapers/PelandoScraper.ts`
- Test file: `src/adapters/scrapers/PelandoScraper.test.ts` (already exists — check with `ls`)
- No new dependencies
- Coupon deals (those going through the `isCouponPrice || isCouponDeal` branch) are **not** filtered by `TOPIC_KEYWORDS`
- Filter is case-insensitive substring match on `item.title`
- Run tests with: `npm test`

---

### Task 1: Add TOPIC_KEYWORDS allowlist and apply it in fetchDeals

**Files:**
- Modify: `src/adapters/scrapers/PelandoScraper.ts` — add constant + filter guard
- Modify: `tests/adapters/toDeal.test.ts` — add unit tests for the filter logic (already imports from PelandoScraper)

**Interfaces:**
- Produces: `TOPIC_KEYWORDS` (exported `string[]`) — used only internally but exported for testability
- Produces: `isRelevantForNiche(title: string): boolean` — pure function extracted from the filter guard, exported for direct unit testing

---

- [ ] **Step 1: Write the failing tests**

Open `tests/adapters/toDeal.test.ts` and append the following test block at the end of the file. The import line for `isRelevantForNiche` goes at the top of the file alongside the existing `toDealPelando` import:

```typescript
// Add to existing import on line 2:
import { toDealPelando, isRelevantForNiche } from '../../src/adapters/scrapers/PelandoScraper.js'
```

Then add at the bottom of the file:

```typescript

describe('isRelevantForNiche', () => {
  it('accepts a deal with a matching keyword', () => {
    expect(isRelevantForNiche('Kit 4 Panelas Antiaderentes')).toBe(true)
  })

  it('accepts deal with accented variant (bebê)', () => {
    expect(isRelevantForNiche('Fralda Bebê Pampers Tamanho P 100un')).toBe(true)
  })

  it('accepts deal with unaccented variant (bebe)', () => {
    expect(isRelevantForNiche('Carrinho de bebe travel system')).toBe(true)
  })

  it('rejects ar condicionado', () => {
    expect(isRelevantForNiche('Ar Condicionado Split 12000 BTU Inverter')).toBe(false)
  })

  it('rejects régua de tomada', () => {
    expect(isRelevantForNiche('Régua de Tomada 6 Saídas com USB')).toBe(false)
  })

  it('rejects scanner automotivo', () => {
    expect(isRelevantForNiche('Scanner Automotivo OBD2 Bluetooth')).toBe(false)
  })

  it('rejects HD externo', () => {
    expect(isRelevantForNiche('HD Externo Seagate 1TB USB 3.0')).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(isRelevantForNiche('SHAMPOO SEDA 400ml')).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --reporter=verbose 2>&1 | grep -E 'isRelevantForNiche|FAIL|PASS'
```

Expected: tests fail with `isRelevantForNiche is not a function` or similar import error.

- [ ] **Step 3: Add TOPIC_KEYWORDS constant and isRelevantForNiche to PelandoScraper.ts**

Open `src/adapters/scrapers/PelandoScraper.ts`. Find the `CATEGORIES` constant (around line 519) and the `MIN_TEMPERATURE` line right after it. Insert the following immediately after `ALLOWED_STORES`:

```typescript
export const TOPIC_KEYWORDS: string[] = [
  // Bebê / maternidade
  'fralda', 'bebê', 'bebe', 'infantil', 'maternidade',
  'berço', 'berco', 'carrinho', 'mamadeira', 'chupeta', 'enxoval',
  'lenço umedecido', 'lenco umedecido', 'pomada assadura',
  // Cozinha
  'panela', 'frigideira', 'airfryer', 'air fryer', 'cafeteira',
  'batedeira', 'chaleira', 'liquidificador', 'escorredor',
  'faca', 'tábua', 'tabua', 'tigela', 'pote',
  // Limpeza
  'sabão', 'sabao', 'detergente', 'desinfetante', 'amaciante',
  'esponja', 'mop', 'limpador', 'multiuso', 'vassoura', 'rodo',
  // Beleza / higiene
  'shampoo', 'condicionador', 'creme', 'hidratante', 'sabonete',
  'maquiagem', 'perfume', 'esmalte', 'absorvente', 'protetor solar',
  'desodorante',
  // Casa / organização
  'tapete', 'cortina', 'toalha', 'cesto', 'organizador', 'almofada',
  'jogo de cama', 'edredom', 'prateleira', 'cabide', 'quadro decorativo',
  // Pet
  'ração', 'racao', 'coleira', 'arranhador',
  // Brinquedos
  'brinquedo', 'pelúcia', 'pelucia', 'boneca', 'quebra-cabeça',
]

export function isRelevantForNiche(title: string): boolean {
  const lower = title.toLowerCase()
  return TOPIC_KEYWORDS.some(kw => lower.includes(kw))
}
```

- [ ] **Step 4: Apply the filter inside fetchDeals()**

Inside `fetchDeals()`, find the loop body where regular (non-coupon) deals are processed. The coupon branch ends with `continue` — the regular deal processing starts after `seen.add(dealPageUrl)` and the store filter block.

Add the niche filter immediately **after** `seen.add(dealPageUrl)` and **before** the store filter (`if (ALLOWED_STORES.length > 0)`):

```typescript
seen.add(dealPageUrl)

// Niche relevance gate — keeps only products for the housewife niche
if (!isRelevantForNiche(item.title)) {
  console.log(`[pelando:filter] fora do nicho, ignorado: ${item.title.slice(0, 60)}`)
  continue
}

// Regular deal: apply store filter
if (ALLOWED_STORES.length > 0) {
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm test -- --reporter=verbose 2>&1 | grep -E 'isRelevantForNiche|FAIL|PASS'
```

Expected: all `isRelevantForNiche` tests pass.

- [ ] **Step 6: Run full test suite to check for regressions**

```bash
npm test 2>&1 | tail -20
```

Expected: all tests pass (baseline was 107 tests).

- [ ] **Step 7: Commit**

```bash
git add src/adapters/scrapers/PelandoScraper.ts tests/adapters/toDeal.test.ts
git commit -m "feat: add niche relevance filter to PelandoScraper

Only deals matching TOPIC_KEYWORDS (housewife niche) pass through.
Coupon deals are exempt. Blocks ar condicionado, régua de tomada,
scanner automotivo, and similar off-niche products."
```
