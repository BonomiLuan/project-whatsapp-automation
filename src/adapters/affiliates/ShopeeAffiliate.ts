import crypto from 'crypto'
import axios from 'axios'

const ENDPOINT = 'https://open-api.affiliate.shopee.com.br/graphql'

// Signature: SHA256(AppId + Timestamp + Payload + Secret)
function buildAuth(body: string): string {
  const appId = process.env.SHOPEE_APP_ID
  const secret = process.env.SHOPEE_SECRET
  if (!appId || !secret) throw new Error('SHOPEE_APP_ID and SHOPEE_SECRET must be set')
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
  | 'casa' | 'limpeza' | 'banho' | 'fraldas' | 'decoracao'
  | 'organizacao' | 'geral'

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
  decoracao:   { emoji: '🖼️', label: 'Decoração' },
  organizacao: { emoji: '🗂️', label: 'Organização' },
  geral:       { emoji: '🛍️', label: 'Geral' },
}

export const CATEGORY_KEYWORDS: Partial<Record<DealCategory, string[]>> = {
  higiene: [
    'pomada bepantol', 'pomada assadura', 'algodão bebê', 'cotonete bebê',
    'talco bebê', 'óleo corporal bebê', 'kit higiene bebê', 'trocador bebê',
  ],
  alimentacao: [
    'mamadeira', 'chupeta', 'babador', 'cadeira alimentação',
    'copo transição', 'kit pratos e talheres bebê', 'dosador leite em pó',
    'extrator de leite', 'protetor de seio', 'almofada de amamentação',
  ],
  enxoval: [
    'body bebê', 'body kimono bebê', 'manta bebê', 'cueiro', 'fralda de pano',
    'macacão bebê', 'macacão ziper bebê', 'conjunto pagão', 'bolsa maternidade',
  ],
  mobilidade: [
    'carrinho de bebê', 'bebê conforto', 'cadeira de carro',
    'canguru bebê', 'mochila porta bebê', 'protetor solar para carro',
  ],
  quarto: [
    'berço', 'móbile', 'monitor bebê', 'babá eletrônica',
    'protetor de berço', 'cortina blackout quarto bebê', 'luminária de parede',
  ],
  brinquedos: [
    'brinquedos educativos', 'chocalho', 'mordedor',
    'tapete atividades', 'andador bebê', 'centro de atividades',
    'livros sensoriais', 'bichos de pelúcia',
  ],
  saude: [
    'termômetro digital', 'aspirador nasal', 'nebulizador',
    'cortador de unha bebê', 'escova de cabelo bebê', 'kit primeiros socorros',
  ],
  banho: [
    'toalha capuz', 'banheira dobrável', 'suporte banheira',
    'esponja banho bebê', 'termômetro banheira', 'brinquedo de banho',
  ],
  fraldas: [
    'fralda pampers', 'fralda huggies', 'fralda mamypoko', 'fralda babysec',
    'fralda turma da monica', 'lenço umedecido', 'fralda calça',
    'fralda noturna', 'fralda piscina',
  ],
  limpeza: [
    'sabão em pó', 'sabão líquido', 'amaciante', 'desinfetante',
    'multiuso', 'detergente', 'esponja scotch brite', 'pano microfibra',
    'limpa vidros', 'álcool 70', 'percarbonato de sódio', 'bicarbonato limpeza',
  ],
  decoracao: [
    'quadro decorativo', 'vaso cerâmica', 'espelho redondo',
    'porta-retrato', 'abajur', 'almofada sofá',
    'planta artificial', 'tapete sala', 'cortina',
  ],
  casa: [
    'panela antiaderente', 'jogo de panelas', 'organizador cozinha',
    'cesto roupa suja', 'escorredor de louça', 'porta tempero',
    'air fryer', 'cafeteira', 'liquidificador',
  ],
  maternidade: [
    'mala maternidade', 'cinta pós parto', 'sutiã amamentação',
    'concha de amamentação', 'creme para estrias',
  ],
  organizacao: [
    'organizador de geladeira', 'organizador de armário cozinha',
    'caixa organizadora despensa', 'porta mantimentos cozinha',
    'organizador de gaveta', 'prateleira aramada cozinha',
    'suporte para potes', 'organizador multiuso cozinha',
  ],
}

export async function fetchShopeeDeals(limitPerCategory = 8): Promise<ShopeeProduct[]> {
  const allProducts: ShopeeProduct[] = []
  const seen = new Set<number>()

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS) as [DealCategory, string[]][]) {
    const categoryProducts: ShopeeProduct[] = []

    for (const keyword of keywords.slice(0, 6)) {
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
  // Format 1: /product-name-i.{shopId}.{itemId}
  const m1 = url.match(/[/-]i\.(\d+)\.(\d+)/)
  if (m1) return parseInt(m1[2])
  // Format 2: /product/{shopId}/{itemId} (links curtos expandidos)
  const m2 = url.match(/\/product\/\d+\/(\d+)/)
  if (m2) return parseInt(m2[1])
  return null
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
  originalPrice?: string
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
    const data = await gql<{ productOfferV2: { nodes: Pick<ShopeeProduct, 'itemId' | 'productName' | 'price' | 'priceMin' | 'priceDiscountRate' | 'imageUrl'>[] } }>(`
      query {
        productOfferV2(itemId: ${itemId}, limit: 1) {
          nodes {
            itemId productName price priceMin priceDiscountRate imageUrl
          }
        }
      }
    `)
    const p = data?.productOfferV2?.nodes?.[0]
    if (!p) return null
    const priceNum = parseFloat(p.price)
    const originalPrice = p.priceDiscountRate > 0
      ? (priceNum / (1 - p.priceDiscountRate / 100)).toFixed(2)
      : undefined
    return { price: p.price, priceMin: p.priceMin, originalPrice, name: p.productName, imageUrl: p.imageUrl }
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

import type { AffiliateLinkBuilder } from '../../core/ports/AffiliateLinkBuilder.js'
import type { Deal, Marketplace } from '../../core/domain/Deal.js'
import type { AffiliateConfig } from '../../core/domain/Tenant.js'

export class ShopeeAffiliateLinkBuilder implements AffiliateLinkBuilder {
  supports(marketplace: Marketplace): boolean {
    return marketplace === 'shopee'
  }

  async build(deal: Deal, _config: AffiliateConfig): Promise<Deal> {
    const url = await generateAffiliateLink(deal.url)
    return { ...deal, url }
  }
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
