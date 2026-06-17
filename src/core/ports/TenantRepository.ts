import type { Tenant } from '../domain/Tenant.js'

export interface TenantRepository {
  findAll(): Promise<Tenant[]>
  findById(id: string): Promise<Tenant | null>
  save(tenant: Tenant): Promise<void>
}
