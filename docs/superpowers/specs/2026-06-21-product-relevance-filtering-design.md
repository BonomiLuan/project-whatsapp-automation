# Product Relevance Filtering

**Date:** 2026-06-21  
**Status:** Approved

## Problem

The PelandoScraper fetches from `para-meu-lar` — a broad Pelando category that includes products unrelated to the target audience (housewives): air conditioners, power strips, car scanners, external hard drives, etc. All Pelando deals are tagged `category: 'geral'`, so the existing category filter offers no protection.

## Solution: Two-Layer Filter

### Layer 1 — PelandoScraper topic allowlist (code)

Add `TOPIC_KEYWORDS` constant to `PelandoScraper.ts` immediately after the `CATEGORIES` constant. Any Pelando deal whose title does not contain at least one keyword is dropped before entering the pipeline.

Scope of the allowlist:

| Group | Keywords |
|---|---|
| Baby/maternity | fralda, bebê, bebe, infantil, maternidade, berço, berco, carrinho, mamadeira, chupeta, enxoval, lenço umedecido, lenco umedecido, pomada assadura |
| Kitchen | panela, frigideira, airfryer, air fryer, cafeteira, batedeira, chaleira, liquidificador, escorredor, faca, tábua, tabua, tigela, pote |
| Cleaning | sabão, sabao, detergente, desinfetante, amaciante, esponja, mop, limpador, multiuso, vassoura, rodo |
| Beauty/hygiene | shampoo, condicionador, creme, hidratante, sabonete, maquiagem, perfume, esmalte, absorvente, protetor solar, desodorante |
| Home/organisation | tapete, cortina, toalha, cesto, organizador, almofada, jogo de cama, edredom, prateleira, cabide, quadro decorativo |
| Pet | ração, racao, coleira, arranhador |
| Toys | brinquedo, pelúcia, pelucia, boneca, quebra-cabeça |

The filter is applied in `fetchDeals()`, after the temperature and status checks, before any network calls (Amazon image fetch, Shopee expand, etc.) — this avoids wasting HTTP calls on products that would be filtered out anyway.

Coupon deals are **not filtered** by this allowlist because coupon titles are often generic store-level discounts (e.g. "10% OFF na Amazon") that are valuable regardless of product keyword match.

### Layer 2 — Tenant `excludeKeywords` (config via API)

Infrastructure already exists. Seed an initial `excludeKeywords` list for the default tenant:

```json
["só no app", "somente no app", "only in app", "prime", "assinatura"]
```

This removes deals that are technically listed on Pelando but have no publicly accessible offer. No code change required — updated via `PATCH /api/config`.

## Files Changed

- `src/adapters/scrapers/PelandoScraper.ts` — add `TOPIC_KEYWORDS` constant and filter in `fetchDeals()`

## Out of Scope

- Changing Pelando categories fetched (the two current categories are kept)
- MercadoLivreScraper (already uses a targeted keyword-based search)
- Dynamic keyword management via API (YAGNI — static list is sufficient)
