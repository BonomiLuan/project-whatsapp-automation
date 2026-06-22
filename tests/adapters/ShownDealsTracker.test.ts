import { describe, it, expect, beforeEach } from 'vitest'
import { ShownDealsTracker } from '../../src/adapters/store/ShownDealsTracker.js'

function makeDeals(ids: string[]) {
  return ids.map(id => ({ id, title: `Produto ${id}` }))
}

describe('ShownDealsTracker', () => {
  let tracker: ShownDealsTracker

  beforeEach(() => {
    tracker = new ShownDealsTracker()
  })

  describe('filterUnseen', () => {
    it('retorna todos os deals quando nenhum foi visto', () => {
      const deals = makeDeals(['a', 'b', 'c'])
      const result = tracker.filterUnseen('decoracao', deals, d => d.id)
      expect(result.map(d => d.id)).toEqual(['a', 'b', 'c'])
    })

    it('exclui deals já vistos', () => {
      const deals = makeDeals(['a', 'b', 'c'])
      tracker.markShown('decoracao', ['a', 'c'])
      const result = tracker.filterUnseen('decoracao', deals, d => d.id)
      expect(result.map(d => d.id)).toEqual(['b'])
    })

    it('não vaza vistos entre categorias diferentes', () => {
      const deals = makeDeals(['a', 'b'])
      tracker.markShown('higiene', ['a'])
      const result = tracker.filterUnseen('decoracao', deals, d => d.id)
      expect(result.map(d => d.id)).toEqual(['a', 'b'])
    })

    it('reexibe deals cujo TTL expirou', () => {
      const deals = makeDeals(['a', 'b'])
      tracker.markShown('decoracao', ['a'])
      // TTL de 0 dias → tudo expirado imediatamente
      const result = tracker.filterUnseen('decoracao', deals, d => d.id, 0)
      expect(result.map(d => d.id)).toEqual(['a', 'b'])
    })

    it('mantém deals dentro do TTL como vistos', () => {
      const deals = makeDeals(['a', 'b'])
      tracker.markShown('decoracao', ['a'])
      // TTL de 99 dias → ainda dentro da janela
      const result = tracker.filterUnseen('decoracao', deals, d => d.id, 99)
      expect(result.map(d => d.id)).toEqual(['b'])
    })
  })

  describe('markShown', () => {
    it('aceita lista vazia sem erro', () => {
      expect(() => tracker.markShown('decoracao', [])).not.toThrow()
    })

    it('marcações acumulam entre chamadas', () => {
      const deals = makeDeals(['a', 'b', 'c'])
      tracker.markShown('decoracao', ['a'])
      tracker.markShown('decoracao', ['b'])
      const result = tracker.filterUnseen('decoracao', deals, d => d.id)
      expect(result.map(d => d.id)).toEqual(['c'])
    })
  })

  describe('resetCategory', () => {
    it('limpa uma categoria específica e retorna contagem removida', () => {
      tracker.markShown('decoracao', ['a', 'b', 'c'])
      tracker.markShown('higiene', ['x'])
      const removed = tracker.resetCategory('decoracao')
      expect(removed).toBe(3)
      // decoracao limpa, higiene intacta
      const dealsHigiene = makeDeals(['x', 'y'])
      const result = tracker.filterUnseen('higiene', dealsHigiene, d => d.id)
      expect(result.map(d => d.id)).toEqual(['y'])
    })

    it('limpa todas as categorias quando chamado sem argumento', () => {
      tracker.markShown('decoracao', ['a', 'b'])
      tracker.markShown('higiene', ['x', 'y', 'z'])
      const removed = tracker.resetCategory()
      expect(removed).toBe(5)
      const deals = makeDeals(['a'])
      expect(tracker.filterUnseen('decoracao', deals, d => d.id)).toEqual(deals)
    })

    it('retorna 0 ao resetar categoria inexistente', () => {
      expect(tracker.resetCategory('categoria-que-nao-existe')).toBe(0)
    })
  })
})
