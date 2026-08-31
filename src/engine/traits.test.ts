import { describe, it, expect } from 'vitest'
import { fitTraitWeights, type TraitWeight } from './traits'
import type { Comparison, Id } from '../domain/types'

function cmp(a: Id, b: Id, winner: Id): Comparison {
  return {
    id: `${a}-${b}-${winner}`,
    collectionId: 'c',
    itemAId: a,
    itemBId: b,
    winnerId: winner,
    timestamp: '',
  }
}

describe('fitTraitWeights', () => {
  const tagsById = new Map<Id, readonly string[]>([
    ['h1', ['heavy']],
    ['h2', ['heavy']],
    ['p1', ['pop']],
    ['p2', ['pop']],
  ])
  const vocab = ['heavy', 'pop']

  it('learns that the consistently-winning trait is positive and significant', () => {
    // heavy always beats pop, many times
    const comps: Comparison[] = []
    for (let i = 0; i < 60; i++) {
      comps.push(cmp('h1', 'p1', 'h1'), cmp('h2', 'p2', 'h2'), cmp('h1', 'p2', 'h1'))
    }
    const w = fitTraitWeights(tagsById, vocab, comps)
    const heavy = w.find((x) => x.tag === 'heavy') as TraitWeight
    const pop = w.find((x) => x.tag === 'pop') as TraitWeight
    expect(heavy.weight).toBeGreaterThan(0)
    expect(pop.weight).toBeLessThan(0)
    expect(heavy.weight).toBeGreaterThan(pop.weight)
    // significant: 95% interval excludes zero
    expect(heavy.weight - 1.96 * heavy.se).toBeGreaterThan(0)
    // sorted strongest-first
    expect(w[0].tag).toBe('heavy')
    // item counts
    expect(heavy.n).toBe(2)
    expect(pop.n).toBe(2)
  })

  it('gives ~zero weight with wide error when a trait never decides an outcome', () => {
    // 50/50 outcomes → no trait advantage
    const comps: Comparison[] = []
    for (let i = 0; i < 40; i++) {
      comps.push(cmp('h1', 'p1', i % 2 ? 'h1' : 'p1'))
      comps.push(cmp('h2', 'p2', i % 2 ? 'p2' : 'h2'))
    }
    const w = fitTraitWeights(tagsById, vocab, comps)
    const heavy = w.find((x) => x.tag === 'heavy') as TraitWeight
    // interval should straddle zero (not distinguishable from average)
    expect(heavy.weight - 1.96 * heavy.se).toBeLessThan(0)
    expect(heavy.weight + 1.96 * heavy.se).toBeGreaterThan(0)
  })

  it('skips comparisons referencing untagged items and returns empty vocab safely', () => {
    expect(fitTraitWeights(tagsById, [], [])).toEqual([])
    const w = fitTraitWeights(tagsById, vocab, [cmp('h1', 'unknown', 'h1')])
    // the only comparison references an untagged item → no rows → zeroed
    expect(w.every((x) => x.weight === 0)).toBe(true)
  })
})
