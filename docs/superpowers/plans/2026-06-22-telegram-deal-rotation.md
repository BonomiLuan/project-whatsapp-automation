# Telegram Deal Rotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Garantir variedade nos comandos Telegram de categoria (`/decoracao`, `/higiene`, etc.) rastreando produtos já exibidos e categorizando deals do Pelando por keyword.

**Architecture:** Um módulo singleton `ShownDealsTracker` mantém em memória quais deal IDs foram exibidos por categoria com TTL de 5 dias. `sendCategoryDeals` filtra vistos antes de amostrar e avisa o usuário quando o pool esgota. Deals do Pelando recebem categoria via inferência por keyword usando `CATEGORY_KEYWORDS` existente; Shopee expande o pool de 12 para 20 itens.

**Tech Stack:** TypeScript, Vitest, Telegraf (já existentes no projeto).

## Global Constraints

- Runner de testes: `npx vitest run <path> --reporter=verbose`
- Todos os imports usam extensão `.js` (ESM)
- Sem banco de dados — tudo em memória
- TTL padrão: 5 dias (`SEEN_TTL_DAYS = 5`)
- Não quebrar nenhum dos 115 testes existentes

---

## File Map

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `src/adapters/store/ShownDealsTracker.ts` | **Criar** | Rastreia deal IDs vistos por categoria com TTL |
| `tests/adapters/ShownDealsTracker.test.ts` | **Criar** | Testes unitários do tracker |
| `src/web/server.ts` | **Modificar** | `inferCategory` + categorização Pelando + pool Shopee 20 |
| `src/adapters/affiliates/ShopeeAffiliate.ts` | **Modificar** | Buscar 6 keywords por categoria (era 4) |
| `src/adapters/publishers/TelegramPublisher.ts` | **Modificar** | Integrar tracker em `sendCategoryDeals` + comando `/resetar` |

---

### Task 1: ShownDealsTracker — módulo + testes

**Files:**
- Create: `src/adapters/store/ShownDealsTracker.ts`
- Create: `tests/adapters/ShownDealsTracker.test.ts`

**Interfaces:**
- Produces:
  - `class ShownDealsTracker` com métodos `markShown`, `filterUnseen`, `resetCategory`
  - `export const shownDealsTracker: ShownDealsTracker` — singleton para uso no bot
  - `export const SEEN_TTL_DAYS = 5`

- [ ] **Step 1: Criar o arquivo de teste com todos os casos**

Criar `tests/adapters/ShownDealsTracker.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { ShownDealsTracker } from '../../src/adapters/store/ShownDealsTracker.js'

function makeDeals(ids: string[]) {
  return ids.map(id => ({ id, title: `Produto ${id}` }))
}

describe('ShownDealsTracker', () => {
  let tracker: ShownDealsTracker

  beforeEach(() => {
    tracker = new ShownDealsTracker()
  })

  describe('filterUnseen', () => {
    it('retorna todos os deals quando nenhum foi visto', () => {
      const deals = makeDeals(['a', 'b', 'c'])
      const result = tracker.filterUnseen('decoracao', deals, d => d.id)
      expect(result.map(d => d.id)).toEqual(['a', 'b', 'c'])
    })

    it('exclui deals já vistos', () => {
      const deals = makeDeals(['a', 'b', 'c'])
      tracker.markShown('decoracao', ['a', 'c'])
      const result = tracker.filterUnseen('decoracao', deals, d => d.id)
      expect(result.map(d => d.id)).toEqual(['b'])
    })

    it('não vaza vistos entre categorias diferentes', () => {
      const deals = makeDeals(['a', 'b'])
      tracker.markShown('higiene', ['a'])
      const result = tracker.filterUnseen('decoracao', deals, d => d.id)
      expect(result.map(d => d.id)).toEqual(['a', 'b'])
    })

    it('reexibe deals cujo TTL expirou', () => {
      const deals = makeDeals(['a', 'b'])
      tracker.markShown('decoracao', ['a'])
      // TTL de 0 dias → tudo expirado imediatamente
      const result = tracker.filterUnseen('decoracao', deals, d => d.id, 0)
      expect(result.map(d => d.id)).toEqual(['a', 'b'])
    })

    it('mantém deals dentro do TTL como vistos', () => {
      const deals = makeDeals(['a', 'b'])
      tracker.markShown('decoracao', ['a'])
      // TTL de 99 dias → ainda dentro da janela
      const result = tracker.filterUnseen('decoracao', deals, d => d.id, 99)
      expect(result.map(d => d.id)).toEqual(['b'])
    })
  })

  describe('markShown', () => {
    it('aceita lista vazia sem erro', () => {
      expect(() => tracker.markShown('decoracao', [])).not.toThrow()
    })

    it('marcações acumulam entre chamadas', () => {
      const deals = makeDeals(['a', 'b', 'c'])
      tracker.markShown('decoracao', ['a'])
      tracker.markShown('decoracao', ['b'])
      const result = tracker.filterUnseen('decoracao', deals, d => d.id)
      expect(result.map(d => d.id)).toEqual(['c'])
    })
  })

  describe('resetCategory', () => {
    it('limpa uma categoria específica e retorna contagem removida', () => {
      tracker.markShown('decoracao', ['a', 'b', 'c'])
      tracker.markShown('higiene', ['x'])
      const removed = tracker.resetCategory('decoracao')
      expect(removed).toBe(3)
      // decoracao limpa, higiene intacta
      const dealsHigiene = makeDeals(['x', 'y'])
      const result = tracker.filterUnseen('higiene', dealsHigiene, d => d.id)
      expect(result.map(d => d.id)).toEqual(['y'])
    })

    it('limpa todas as categorias quando chamado sem argumento', () => {
      tracker.markShown('decoracao', ['a', 'b'])
      tracker.markShown('higiene', ['x', 'y', 'z'])
      const removed = tracker.resetCategory()
      expect(removed).toBe(5)
      const deals = makeDeals(['a'])
      expect(tracker.filterUnseen('decoracao', deals, d => d.id)).toEqual(deals)
    })

    it('retorna 0 ao resetar categoria inexistente', () => {
      expect(tracker.resetCategory('categoria-que-nao-existe')).toBe(0)
    })
  })
})
```

