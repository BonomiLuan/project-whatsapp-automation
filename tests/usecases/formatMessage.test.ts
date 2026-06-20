import { describe, it, expect } from 'vitest'
import { formatMessage } from '../../src/core/usecases/helpers/formatMessage.js'

const BASE_ARGS = {
  emoji: '🛍️',
  title: 'Produto Incrível',
  buyUrl: 'https://example.com/buy',
  groupUrl: 'https://example.com/group',
}

describe('formatMessage', () => {
  it('starts with emoji and title in bold', () => {
    const result = formatMessage({ ...BASE_ARGS })
    expect(result).toMatch(/^🛍️ \*Produto Incrível\*/)
  })

  it('ends with #Anúncio after trimming', () => {
    const result = formatMessage({ ...BASE_ARGS })
    expect(result.endsWith('#Anúncio')).toBe(true)
  })

  it('renders strikethrough original price and bold current price when both present', () => {
    const result = formatMessage({
      ...BASE_ARGS,
      originalPrice: 'R$200,00',
      price: 'R$99,90',
    })
    expect(result).toContain('~R$200,00~ por *R$99,90*')
  })

  it('renders only bold price when originalPrice is absent', () => {
    const result = formatMessage({
      ...BASE_ARGS,
      price: 'R$49,90',
    })
    expect(result).toContain('*R$49,90*')
    expect(result).not.toContain('~')
  })

  it('includes coupon line when coupon is provided', () => {
    const result = formatMessage({
      ...BASE_ARGS,
      coupon: 'DESCONTO10',
    })
    expect(result).toContain('🎟️ Cupom: *DESCONTO10*')
  })

  it('omits coupon line when coupon is not provided', () => {
    const result = formatMessage({ ...BASE_ARGS })
    expect(result).not.toContain('🎟️ Cupom')
  })

  it('includes group link lines when groupUrl is provided', () => {
    const result = formatMessage({
      ...BASE_ARGS,
      groupUrl: 'https://example.com/group',
    })
    expect(result).toContain('💬 Link para o grupo:')
    expect(result).toContain('https://example.com/group')
  })

  it('omits group link lines when groupUrl is empty string', () => {
    const result = formatMessage({
      ...BASE_ARGS,
      groupUrl: '',
    })
    expect(result).not.toContain('💬 Link para o grupo:')
    expect(result).not.toContain('https://example.com/group')
  })

  it('always includes buy link section', () => {
    const result = formatMessage({ ...BASE_ARGS })
    expect(result).toContain('🔗 Link para comprar:')
    expect(result).toContain(BASE_ARGS.buyUrl)
  })

  it('always includes urgency line', () => {
    const result = formatMessage({ ...BASE_ARGS })
    expect(result).toContain('⏰ Aproveite enquanto durar!')
  })
})
