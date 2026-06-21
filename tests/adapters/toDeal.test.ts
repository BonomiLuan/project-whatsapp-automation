import { describe, it, expect } from 'vitest'
import { toDealPelando, isRelevantForNiche } from '../../src/adapters/scrapers/PelandoScraper.js'
import { toDealML } from '../../src/adapters/scrapers/MercadoLivreScraper.js'
import type { PelandoDeal } from '../../src/adapters/scrapers/PelandoScraper.js'
import type { MLCategoryDeal } from '../../src/adapters/scrapers/MercadoLivreScraper.js'

// ── PelandoScraper toDeal ─────────────────────────────────────────────────────

const basePelando: PelandoDeal = {
  id: 'https://www.pelando.com.br/d/produto-teste',
  title: 'Fralda Pampers 48 unidades',
  price: 'R$45,90',
  store: 'Amazon',
  dealUrl: 'https://www.pelando.com.br/d/produto-teste',
  imageUrl: 'https://img.pelando.com.br/produto.jpg',
  temperature: 120,
  publishedAt: '2026-06-20T07:00:00.000Z',
  couponCode: '',
}

describe('toDealPelando', () => {
  it('parses numeric price from R$ string', () => {
    const deal = toDealPelando(basePelando)
    expect(deal.price).toBe(45.90)
  })

  it('maps amazon store to amazon marketplace', () => {
    const deal = toDealPelando({ ...basePelando, store: 'Amazon' })
    expect(deal.marketplace).toBe('amazon')
  })

  it('maps mercado livre store variants to mercadolivre marketplace', () => {
    expect(toDealPelando({ ...basePelando, store: 'Mercado Livre' }).marketplace).toBe('mercadolivre')
    expect(toDealPelando({ ...basePelando, store: 'mercadolivre' }).marketplace).toBe('mercadolivre')
    expect(toDealPelando({ ...basePelando, store: 'ml' }).marketplace).toBe('mercadolivre')
  })

  it('maps shopee store to shopee marketplace', () => {
    const deal = toDealPelando({ ...basePelando, store: 'Shopee' })
    expect(deal.marketplace).toBe('shopee')
  })

  it('falls back to pelando marketplace for unknown stores', () => {
    const deal = toDealPelando({ ...basePelando, store: 'Submarino' })
    expect(deal.marketplace).toBe('pelando')
  })

  it('passes couponCode through when non-empty', () => {
    const deal = toDealPelando({ ...basePelando, couponCode: 'DESCONTO10' })
    expect(deal.couponCode).toBe('DESCONTO10')
  })

  it('converts empty couponCode string to undefined', () => {
    const deal = toDealPelando({ ...basePelando, couponCode: '' })
    expect(deal.couponCode).toBeUndefined()
  })

  it('converts empty imageUrl to undefined', () => {
    const deal = toDealPelando({ ...basePelando, imageUrl: '' })
    expect(deal.imageUrl).toBeUndefined()
  })

  it('parses publishedAt into a Date', () => {
    const deal = toDealPelando(basePelando)
    expect(deal.postedAt).toBeInstanceOf(Date)
    expect(deal.postedAt.toISOString()).toBe('2026-06-20T07:00:00.000Z')
  })

  it('handles malformed price string defensively (NaN → 0)', () => {
    const deal = toDealPelando({ ...basePelando, price: 'Grátis' })
    expect(deal.price).toBe(0)
    expect(Number.isNaN(deal.price)).toBe(false)
  })

  it('maps id and url from dealUrl', () => {
    const deal = toDealPelando(basePelando)
    expect(deal.id).toBe(basePelando.id)
    expect(deal.url).toBe(basePelando.dealUrl)
  })
})

// ── MercadoLivreScraper toDeal ────────────────────────────────────────────────

const baseML: MLCategoryDeal = {
  id: 'MLB123456',
  title: 'Carrinho de Bebê Burigotto',
  price: 'R$899,90',
  originalPrice: 'R$1.299,90',
  discountPercent: 30,
  imageUrl: 'https://http2.mlstatic.com/carrinho.jpg',
  affiliateUrl: 'https://www.mercadolivre.com.br/carrinho?tag=test',
  category: 'mobilidade',
}

describe('toDealML', () => {
  it('parses numeric price from R$ string', () => {
    const deal = toDealML(baseML)
    expect(deal.price).toBe(899.90)
  })

  it('parses originalPrice when present', () => {
    const deal = toDealML(baseML)
    expect(deal.originalPrice).toBe(1299.90)
  })

  it('sets originalPrice to undefined when empty string', () => {
    const deal = toDealML({ ...baseML, originalPrice: '' })
    expect(deal.originalPrice).toBeUndefined()
  })

  it('always sets marketplace to mercadolivre', () => {
    const deal = toDealML(baseML)
    expect(deal.marketplace).toBe('mercadolivre')
  })

  it('passes category through', () => {
    const deal = toDealML(baseML)
    expect(deal.category).toBe('mobilidade')
  })

  it('converts empty imageUrl to undefined', () => {
    const deal = toDealML({ ...baseML, imageUrl: '' })
    expect(deal.imageUrl).toBeUndefined()
  })

  it('maps url from affiliateUrl', () => {
    const deal = toDealML(baseML)
    expect(deal.url).toBe(baseML.affiliateUrl)
  })

  it('handles malformed price string defensively (NaN → 0)', () => {
    const deal = toDealML({ ...baseML, price: 'consulte' })
    expect(deal.price).toBe(0)
    expect(Number.isNaN(deal.price)).toBe(false)
  })
})

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
