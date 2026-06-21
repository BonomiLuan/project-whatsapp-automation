import { describe, it, expect, vi } from 'vitest'
import type { AffiliateLinkBuilder } from '../../src/core/ports/AffiliateLinkBuilder.js'
import type { Deal } from '../../src/core/domain/Deal.js'
import type { AffiliateConfig } from '../../src/core/domain/Tenant.js'
import { CompositeAffiliateLinkBuilder } from '../../src/adapters/affiliates/CompositeAffiliateLinkBuilder.js'

const makeDeal = (marketplace: Deal['marketplace']): Deal => ({
  id: 'deal-1',
  title: 'Test Deal',
  price: 100,
  url: 'https://example.com/product',
  marketplace,
  category: 'geral',
  postedAt: new Date(),
})

const makeConfig = (): AffiliateConfig => ({
  amazonTag: 'tag-20',
  mlAppId: 'app-123',
  shopeeSourceId: 'src-456',
})

const makeAdapter = (supportedMarketplace: Deal['marketplace'], injectedUrl = 'https://injected.com'): AffiliateLinkBuilder => ({
  supports: (m) => m === supportedMarketplace,
  build: async (deal: Deal, _config: AffiliateConfig) => ({ ...deal, url: injectedUrl }),
})

describe('CompositeAffiliateLinkBuilder', () => {
  it('supports returns true when one adapter supports the marketplace', () => {
    const amazonAdapter = makeAdapter('amazon')
    const composite = new CompositeAffiliateLinkBuilder([amazonAdapter])
    expect(composite.supports('amazon')).toBe(true)
  })

  it('supports returns false when no adapter supports the marketplace', () => {
    const amazonAdapter = makeAdapter('amazon')
    const composite = new CompositeAffiliateLinkBuilder([amazonAdapter])
    expect(composite.supports('shopee')).toBe(false)
  })

  it('build delegates to the matching adapter and returns rewritten deal', async () => {
    const amazonAdapter = makeAdapter('amazon', 'https://amazon.com.br/dp/ASIN?tag=tag-20')
    const composite = new CompositeAffiliateLinkBuilder([amazonAdapter])
    const deal = makeDeal('amazon')
    const config = makeConfig()

    const result = await composite.build(deal, config)

    expect(result.url).toBe('https://amazon.com.br/dp/ASIN?tag=tag-20')
    expect(result.id).toBe(deal.id)
    expect(result.title).toBe(deal.title)
  })

  it('build returns deal unchanged (passthrough) when no adapter supports marketplace', async () => {
    const amazonAdapter = makeAdapter('amazon')
    const composite = new CompositeAffiliateLinkBuilder([amazonAdapter])
    const deal = makeDeal('pelando')
    const config = makeConfig()

    const result = await composite.build(deal, config)

    expect(result).toEqual(deal)
    expect(result.url).toBe('https://example.com/product')
  })

  it('build calls only the first matching adapter when multiple adapters support the same marketplace', async () => {
    const buildSpy1 = vi.fn(async (deal: Deal, _config: AffiliateConfig) => ({ ...deal, url: 'https://first.com' }))
    const buildSpy2 = vi.fn(async (deal: Deal, _config: AffiliateConfig) => ({ ...deal, url: 'https://second.com' }))

    const adapter1: AffiliateLinkBuilder = { supports: (m) => m === 'amazon', build: buildSpy1 }
    const adapter2: AffiliateLinkBuilder = { supports: (m) => m === 'amazon', build: buildSpy2 }

    const composite = new CompositeAffiliateLinkBuilder([adapter1, adapter2])
    const deal = makeDeal('amazon')
    const config = makeConfig()

    const result = await composite.build(deal, config)

    expect(result.url).toBe('https://first.com')
    expect(buildSpy1).toHaveBeenCalledOnce()
    expect(buildSpy2).not.toHaveBeenCalled()
  })
})
