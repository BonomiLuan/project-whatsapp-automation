import type { Deal, Marketplace } from '../domain/Deal.js'
import type { AffiliateConfig } from '../domain/Tenant.js'

export interface AffiliateLinkBuilder {
  supports(marketplace: Marketplace): boolean
  build(deal: Deal, config: AffiliateConfig): Promise<Deal>
}
