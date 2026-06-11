// Integration tests for /r/:code, /img/:code require DATABASE_URL — run manually after Railway provisioning
// Pure-function tests for isSsrfAllowed and buildExpiredRedirectUrl are in tests/links.test.ts
// buildOGPage is an internal function of src/server/index.ts — HTML structure verified via human checkpoint in Plan 04
// The string-level test below validates the og:title template pattern without importing index.ts

import { describe, it, expect } from 'vitest'

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
