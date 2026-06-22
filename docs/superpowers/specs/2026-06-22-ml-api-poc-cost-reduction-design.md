# ML API POC + Cost Reduction Design

**Date:** 2026-06-22
**Status:** Approved

## Context

O Railway subiu de custo de um dia para o outro por causa do uso intenso de Playwright/Chromium no `MercadoLivreScraper`. O scraper roda a cada 30 minutos, lança um browser Chromium completo (~200–400MB RAM), faz 5 buscas com scroll progressivo (~21s de CPU por execução) — 48 vezes por dia.

Objetivo: reduzir custo de infraestrutura sem sacrificar qualidade das ofertas enviadas ao grupo.

## Escopo

Dois entregáveis independentes:

1. **Redução imediata de frequência** — mudar o cron do ML de `*/30 * * * *` para `0 8-22/2 * * *` (mesmo horário do Pelando). Ganho garantido de 75% nas execuções Playwright, independente do resultado da POC.

2. **POC da ML API pública** — validar se o endpoint REST público do ML retorna dados suficientes para substituir o Playwright por completo. Se passar, a integração ao sistema existente vem na fase seguinte.

## POC — Design Técnico

### Endpoint

```
GET https://api.mercadolibre.com/sites/MLB/search?q={query}&limit=50&sort=relevance
```

Endpoint público, sem autenticação. Campos úteis no response:
- `id` — identificador MLB do produto
- `title` — nome do produto
- `price` — preço atual
- `original_price` — preço anterior (null se não há desconto)
- `thumbnail` — URL da imagem
- `permalink` — URL do produto no ML (recebe o affiliate tag)

### Arquivo

`src/scraper/test-ml-api.ts` — script standalone, sem imports de produção exceto `injectMLTag`.

Roda com: `npx tsx src/scraper/test-ml-api.ts`

### Fluxo

1. Itera as 5 buscas do scraper atual (`ML_SEARCHES`)
2. 300ms de intervalo entre requests (evita rate limit)
3. Headers de browser em todas as requests:
   - `User-Agent: Mozilla/5.0 ...Chrome/124...`
   - `Accept-Language: pt-BR,pt;q=0.9`
   - `Accept: application/json`
4. Retry automático em 403/429: 3 tentativas com backoff exponencial (1s, 2s, 4s)
5. Filtra por `original_price > price` e desconto calculado ≥ 15% (mesma regra do Playwright)
6. Injeta affiliate tag no `permalink` via `injectMLTag` existente
7. Imprime relatório de validação no terminal

### Relatório de saída

```
[ml-api-poc] Busca: fralda descartavel bebe
  Total: 48 | Com desconto ≥15%: 22 | Tempo: 0.4s

[ml-api-poc] RESUMO
  Total encontrado: 206 | Com desconto: 89 | Tempo total: 1.8s
  Top 5 por desconto:
    1. Fralda Pampers [...] — R$49,90 (era R$79,90) — 38% OFF
    ...
  → Resultado: APROVADO (≥20 produtos com desconto)
```

### Critério de sucesso

≥ 20 produtos com desconto ≥ 15% nas 5 buscas combinadas, em menos de 5 segundos.

Falha esperada se Railway tiver IP bloqueado pelo ML — nesse caso, todos os retries retornam 403 e o relatório imprime `→ Resultado: BLOQUEADO POR IP`.

## Risco Principal

**IP de datacenter bloqueado pelo ML.** Railway usa IPs de datacenter que o ML pode bloquear para requests à API. Se isso acontecer, a POC falha e o plano cai para:
- Manter Playwright com frequência reduzida (`0 8-22/2 * * *`)
- Avaliar uso de proxy residencial como alternativa futura

## O que está fora do escopo

- Integração ao `MercadoLivreScraper` de produção (vem em fase separada se POC passar)
- Paginação além de 50 resultados por busca
- Cache de resultados entre execuções
- Alterações no Pelando scraper

## Ganhos esperados

| Cenário | RAM por execução | Execuções/dia | Custo relativo |
|---|---|---|---|
| Atual (Playwright, 30min) | ~300MB | 48 | 100% |
| Frequência reduzida (2h) | ~300MB | 8 | ~17% |
| API pública (2h) | ~10MB | 8 | ~1% |
