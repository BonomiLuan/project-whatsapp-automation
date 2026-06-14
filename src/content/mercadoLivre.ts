import axios from 'axios'
import { injectMLTag } from '../api/mercadoLivreAffiliate.js'
import type { DealCategory } from '../api/shopeeAffiliate.js'

const ML_API = 'https://api.mercadolibre.com'
const ML_PUBLIC_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
}

const MIN_DISCOUNT_PERCENT = 15

// Baseado no que as mães mais buscam — uma query por nicho
const ML_SEARCHES: { query: string; label: string; defaultCategory: DealCategory }[] = [
  // Bebê essenciais
  { query: 'fraldas descartáveis bebê',              label: 'Fraldas',         defaultCategory: 'fraldas' },
  { query: 'babá eletrônica termômetro esterilizador', label: 'Bebê Essenciais', defaultCategory: 'maternidade' },
  { query: 'almofada amamentação sling',              label: 'Maternidade',     defaultCategory: 'maternidade' },
  { query: 'lenço umedecido creme assaduras',         label: 'Higiene Bebê',    defaultCategory: 'higiene' },

  // Roupas / enxoval
  { query: 'conjunto roupa menino tênis infantil',    label: 'Roupa Menino',    defaultCategory: 'enxoval' },
  { query: 'vestido infantil sapatilha menina',       label: 'Roupa Menina',    defaultCategory: 'enxoval' },
  { query: 'pijama infantil body kit bebê',           label: 'Enxoval Bebê',    defaultCategory: 'enxoval' },

  // Brinquedos
  { query: 'tapete atividades brinquedo bebê educativo', label: 'Brinquedos',   defaultCategory: 'brinquedos' },
  { query: 'boneca bloco montar mochila escolar',     label: 'Brinquedos Criança', defaultCategory: 'brinquedos' },

  // Banho
  { query: 'toalha capuz banheira bebê shampoo neutro', label: 'Banho Bebê',   defaultCategory: 'banho' },
  { query: 'tapete antiderrapante organizador banho', label: 'Acessórios Banho', defaultCategory: 'banho' },

  // Quarto
  { query: 'protetor berço cortina blackout quarto bebê', label: 'Quarto Bebê', defaultCategory: 'quarto' },
  { query: 'luminária mesa adesivo parede tapete pelúcia', label: 'Decoração Quarto', defaultCategory: 'quarto' },

  // Limpeza
  { query: 'aspirador vertical mop microfibra limpeza', label: 'Limpeza',       defaultCategory: 'limpeza' },
  { query: 'desinfetante sabão roupas tira manchas',  label: 'Produtos Limpeza', defaultCategory: 'limpeza' },

  // Decoração
  { query: 'quadro decorativo espelho parede manta sofá', label: 'Decoração',   defaultCategory: 'decoracao' },
  { query: 'organizador armário cesto roupas casa',   label: 'Organização',     defaultCategory: 'casa' },
]

const KEYWORD_MAP: [string, DealCategory][] = [
  // Fraldas
  ['fralda', 'fraldas'],
  ['lenço umedecido', 'higiene'], ['pomada assadura', 'higiene'], ['creme assadur', 'higiene'],
  ['escova de dentes infantil', 'higiene'], ['sabonete líquido', 'higiene'], ['cotonete', 'higiene'],
  ['kit manicure bebê', 'higiene'], ['porta lenço', 'higiene'],

  // Banho
  ['shampoo', 'banho'], ['sabonete', 'banho'], ['toalha capuz', 'banho'], ['banheira', 'banho'],
  ['tapete antiderrapante', 'banho'], ['esponja', 'banho'], ['roupão', 'banho'],

  // Alimentação
  ['mamadeira', 'alimentacao'], ['chupeta', 'alimentacao'], ['esterilizador', 'alimentacao'],
  ['cadeirinha refeição', 'alimentacao'], ['prato bebê', 'alimentacao'],

  // Maternidade / bebê
  ['almofada amamentação', 'maternidade'], ['sling', 'maternidade'], ['babá eletrônica', 'maternidade'],
  ['trocador', 'maternidade'], ['amamenta', 'maternidade'],

  // Enxoval / roupas
  ['body bebê', 'enxoval'], ['manta bebê', 'enxoval'], ['enxoval', 'enxoval'], ['roupinha', 'enxoval'],
  ['pijama infantil', 'enxoval'], ['conjunto menin', 'enxoval'], ['vestido infantil', 'enxoval'],
  ['sapatilha', 'enxoval'], ['tênis infantil', 'enxoval'], ['casaco infantil', 'enxoval'],

  // Mobilidade
  ['carrinho de bebê', 'mobilidade'], ['carrinho', 'mobilidade'], ['bebê conforto', 'mobilidade'],
  ['bebe conforto', 'mobilidade'], ['mochila de rodinha', 'mobilidade'],

  // Quarto
  ['berço', 'quarto'], ['berco', 'quarto'], ['cortina blackout', 'quarto'], ['protetor de berço', 'quarto'],
  ['monitor bebê', 'quarto'], ['tapete de pelúcia', 'quarto'], ['prateleira nicho', 'quarto'],

  // Brinquedos
  ['brinquedo', 'brinquedos'], ['pelúcia', 'brinquedos'], ['boneca', 'brinquedos'],
  ['bloco de montar', 'brinquedos'], ['jogo de tabuleiro', 'brinquedos'], ['tapete de atividades', 'brinquedos'],
  ['carrinho de controle', 'brinquedos'], ['fantasia', 'brinquedos'],

  // Saúde
  ['termômetro', 'saude'], ['aspirador nasal', 'saude'], ['nebulizador', 'saude'],

  // Limpeza
  ['detergente', 'limpeza'], ['sabão em pó', 'limpeza'], ['desinfetante', 'limpeza'],
  ['multiuso', 'limpeza'], ['mop', 'limpeza'], ['aspirador', 'limpeza'],
  ['pano de microfibra', 'limpeza'], ['tira manchas', 'limpeza'],

  // Casa / Organização
  ['panela', 'casa'], ['organização', 'casa'], ['cesto organizador', 'casa'],
  ['organizador de armário', 'casa'], ['caixa organizadora', 'casa'],

  // Decoração
  ['quadro decorativo', 'decoracao'], ['espelho de parede', 'decoracao'], ['luminária', 'decoracao'],
  ['manta para sofá', 'decoracao'], ['capa de almofada', 'decoracao'], ['luz de fada', 'decoracao'],
  ['relógio de parede', 'decoracao'], ['vaso de planta', 'decoracao'], ['tapete geométrico', 'decoracao'],
]

