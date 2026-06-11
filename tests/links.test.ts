import { describe, it, expect } from 'vitest'
import { isSsrfAllowed, buildExpiredRedirectUrl } from '../src/server/links.js'

describe('isSsrfAllowed', () => {
  it('allows shopee CDN image URL', () => {
    expect(isSsrfAllowed('https://cf-img.shopee.com.br/file/abc')).toBe(true)
  })

  it('allows mlstatic image URL', () => {
    expect(isSsrfAllowed('https://img.mlstatic.com/abc')).toBe(true)
  })

  it('allows szcdn image URL', () => {
    expect(isSsrfAllowed('https://media.szcdn.com/image.jpg')).toBe(true)
  })

  it('allows ssl-images-amazon URL', () => {
    expect(isSsrfAllowed('https://images-na.ssl-images-amazon.com/images/I/abc.jpg')).toBe(true)
  })

  it('allows cloudfront URL', () => {
    expect(isSsrfAllowed('https://d1abc.cloudfront.net/image.jpg')).toBe(true)
  })

  it('rejects evil.com', () => {
    expect(isSsrfAllowed('https://evil.com/img.jpg')).toBe(false)
  })

  it('rejects non-URL string', () => {
    expect(isSsrfAllowed('not-a-url')).toBe(false)
  })

  it('rejects URL with allowed domain in path (not hostname)', () => {
    expect(isSsrfAllowed('https://evil.com/shopee.com.br/image.jpg')).toBe(false)
  })
})

describe('buildExpiredRedirectUrl', () => {
  it('returns shopee search URL for shopee source', () => {
    const url = buildExpiredRedirectUrl('shopee', 'Fralda Pampers')
    expect(url).toContain('shopee.com.br/search?keyword=')
    expect(url).toContain('Fralda')
  })

  it('returns amazon search URL for amazon source', () => {
    const url = buildExpiredRedirectUrl('amazon', 'Fralda Pampers')
    expect(url).toContain('amazon.com.br/s?k=')
    expect(url).toContain('tag=')
  })

  it('returns mercadolivre search URL for ml source', () => {
    const url = buildExpiredRedirectUrl('ml', 'Fralda Pampers')
    expect(url).toContain('mercadolivre.com.br/jm/search')
    expect(url).toContain('matt_tool=')
  })

  it('URL-encodes the product title for shopee', () => {
    const url = buildExpiredRedirectUrl('shopee', 'Fralda Pampers')
    expect(url).toContain(encodeURIComponent('Fralda Pampers'))
  })

  it('URL-encodes the product title for amazon', () => {
    const url = buildExpiredRedirectUrl('amazon', 'Fralda Pampers')
    expect(url).toContain(encodeURIComponent('Fralda Pampers'))
  })

  it('URL-encodes the product title for ml', () => {
    const url = buildExpiredRedirectUrl('ml', 'Fralda Pampers')
    expect(url).toContain(encodeURIComponent('Fralda Pampers'))
  })
})

describe('createLink', () => {
  it.todo('inserts a row and returns LinkEntry with 5-char code and expires_at = NOW() + 45 days — requires live DB')
})

describe('getLink', () => {
  it.todo('returns null for unknown code — requires live DB')
  it.todo('returns LinkEntry for known code — requires live DB')
})

describe('incrementClick', () => {
  it.todo('increments click_count by 1 for known code — requires live DB')
})

describe('getLinks', () => {
  it.todo('returns rows ordered by created_at DESC — requires live DB')
})
