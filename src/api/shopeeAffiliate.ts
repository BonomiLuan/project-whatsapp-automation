import crypto from 'crypto'
import axios from 'axios'

const ENDPOINT = 'https://open-api.affiliate.shopee.com.br/graphql'

// Signature: SHA256(AppId + Timestamp + Payload + Secret)
function buildAuth(body: string): string {
  const appId = process.env.SHOPEE_APP_ID!
  const secret = process.env.SHOPEE_SECRET!
  const ts = Math.floor(Date.now() / 1000)
  const factor = `${appId}${ts}${body}${secret}`
  const signature = crypto.createHash('sha256').update(factor).digest('hex')
  return `SHA256 Credential=${appId}, Timestamp=${ts}, Signature=${signature}`
}

async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const body = JSON.stringify({ query, ...(variables ? { variables } : {}) })
  const res = await axios.post<{ data: T; errors?: { message: string }[] }>(ENDPOINT, body, {
    headers: { 'Content-Type': 'application/json', Authorization: buildAuth(body) },
    timeout: 15000,
  })
  if (res.data?.errors?.length) {
    throw new Error(res.data.errors[0].message)
  }
  return res.data.data
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type DealCategory =
  | 'higiene' | 'alimentacao' | 'enxoval' | 'mobilidade'
  | 'quarto' | 'brinquedos' | 'saude' | 'maternidade'
  | 'casa' | 'limpeza' | 'banho' | 'fraldas' | 'geral'

export interface ShopeeProduct {
  itemId: number
  productName: string
  price: string
  priceMin: string
  priceMax: string
  priceDiscountRate: number
  commissionRate: string
  ratingStar: string
  imageUrl: string
  offerLink: string
  productLink: string
  shopName: string
  shopId: number
  category: DealCategory
}

// ── Keyword search by niche category ─────────────────────────────────────────

export const CATEGORY_META: Record<DealCategory, { emoji: string; label: string }> = {
  higiene:     { emoji: '🧴', label: 'Higiene' },
  alimentacao: { emoji: '🍼', label: 'Alimentação' },
  enxoval:     { emoji: '👶', label: 'Enxoval' },
  mobilidade:  { emoji: '🚗', label: 'Mobilidade' },
  quarto:      { emoji: '🛏️', label: 'Quarto' },
  brinquedos:  { emoji: '🧸', label: 'Brinquedos' },
  saude:       { emoji: '💊', label: 'Saúde' },
  maternidade: { emoji: '🤱', label: 'Maternidade' },
  casa:        { emoji: '🏠', label: 'Casa' },
  limpeza:     { emoji: '🧹', label: 'Limpeza' },
  banho:       { emoji: '🛁', label: 'Banho Bebê' },
  fraldas:     { emoji: '🍼', label: 'Fraldas' },
  geral:       { emoji: '🛍️', label: 'Geral' },
}

const CATEGORY_KEYWORDS: Partial<Record<DealCategory, string[]>> = {
  higiene: [
    'fralda pampers', 'fralda huggies', 'fralda mamypoko', 'fralda babysec',
    'lenço umedecido pampers', 'lenço umedecido huggies', 'lenço umedecido johnsons',
    'pomada bepantol bebê', 'pomada assadura', 'kit higiene bebê',
    'shampoo johnsons bebê', 'sabonete johnsons bebê', 'algodão bebê',
  ],
  alimentacao: [
    'mamadeira', 'chupeta', 'babador bebê', 'cadeira alimentação bebê',
    'copo transição bebê', 'dicas para mães',
  ],
  enxoval: [
    'enxoval de bebe', 'enxoval bebe', 'lista de enxoval',
    'mãe de primeira viagem', 'body bebê', 'manta bebê',
  ],
  mobilidade: [
    'melhor carrinho de bebê', 'carrinho com bebe conforto',
    'bebê conforto', 'cadeira de carro', 'carregador bebê',
  ],
  quarto: [
    'quarto de bebê', 'berço bebê', 'dicas de decoração', 'móbile berço', 'monitor bebê',
  ],
  brinquedos: [
    'brinquedos educativos', 'desenvolvimento infantil',
    'chocalho bebê', 'mordedor bebê', 'tapete atividades bebê',
  ],
  saude: [
    'termômetro bebê', 'febre bebê', 'aspirador nasal bebê', 'nebulizador', 'cortador unhinha bebê',
  ],
  maternidade: [
    'mala da maternidade', 'almofada de amamentação', 'amamentação', 'cinta pós parto', 'parto',
  ],
  casa: [
    'panela antiaderente', 'jogo de panelas', 'tapete sala', 'organizador cozinha',
    'cesto roupa suja', 'escorredor de louça', 'porta tempero',
  ],
  banho: [
    'toalha fralda papi bebê', 'toalha com capuz bebê', 'toalha papi',
    'sabonete mustela bebê', 'sabonete johnsons bebê', 'sabonete galinha pintadinha',
    'shampoo mustela bebê', 'shampoo johnsons bebê', 'shampoo infantil',
    'condicionador infantil', 'hidratante mustela bebê', 'creme hidratante bebê',
    'banheira bebê', 'banheira dobrável bebê', 'suporte banheira bebê',
    'esponja banho bebê', 'termômetro banheira bebê',
  ],
  fraldas: [
    'fralda pampers premium care', 'fralda pampers pants', 'fralda pampers confort sec',
    'fralda huggies supreme', 'fralda huggies roupinha', 'fralda huggies pants',
    'fralda pants pull up', 'fralda calça bebê', 'fralda pants noturna',
    'fralda de piscina bebê', 'fralda piscina huggies little swimmers',
    'fralda premium bebê', 'fralda ultrafina premium', 'fralda mamypoko pants',
    'kit fralda pampers rn', 'fralda babysec premium', 'fralda turma da monica',
  ],
  limpeza: [
    'sabão em pó omo', 'sabão em pó ariel', 'sabão em pó brilhante', 'sabão em pó ypê',
    'sabão líquido omo', 'sabão líquido ariel downy',
    'amaciante downy', 'amaciante comfort',
    'desinfetante lysol', 'desinfetante pinho sol',
    'multiuso veja', 'limpador banheiro veja',
    'água sanitária ypê', 'detergente ypê',
    'esponja scotch brite', 'pano microfibra limpeza',
  ],
}

