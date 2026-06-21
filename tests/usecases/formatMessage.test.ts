import { describe, it, expect } from 'vitest'
import { formatMessage } from '../../src/core/usecases/helpers/formatMessage.js'

const BASE_ARGS = {
  emoji: '🛍️',
  title: 'Produto Incrível',
  buyUrl: 'https://example.com/buy',
  groupUrl: 'https://example.com/group',
}

describe('formatMessage', () => {
  it('starts with emoji and title', () => {
    const result = formatMessage({ ...BASE_ARGS })
    expect(result).toMatch(/^🛍️ Produto Incrível/)
  })

  it('ends with #Anúncio after trimming', () => {
    const result = formatMessage({ ...BASE_ARGS })
    expect(result.endsWith('#Anúncio')).toBe(true)
  })

  it('renders De/Por lines when both prices present', () => {
    const result = formatMessage({
      ...BASE_ARGS,
      originalPrice: 'R$200,00',
      price: 'R$99,90',
    })
    expect(result).toContain('💸 De: R$200,00')
    expect(result).toContain('🔥 Por: R$99,90')
  })

  it('renders only Por line when originalPrice is absent', () => {
    const result = formatMessage({
      ...BASE_ARGS,
      price: 'R$49,90',
    })
    expect(result).toContain('🔥 Por: R$49,90')
    expect(result).not.toContain('💸 De:')
  })

  it('includes coupon line when coupon is provided', () => {
    const result = formatMessage({
      ...BASE_ARGS,
      coupon: 'DESCONTO10',
    })
    expect(result).toContain('🎟️ Use cupom DESCONTO10')
  })

  it('omits coupon line when coupon is not provided', () => {
    const result = formatMessage({ ...BASE_ARGS })
    expect(result).not.toContain('🎟️ Use cupom')
  })

  it('includes group url when groupUrl is provided', () => {
    const result = formatMessage({
      ...BASE_ARGS,
      groupUrl: 'https://example.com/group',
    })
    expect(result).toContain('https://example.com/group')
  })

  it('omits group url when groupUrl is empty string', () => {
    const result = formatMessage({
      ...BASE_ARGS,
      groupUrl: '',
    })
    expect(result).not.toContain('https://example.com/group')
  })

  it('always includes buy link section', () => {
    const result = formatMessage({ ...BASE_ARGS })
    expect(result).toContain('🛒 Compre aqui ⬇️')
    expect(result).toContain(BASE_ARGS.buyUrl)
  })
})
