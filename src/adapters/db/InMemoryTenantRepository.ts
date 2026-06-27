import type { Tenant } from '../../core/domain/Tenant.js'
import type { TenantRepository } from '../../core/ports/TenantRepository.js'

const DEFAULT_TENANT: Tenant = {
  id: 'default',
  name: 'Mamãe Econômica',
  active: true,
  channels: [],
  filters: { minDiscount: 0, keywords: [], excludeKeywords: [], categories: [] },
  affiliates: {},
}

export class InMemoryTenantRepository implements TenantRepository {
  private tenants = new Map<string, Tenant>([[DEFAULT_TENANT.id, { ...DEFAULT_TENANT }]])

  async findAll(): Promise<Tenant[]> {
    return [...this.tenants.values()].filter(t => t.active)
  }

  async findById(id: string): Promise<Tenant | null> {
    return this.tenants.get(id) ?? null
  }

  async save(tenant: Tenant): Promise<void> {
    this.tenants.set(tenant.id, tenant)
  }
}
