import type { AffiliateLinkBuilder } from '../../core/ports/AffiliateLinkBuilder.js'
import type { Deal, Marketplace } from '../../core/domain/Deal.js'
import type { AffiliateConfig } from '../../core/domain/Tenant.js'

export class CompositeAffiliateLinkBuilder implements AffiliateLinkBuilder {
  constructor(private readonly adapters: AffiliateLinkBuilder[]) {}

  supports(marketplace: Marketplace): boolean {
    return this.adapters.some(a => a.supports(marketplace))
  }

  async build(deal: Deal, config: AffiliateConfig): Promise<Deal> {
    const adapter = this.adapters.find(a => a.supports(deal.marketplace))
    if (!adapter) return deal
    return adapter.build(deal, config)
  }
}