export async function fetchShopeeDeals(limitPerCategory = 8): Promise<ShopeeProduct[]> {
  const allProducts: ShopeeProduct[] = []
  const seen = new Set<number>()

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS) as [DealCategory, string[]][]) {
    const categoryProducts: ShopeeProduct[] = []

    for (const keyword of keywords.slice(0, 4)) {
      try {
        const data = await gql<{ productOfferV2: { nodes: Omit<ShopeeProduct, 'category'>[] } }>(`
          query {
            productOfferV2(keyword: "${keyword}", limit: 10, sortType: 2) {
              nodes {
                itemId productName price priceMin priceMax
                priceDiscountRate commissionRate ratingStar
                imageUrl offerLink productLink shopName shopId
              }
            }
          }
        `)
        for (const p of data?.productOfferV2?.nodes ?? []) {
          if (!seen.has(p.itemId) && p.priceDiscountRate > 0) {
            seen.add(p.itemId)
            categoryProducts.push({ ...p, category })
          }
        }
      } catch { /* skip keyword if fails */ }
    }

    categoryProducts
      .filter(p => parseFloat(p.ratingStar) >= 4.7 && parseFloat(p.commissionRate) >= 0.05)
      .sort((a, b) => b.priceDiscountRate - a.priceDiscountRate)
      .slice(0, limitPerCategory)
      .forEach(p => allProducts.push(p))
  }

  return allProducts
}

// ── Fetch product info by URL (extracts itemId, queries API) ─────────────────

function parseShopeeItemId(url: string): number | null {
  // Format: shopee.com.br/product-name-i.{shopId}.{itemId}
  const match = url.match(/[/-]i\.(\d+)\.(\d+)/)
  return match ? parseInt(match[2]) : null
}

export async function expandShortLink(url: string): Promise<string> {
  try {
    const res = await axios.get(url, {
      maxRedirects: 5,
      timeout: 8000,
      validateStatus: () => true,
    })
    // axios follows redirects and exposes final URL via request internals
    return (res.request as { res?: { responseUrl?: string } }).res?.responseUrl ?? url
  } catch {
    return url
  }
}

export interface ShopeeProductInfo {
  price: string
  priceMin: string
  name: string
  imageUrl: string
}

export async function fetchShopeeProductByUrl(url: string): Promise<ShopeeProductInfo | null> {
  let resolvedUrl = url
  if (url.includes('s.shopee.com.br') || url.includes('shp.ee')) {
    resolvedUrl = await expandShortLink(url)
  }

  const itemId = parseShopeeItemId(resolvedUrl)
  if (!itemId) return null

  try {
    const data = await gql<{ productOfferV2: { nodes: Pick<ShopeeProduct, 'itemId' | 'productName' | 'price' | 'priceMin' | 'imageUrl'>[] } }>(`
      query {
        productOfferV2(itemId: ${itemId}, limit: 1) {
          nodes {
            itemId productName price priceMin imageUrl
          }
        }
      }
    `)
    const p = data?.productOfferV2?.nodes?.[0]
    if (!p) return null
    return { price: p.price, priceMin: p.priceMin, name: p.productName, imageUrl: p.imageUrl }
  } catch {
    return null
  }
}

// ── Convert any Shopee URL to affiliate short link ────────────────────────────

export interface SubIds {
  source: 'telegram' | 'whatsapp' | 'web'
  trigger: 'auto' | 'manual'
  category: 'maternidade' | 'casa' | 'geral'
  slot: 'morning' | 'afternoon' | 'evening' | 'none'
}

function toSubIdArray(s: SubIds): string[] {
  const date = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }).split('/').reverse().join('')
  return [s.source, s.trigger, s.category, s.slot, date]
}

export async function generateAffiliateLink(originUrl: string, subIds?: SubIds): Promise<string> {
  const subIdsArg = subIds
    ? `, subIds: ${JSON.stringify(toSubIdArray(subIds))}`
    : ''
  const data = await gql<{ generateShortLink: { shortLink: string } }>(`
    mutation {
      generateShortLink(input: { originUrl: "${originUrl}"${subIdsArg} }) {
        shortLink
      }
    }
  `)
  return data?.generateShortLink?.shortLink ?? originUrl
}
