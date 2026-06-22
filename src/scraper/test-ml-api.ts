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
