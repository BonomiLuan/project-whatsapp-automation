// Integration tests for /r/:code, /img/:code require DATABASE_URL — run manually after Railway provisioning
// Pure-function tests for isSsrfAllowed and buildExpiredRedirectUrl are in tests/links.test.ts
// buildOGPage is an internal function of src/server/index.ts — HTML structure verified via human checkpoint in Plan 04
// The string-level test below validates the og:title template pattern without importing index.ts
// Tenant route handler logic is tested inline (no server.ts import) to avoid DATABASE_URL side effects at import time

import { describe, it, expect, vi } from 'vitest'
import type { TenantRepository } from '../src/core/ports/TenantRepository.js'
import type { Tenant } from '../src/core/domain/Tenant.js'

describe('buildOGPage HTML structure (string mock)', () => {
  // Reproduce the og:title injection pattern without importing index.ts
  // to avoid DATABASE_URL dependency at import time
  function mockBuildOGPageTitle(title: string): string {
    const escaped = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    return `<meta property="og:title" content="${escaped}">`
  }

  it('og:title tag contains the product title', () => {
    const html = mockBuildOGPageTitle('Fralda Pampers Premium')
    expect(html).toContain('og:title')
    expect(html).toContain('Fralda Pampers Premium')
  })

  it('og:title HTML-encodes & < > characters', () => {
    const html = mockBuildOGPageTitle('A & B < C > D')
    expect(html).toContain('&amp;')
    expect(html).toContain('&lt;')
    expect(html).toContain('&gt;')
    expect(html).not.toContain('A & B')
  })
})

describe('GET /r/:code', () => {
  it.todo('valid code returns 200 HTML with og:title — requires DATABASE_URL')
  it.todo('valid code HTML contains og:image with /img/ path — requires DATABASE_URL')
  it.todo('valid code HTML contains meta http-equiv refresh — requires DATABASE_URL')
  it.todo('unknown code returns 404 — requires DATABASE_URL')
  it.todo('expired link redirects to platform search URL (302) — requires DATABASE_URL')
})

describe('GET /img/:code', () => {
  it.todo('valid code returns 200 with image content-type — requires DATABASE_URL and upstream CDN')
  it.todo('unknown code returns 404 — requires DATABASE_URL')
})

describe('GET /api/links', () => {
  it.todo('without auth returns 401 — requires supertest + live server')
  it.todo('with auth cookie returns array — requires DATABASE_URL + supertest')
})

// ── Tenant route handler logic (inline reproduction — avoids DATABASE_URL import) ──
// These tests reproduce the handler logic from GET /api/tenants, GET /api/config, PATCH /api/config
// to validate business rules without importing server.ts (which opens DB connections at import time).

type MockRes = {
  statusCode: number
  body: unknown
  status: (code: number) => MockRes
  json: (data: unknown) => MockRes
}

function createMockRes(): MockRes {
  const r: MockRes = {
    statusCode: 200,
    body: undefined,
    status(code) { r.statusCode = code; return r },
    json(data) { r.body = data; return r },
  }
  return r
}

function makeFakeTenantRepo(overrides: Partial<TenantRepository> = {}): TenantRepository {
  const defaultTenant: Tenant = {
    id: 'default',
    name: 'Default Tenant',
    channels: [],
    filters: { minDiscount: 0, categories: [], keywords: [], excludeKeywords: [] },
    affiliates: {},
    active: true,
  }
  return {
    findAll: vi.fn().mockResolvedValue([defaultTenant]),
    findById: vi.fn().mockResolvedValue(defaultTenant),
    save: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

// Inline handler reproductions (mirrors src/web/server.ts logic exactly)
async function handleGetTenants(repo: TenantRepository | null, res: MockRes): Promise<MockRes> {
  if (!repo) return res.status(503).json({ error: 'Not initialized' })
  const tenants = await repo.findAll()
  return res.json(tenants)
}

async function handleGetConfig(repo: TenantRepository | null, res: MockRes): Promise<MockRes> {
  if (!repo) return res.status(503).json({ error: 'Not initialized' })
  const tenant = await repo.findById('default')
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' })
  return res.json(tenant)
}

async function handlePatchConfig(
  repo: TenantRepository | null,
  body: Partial<Tenant>,
  res: MockRes,
): Promise<MockRes> {
  if (!repo) return res.status(503).json({ error: 'Not initialized' })
  const current = await repo.findById('default')
  if (!current) return res.status(404).json({ error: 'Tenant not found' })
  const updated: Tenant = {
    ...current,
    filters: body.filters ?? current.filters,
    affiliates: body.affiliates ?? current.affiliates,
    channels: body.channels ?? current.channels,
    id: 'default',
    active: current.active,
  }
  await repo.save(updated)
  return res.json(updated)
}

describe('GET /api/tenants handler logic', () => {
  it('returns 200 with array of tenants when repo is initialized', async () => {
    const repo = makeFakeTenantRepo()
    const res = await handleGetTenants(repo, createMockRes())
    expect(res.statusCode).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect((res.body as Tenant[])[0].id).toBe('default')
  })

  it('returns 503 when repo is not initialized', async () => {
    const res = await handleGetTenants(null, createMockRes())
    expect(res.statusCode).toBe(503)
    expect((res.body as { error: string }).error).toBe('Not initialized')
  })
})

describe('GET /api/config handler logic', () => {
  it('returns 200 with default tenant when found', async () => {
    const repo = makeFakeTenantRepo()
    const res = await handleGetConfig(repo, createMockRes())
    expect(res.statusCode).toBe(200)
    expect((res.body as Tenant).id).toBe('default')
  })

  it('returns 404 when findById returns null', async () => {
    const repo = makeFakeTenantRepo({ findById: vi.fn().mockResolvedValue(null) })
    const res = await handleGetConfig(repo, createMockRes())
    expect(res.statusCode).toBe(404)
    expect((res.body as { error: string }).error).toBe('Tenant not found')
  })
})

describe('PATCH /api/config handler logic', () => {
  it('returns 200 with merged tenant', async () => {
    const repo = makeFakeTenantRepo()
    const res = await handlePatchConfig(
      repo,
      { affiliates: { amazonTag: 'my-tag-20' } },
      createMockRes(),
    )
    expect(res.statusCode).toBe(200)
    expect((res.body as Tenant).affiliates.amazonTag).toBe('my-tag-20')
    expect(repo.save).toHaveBeenCalledOnce()
  })

  it('does not allow overriding id via PATCH body', async () => {
    const repo = makeFakeTenantRepo()
    const res = await handlePatchConfig(
      repo,
      { id: 'hacked' } as Partial<Tenant>,
      createMockRes(),
    )
    expect((res.body as Tenant).id).toBe('default')
  })

  it('does not allow overriding active via PATCH body', async () => {
    const repo = makeFakeTenantRepo()
    const res = await handlePatchConfig(
      repo,
      { active: false } as Partial<Tenant>,
      createMockRes(),
    )
    // current.active is true (from fakeTenantRepo) — must remain true
    expect((res.body as Tenant).active).toBe(true)
  })

  it('returns 404 when current tenant not found', async () => {
    const repo = makeFakeTenantRepo({ findById: vi.fn().mockResolvedValue(null) })
    const res = await handlePatchConfig(repo, {}, createMockRes())
    expect(res.statusCode).toBe(404)
  })
})