function inferCategory(title: string, fallback: DealCategory): DealCategory {
  const lower = title.toLowerCase()
  for (const [kw, cat] of KEYWORD_MAP) {
    if (lower.includes(kw)) return cat
  }
  return fallback
}

interface MLSearchItem {
  id: string
  title: string
  price: number
  original_price: number | null
  thumbnail: string
  permalink: string
  seller: { nickname: string }
}

export interface MLCategoryDeal {
  id: string
  title: string
  price: string
  originalPrice: string
  discountPercent: number
  imageUrl: string
  affiliateUrl: string
  category: DealCategory
}

export async function fetchMLCategoryDeals(limit = 60): Promise<MLCategoryDeal[]> {
  const deals: MLCategoryDeal[] = []
  const seenIds = new Set<string>()
  const t0 = Date.now()
  let totalFetched = 0
  let totalWithDiscount = 0
  let searchErrors = 0

  for (const search of ML_SEARCHES) {
    try {
      const { data } = await axios.get(`${ML_API}/sites/MLB/search`, {
        params: { q: search.query, sort: 'relevance', limit: 50 },
        headers: ML_PUBLIC_HEADERS,
        timeout: 15000,
      })

      const items = (data.results ?? []) as MLSearchItem[]
      totalFetched += items.length
      let found = 0
      let withDiscount = 0

      for (const item of items) {
        if (seenIds.has(item.id)) continue
        if (!item.original_price || item.original_price <= item.price) continue
        withDiscount++

        const discount = Math.round((1 - item.price / item.original_price) * 100)
        if (discount < MIN_DISCOUNT_PERCENT) continue

        seenIds.add(item.id)
        found++

        const imageUrl = (item.thumbnail ?? '')
          .replace('http://', 'https://')
          .replace(/-I\.(jpg|webp)$/i, '-O.$1')
        const affiliateUrl = await injectMLTag(item.permalink)
        const category = inferCategory(item.title, search.defaultCategory)

        deals.push({
          id: item.id,
          title: item.title.slice(0, 80),
          price: `R$${item.price.toFixed(2).replace('.', ',')}`,
          originalPrice: `R$${item.original_price.toFixed(2).replace('.', ',')}`,
          discountPercent: discount,
          imageUrl,
          affiliateUrl,
          category,
        })
      }

      totalWithDiscount += found
      console.log(`[ml:cat] "${search.label}": ${items.length} retornados | ${withDiscount} c/ desconto | ${found} ≥${MIN_DISCOUNT_PERCENT}% (novos)`)

      // Sample dos primeiros 2 deals encontrados nesta query para confirmar relevância
      const sample = deals.slice(-found).slice(0, 2)
      for (const d of sample) {
        console.log(`[ml:cat]   → ${d.discountPercent}% | ${d.category} | ${d.title.slice(0, 55)}`)
      }
    } catch (e) {
      searchErrors++
      const axErr = e as import('axios').AxiosError
      const status = axErr.response?.status
      const body = JSON.stringify(axErr.response?.data ?? {}).slice(0, 200)
      console.error(`[ml:cat] ERRO "${search.label}": HTTP ${status ?? 'sem resposta'} | ${axErr.message} | body: ${body}`)
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
  const sorted = deals.sort((a, b) => b.discountPercent - a.discountPercent).slice(0, limit)

  // Breakdown por categoria
  const byCategory = sorted.reduce<Record<string, number>>((acc, d) => {
    acc[d.category] = (acc[d.category] ?? 0) + 1
    return acc
  }, {})
  const catSummary = Object.entries(byCategory).map(([k, v]) => `${k}:${v}`).join(' | ')

  console.log(`[ml:cat] ✓ concluído em ${elapsed}s | ${totalFetched} buscados | ${totalWithDiscount} com desconto | ${sorted.length} no cache | erros: ${searchErrors}/${ML_SEARCHES.length}`)
  console.log(`[ml:cat] categorias: ${catSummary}`)

  return sorted
}
