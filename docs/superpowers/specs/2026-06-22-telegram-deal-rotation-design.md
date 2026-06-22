# Design: Rotação e Deduplicação de Ofertas nos Comandos Telegram

**Data:** 2026-06-22
**Status:** Aprovado

## Problema

Os comandos de categoria no Telegram (`/decoracao`, `/higiene`, etc.) retornam sempre os mesmos produtos porque:

1. **Pool pequeno** — Shopee retorna 12 itens por categoria; ML e Pelando têm poucos itens por nicho.
2. **Sem rastreamento de vistos** — `sendCategoryDeals` embaralha aleatoriamente o cache sem memória do que já foi mostrado.
3. **Pelando não categoriza** — todos os deals do Pelando scraper chegam como `category: 'geral'`, nunca aparecem nos comandos de nicho.

## Escopo

Todas as quatro fontes: **Shopee**, **Mercado Livre**, **Amazon** e **Pelando**.

## Design

### 1. Módulo `ShownDealsTracker`

Novo arquivo: `src/adapters/store/ShownDealsTracker.ts`

Responsabilidade única: rastrear quais deal IDs já foram exibidos por categoria, com TTL configurável.

```
Interface:
  markShown(category: string, dealIds: string[]): void
  filterUnseen(category: string, deals: T[], getId: (d: T) => string, ttlDays: number): T[]
  resetCategory(category?: string): number   // retorna quantos IDs removidos
```

Implementação:
- `Map<category, Map<dealId, seenAt: number>>` — tudo em memória, sem banco.
- `filterUnseen` evicta entradas antigas na leitura (lazy eviction) antes de filtrar.
- Singleton exportado: `export const shownDealsTracker = new ShownDealsTracker()`

TTL padrão: **5 dias** (constante `SEEN_TTL_DAYS = 5`).

### 2. Integração em `sendCategoryDeals` (TelegramPublisher.ts)

Fluxo após mudança:

```
1. Buscar pool do cache (igual hoje)
2. filterUnseen(category, pool, ttlDays=5)
3. Se pool filtrado vazio → resetCategory(category) + repetir passo 2
   + avisar usuário: "♻️ Você viu todos os produtos desta categoria! Reiniciando o histórico com ofertas frescas."
4. Amostrar até `limit` deals do pool filtrado
5. markShown(category, ids selecionados)
6. Enviar deals
```

### 3. Categorização dos deals do Pelando

Em `_monitorPelando` (server.ts), substituir `category: 'geral'` por inferência via keywords.

Adicionar função auxiliar `inferCategory(title: string): DealCategory`:
- Importa `CATEGORY_KEYWORDS` do ShopeeAffiliate (já existente).
- Converte título para minúsculas, verifica se contém alguma keyword de cada categoria.
- Retorna a primeira categoria com match; `'geral'` se nenhuma.
- A mesma lógica se aplica a todos os deals do Pelando (Amazon, ML e outros vindos do scraper).

### 4. Expansão do pool da Shopee

Em `refreshDeals()` (server.ts):
- Aumentar `fetchShopeeDeals(12)` → `fetchShopeeDeals(20)`.

Em `fetchShopeeDeals` (ShopeeAffiliate.ts):
- Aumentar `.slice(0, 4)` → `.slice(0, 6)` para buscar mais keywords por categoria.

### 5. Comando `/resetar [categoria]`

Novo comando no bot (TelegramPublisher.ts):

```
/resetar          → limpa histórico de todas as categorias
/resetar decoracao → limpa só decoração
```

Resposta: `✅ X produtos removidos do histórico de [categoria / todas as categorias]. Próxima busca trará produtos frescos.`

Registrar no `setMyCommands` e no texto de `/ajuda`.

## Fontes e o que muda por fonte

| Fonte | Categorias | Pool | Seen-tracking |
|---|---|---|---|
| Shopee | ✅ já corretas | Expandir 12→20 itens | ✅ novo |
| ML Scraper | ✅ já corretas | Sem mudança | ✅ novo |
| Pelando Amazon | ❌ `'geral'` hoje | Inferência por keyword | ✅ novo |
| Pelando ML | ❌ `'geral'` hoje | Inferência por keyword | ✅ novo |

## Limites e trade-offs

- **Não sobrevive a restart**: histórico de vistos é em memória. Aceitável — deploy limpa o histórico, os 5 dias recomeçam.
- **Sem banco, sem migração**: zero impacto na infra Railway.
- **Esgotamento de pool**: coberto pelo fallback automático de reset por categoria.
- **Deals de categorias com pool pequeno** (ex: `enxoval` no Pelando): fallback garante que nunca retorna lista vazia; TTL efetivo pode ser menor que 5 dias se o pool for < 5 itens.

## Arquivos afetados

| Arquivo | Mudança |
|---|---|
| `src/adapters/store/ShownDealsTracker.ts` | **Novo** — módulo de rastreamento |
| `src/web/server.ts` | Categorização Pelando + pool Shopee 20 |
| `src/adapters/affiliates/ShopeeAffiliate.ts` | `.slice(0,4)` → `.slice(0,6)` |
| `src/adapters/publishers/TelegramPublisher.ts` | Integrar tracker em `sendCategoryDeals` + comando `/resetar` |
| `tests/` | Testes unitários para `ShownDealsTracker` e `inferCategory` |