- [ ] **Step 2: Rodar os testes para confirmar que falham**

```bash
npx vitest run tests/adapters/ShownDealsTracker.test.ts --reporter=verbose
```

Esperado: FAIL — `Cannot find module '../../src/adapters/store/ShownDealsTracker.js'`

- [ ] **Step 3: Implementar `ShownDealsTracker`**

Criar `src/adapters/store/ShownDealsTracker.ts`:

```typescript
export const SEEN_TTL_DAYS = 5

export class ShownDealsTracker {
  // category → dealId → timestamp (ms) quando foi exibido
  private store = new Map<string, Map<string, number>>()

  markShown(category: string, dealIds: string[]): void {
    if (!this.store.has(category)) this.store.set(category, new Map())
    const cat = this.store.get(category)!
    const now = Date.now()
    for (const id of dealIds) cat.set(id, now)
  }

  filterUnseen<T>(
    category: string,
    deals: T[],
    getId: (d: T) => string,
    ttlDays = SEEN_TTL_DAYS,
  ): T[] {
    const cat = this.store.get(category)
    if (!cat) return deals

    const cutoff = Date.now() - ttlDays * 24 * 60 * 60 * 1000
    // lazy eviction: remove entradas expiradas ao filtrar
    for (const [id, seenAt] of cat) {
      if (seenAt < cutoff) cat.delete(id)
    }

    return deals.filter(d => !cat.has(getId(d)))
  }

  resetCategory(category?: string): number {
    if (category !== undefined) {
      const cat = this.store.get(category)
      if (!cat) return 0
      const count = cat.size
      cat.clear()
      return count
    }
    let total = 0
    for (const cat of this.store.values()) total += cat.size
    this.store.clear()
    return total
  }
}

export const shownDealsTracker = new ShownDealsTracker()
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

```bash
npx vitest run tests/adapters/ShownDealsTracker.test.ts --reporter=verbose
```

Esperado: todos os 11 testes PASS.

- [ ] **Step 5: Rodar a suite completa para garantir nada quebrou**

```bash
npm test
```

Esperado: todos os testes existentes continuam passando.

- [ ] **Step 6: Commit**

```bash
git add src/adapters/store/ShownDealsTracker.ts tests/adapters/ShownDealsTracker.test.ts
git commit -m "feat: adicionar ShownDealsTracker para rastrear ofertas vistas por categoria"
```

---

### Task 2: Categorização Pelando + expansão do pool Shopee

**Files:**
- Modify: `src/web/server.ts` (função `_monitorPelando` ~linha 290 e `refreshDeals` ~linha 216)
- Modify: `src/adapters/affiliates/ShopeeAffiliate.ts` (linha ~148)

**Interfaces:**
- Consumes: `CATEGORY_KEYWORDS` de `../adapters/affiliates/ShopeeAffiliate.js` (já exportado)
- Consumes: `DealCategory` de `../adapters/affiliates/ShopeeAffiliate.js` (já exportado)

- [ ] **Step 1: Adicionar `inferCategory` em server.ts e atualizar `_monitorPelando`**

Em `src/web/server.ts`, logo após os imports existentes (linha ~20), adicionar o import de `CATEGORY_KEYWORDS`:

```typescript
import { fetchShopeeDeals, generateAffiliateLink, CATEGORY_META, CATEGORY_KEYWORDS, type SubIds, type DealCategory } from '../adapters/affiliates/ShopeeAffiliate.js'
```

> Nota: `CATEGORY_KEYWORDS` e `DealCategory` já estão no arquivo mas `CATEGORY_KEYWORDS` não estava sendo importado — só adicionar ao import existente.

Então, logo antes da função `refreshDeals` (linha ~209), adicionar a função auxiliar:

```typescript
function inferCategory(title: string): DealCategory {
  const lower = title.toLowerCase()
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS) as [DealCategory, string[]][]) {
    if (keywords.some(kw => lower.includes(kw.toLowerCase()))) return cat
  }
  return 'geral'
}
```

Em `_monitorPelando`, localizar (linha ~290):
```typescript
      freshDeals.push({
        id: createHash('sha1').update(d.id).digest('hex').slice(0, 12),
        title: d.title,
        price: d.price,
        discountPercent: d.temperature,
        store: d.store,
        imageUrl: d.imageUrl,
        affiliateUrl: d.dealUrl,
        source,
        category: 'geral',
        publishedAt: now,
      })
