import type { Deal } from '../domain/Deal.js'
import type { Tenant } from '../domain/Tenant.js'

export interface DealPublisher {
  publish(deal: Deal, tenant: Tenant): Promise<void>
}
