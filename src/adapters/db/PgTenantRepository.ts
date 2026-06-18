import type { Tenant } from '../../core/domain/Tenant.js'
import type { TenantRepository } from '../../core/ports/TenantRepository.js'

// ---------------------------------------------------------------------------
// PgTenantRepository — Phase-3 stub implementing TenantRepository port
// Full implementation deferred to Phase 3 (multi-tenant migration)
// ---------------------------------------------------------------------------

export class PgTenantRepository implements TenantRepository {
  findAll(): Promise<Tenant[]> {
    throw new Error('Not implemented — Phase 3')
  }

  findById(_id: string): Promise<Tenant | null> {
    throw new Error('Not implemented — Phase 3')
  }

  save(_tenant: Tenant): Promise<void> {
    throw new Error('Not implemented — Phase 3')
  }
}