```

Substituir `category: 'geral'` por `category: inferCategory(d.title)`:

```typescript
      freshDeals.push({
        id: createHash('sha1').update(d.id).digest('hex').slice(0, 12),
        title: d.title,
        price: d.price,
        discountPercent: d.temperature,
        store: d.store,
        imageUrl: d.imageUrl,
        affiliateUrl: d.dealUrl,
        source,
        category: inferCategory(d.title),
        publishedAt: now,
      })
```

- [ ] **Step 2: Expandir pool Shopee em `refreshDeals`**

Em `src/web/server.ts`, localizar (linha ~216):
```typescript
      const shopeeProducts = await fetchShopeeDeals(12)
```

Substituir por:
```typescript
      const shopeeProducts = await fetchShopeeDeals(20)
```

- [ ] **Step 3: Buscar mais keywords por categoria no ShopeeAffiliate**

Em `src/adapters/affiliates/ShopeeAffiliate.ts`, localizar (linha ~148):
```typescript
    for (const keyword of keywords.slice(0, 4)) {
```

Substituir por:
```typescript
    for (const keyword of keywords.slice(0, 6)) {
```

- [ ] **Step 4: Rodar a suite completa**

```bash
npm test
```

Esperado: todos os testes passam (mudanças são runtime, não afetam testes unitários existentes).

- [ ] **Step 5: Commit**

```bash
git add src/web/server.ts src/adapters/affiliates/ShopeeAffiliate.ts
git commit -m "feat: inferir categoria dos deals Pelando por keyword + expandir pool Shopee para 20 itens"
```

---

### Task 3: Integração do tracker em `sendCategoryDeals` + comando `/resetar`

**Files:**
- Modify: `src/adapters/publishers/TelegramPublisher.ts`

**Interfaces:**
- Consumes: `shownDealsTracker` de `../store/ShownDealsTracker.js`

- [ ] **Step 1: Adicionar import do tracker em TelegramPublisher.ts**

No topo de `src/adapters/publishers/TelegramPublisher.ts`, após os imports existentes, adicionar:

```typescript
import { shownDealsTracker } from '../store/ShownDealsTracker.js'
```

- [ ] **Step 2: Substituir `sendCategoryDeals` pela versão com rastreamento**

Localizar a função `sendCategoryDeals` (linha ~650):

```typescript
  // Reusable: send up to `limit` random deals from a category
  async function sendCategoryDeals(ctx: Ctx, category: DealCategory, limit = 5) {
    const { getCachedDeals } = await import('../../web/server.js')
    const deals = getCachedDeals()
    const pool = deals.filter(d => d.category === category)

    if (!pool.length) {
      await ctx.reply('🔍 Nenhuma oferta nessa categoria no momento. Tente /atualizar.')
      return
    }

    const sample = pool.sort(() => Math.random() - 0.5).slice(0, limit)
    const meta = CATEGORY_META[category]
    await ctx.reply(`${meta.emoji} <b>${meta.label} — ${sample.length} ofertas</b>`, { parse_mode: 'HTML' })
    for (const deal of sample) {
      await sendDealCard(ctx, deal)
      await new Promise(r => setTimeout(r, 300))
    }
  }
```

Substituir por:

```typescript
  // Reusable: send up to `limit` random deals from a category, skipping recently seen ones
  async function sendCategoryDeals(ctx: Ctx, category: DealCategory, limit = 5) {
    const { getCachedDeals } = await import('../../web/server.js')
    const deals = getCachedDeals()
    const pool = deals.filter(d => d.category === category)

    if (!pool.length) {
      await ctx.reply('🔍 Nenhuma oferta nessa categoria no momento. Tente /atualizar.')
      return
    }

    let unseen = shownDealsTracker.filterUnseen(category, pool, d => d.id)

    if (unseen.length === 0) {
      const removed = shownDealsTracker.resetCategory(category)
      await ctx.reply(
        `♻️ Você já viu todos os produtos desta categoria! Reiniciando o histórico (${removed} oferta(s) removidas) com produtos frescos.`
      )
      unseen = pool
    }

    const sample = unseen.sort(() => Math.random() - 0.5).slice(0, limit)
    shownDealsTracker.markShown(category, sample.map(d => d.id))

    const meta = CATEGORY_META[category]
    await ctx.reply(`${meta.emoji} <b>${meta.label} — ${sample.length} ofertas</b>`, { parse_mode: 'HTML' })
    for (const deal of sample) {
      await sendDealCard(ctx, deal)
      await new Promise(r => setTimeout(r, 300))
    }
  }
```

- [ ] **Step 3: Adicionar comando `/resetar`**

Em `src/adapters/publishers/TelegramPublisher.ts`, logo após o comando `/limpar` (linha ~594), adicionar:

```typescript
  bot.command('resetar', (ctx) => {
    const arg = ctx.message.text.split(' ')[1]?.toLowerCase()
    const removed = shownDealsTracker.resetCategory(arg)
    const target = arg ? `da categoria *${arg}*` : `de todas as categorias`
    ctx.reply(
      `✅ Histórico limpo!\n\n🗑️ ${removed} produto(s) removidos ${target}.\nPróxima busca trará produtos frescos.`,
      { parse_mode: 'Markdown' }
    )
  })
```

- [ ] **Step 4: Registrar `/resetar` no `setMyCommands` e em `/ajuda`**

Localizar o array do `HELP_TEXT` (linha ~531) e adicionar após `/limpar`:

```typescript
    '/resetar — ♻️ Limpar histórico de ofertas vistas (ex: /resetar decoracao)',
```

Localizar o `setMyCommands` (linha ~849) e adicionar após a entrada de `limpar`:

```typescript
    { command: 'resetar', description: '♻️ Limpar histórico de categoria (ex: /resetar decoracao)' },
```

- [ ] **Step 5: Rodar a suite completa**

```bash
npm test
```

Esperado: todos os testes passam.

- [ ] **Step 6: Commit**

```bash
git add src/adapters/publishers/TelegramPublisher.ts src/adapters/store/ShownDealsTracker.ts
git commit -m "feat: integrar ShownDealsTracker em sendCategoryDeals + comando /resetar"
```

---

## Verificação final

Após todas as tasks, rodar a suite completa uma última vez:

```bash
npm test
```

Checar manualmente no Telegram (ambiente de desenvolvimento):
1. `/decoracao` — retorna até 5 produtos e os marca como vistos
2. `/decoracao` de novo — retorna produtos diferentes (ou avisa que esgotou e reinicia)
3. `/resetar decoracao` — responde com contagem e limpa o histórico
4. `/resetar` — limpa todas as categorias
5. `/atualizar` seguido de `/decoracao` — confirma que Pelando deals agora aparecem com categoria correta
