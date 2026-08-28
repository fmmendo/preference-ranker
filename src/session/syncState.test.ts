import { beforeEach, describe, expect, it } from 'vitest'
import {
  getSyncedIds,
  markSynced,
  unmarkSynced,
  clearSynced,
} from './syncState'

describe('syncState', () => {
  const cid = 'muse'

  beforeEach(() => {
    localStorage.clear()
  })

  it('starts empty', () => {
    expect(getSyncedIds(cid).size).toBe(0)
  })

  it('records and reads back synced ids', () => {
    markSynced(cid, ['a', 'b'])
    markSynced(cid, ['b', 'c']) // idempotent on 'b'
    const ids = getSyncedIds(cid)
    expect([...ids].sort()).toEqual(['a', 'b', 'c'])
  })

  it('keeps collections separate', () => {
    markSynced('muse', ['a'])
    markSynced('pizza', ['b'])
    expect([...getSyncedIds('muse')]).toEqual(['a'])
    expect([...getSyncedIds('pizza')]).toEqual(['b'])
  })

  it('unmarks a single id', () => {
    markSynced(cid, ['a', 'b'])
    unmarkSynced(cid, 'a')
    expect([...getSyncedIds(cid)]).toEqual(['b'])
  })

  it('clears everything for a collection', () => {
    markSynced(cid, ['a', 'b'])
    clearSynced(cid)
    expect(getSyncedIds(cid).size).toBe(0)
  })

  it('marking nothing is a no-op', () => {
    markSynced(cid, [])
    expect(getSyncedIds(cid).size).toBe(0)
  })

  it('tolerates corrupt storage', () => {
    localStorage.setItem('ranker:synced:muse', '{not json')
    expect(getSyncedIds(cid).size).toBe(0)
  })
})
