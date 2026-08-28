import { useCallback, useEffect, useMemo, useState } from 'react'
import type { BuiltCollection } from '../data/buildCollection'
import type { Comparison, Id, Item } from '../domain/types'
import { DEFAULT_ELO_CONFIG, type EloConfig } from '../engine/elo'
import { generateRanking, type RankedItem } from '../engine/ranking'
import { randomPair, selectPair, recentPairKeys } from '../engine/pairSelection'
import { replayComparisons } from '../engine/replay'
import { defaultRepository, type RankerRepository } from '../data/repository'
import { colorFor } from '../data/colors'
import { getUserId } from './identity'
import { createCloudSync, type CloudSync } from '../data/cloudSync'
import {
  getSyncedIds,
  markSynced,
  unmarkSynced,
  clearSynced,
} from './syncState'

export interface RankedRow extends RankedItem {
  item: Item
  groupName: string
  groupColor: string
}

export interface RankingSession {
  /** The two items currently up for comparison. */
  pair: [Item, Item]
  /** Record that `winner` beat `loser`, then advance to a new pair. */
  choose: (winnerId: Id, loserId: Id) => void
  /** Skip the current pair without recording a result. */
  skip: () => void
  /** Undo the most recent choice and bring that pair back up. */
  undo: () => void
  canUndo: boolean
  /** Clear all comparisons for this collection. */
  reset: () => void
  /** True once persisted comparisons have been loaded from storage. */
  loaded: boolean
  /** Full leaderboard, best first, joined with item + album details. */
  ranking: RankedRow[]
  totalComparisons: number
  itemsById: Map<Id, Item>
  /** The raw comparison log (for on-demand Bradley-Terry fitting). */
  comparisons: readonly Comparison[]
  /** Cloud sync client when multi-user is configured, else null. */
  cloud: CloudSync | null
}

/**
 * Ranking session over a built collection, persisted through a repository.
 * Ratings are derived by replaying the comparison log, so state is always a pure
 * function of that log — which makes undo, reset and load-from-storage trivially
 * correct. Only the log is persisted; ratings are recomputed.
 */
export function useRankingSession(
  collection: BuiltCollection,
  repository?: RankerRepository,
): RankingSession {
  const repo = useMemo(() => repository ?? defaultRepository(), [repository])
  const seedDate = collection.collection.createdDate
  const collectionId = collection.collection.id

  // Cloud sync is on only when the dataset config sets a syncUrl.
  const syncUrl = collection.config.syncUrl
  const cloud = useMemo<CloudSync | null>(
    () =>
      syncUrl
        ? createCloudSync({
            baseUrl: syncUrl,
            collectionId,
            userId: getUserId(),
          })
        : null,
    [syncUrl, collectionId],
  )
  // Ranking behaviour comes from the dataset's resolved config (operator-set).
  const weights = collection.config.pairWeights
  const avoidWindow = collection.config.avoidWindow
  const config: EloConfig = useMemo(
    () => ({
      kFactor: collection.config.eloKFactor,
      initialRating: DEFAULT_ELO_CONFIG.initialRating,
    }),
    [collection.config.eloKFactor],
  )

  const itemsById = useMemo(
    () => new Map(collection.items.map((i) => [i.id, i])),
    [collection.items],
  )
  const groupById = useMemo(
    () => new Map(collection.groups.map((g) => [g.id, g])),
    [collection.groups],
  )
  const itemIds = useMemo(
    () => collection.items.map((i) => i.id),
    [collection.items],
  )

  const [comparisons, setComparisons] = useState<Comparison[]>([])
  const [loaded, setLoaded] = useState(false)
  const [pair, setPair] = useState<[Item, Item]>(() =>
    randomPair(collection.items),
  )

  // Seed static data on first run, then hydrate the comparison log.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      await repo.ensureSeeded(collection)
      const stored = await repo.getComparisons(collectionId)
      if (!cancelled) {
        setComparisons(stored)
        // Reconcile with the cloud, but only push comparisons we haven't
        // already synced — otherwise every page load re-sends the whole log
        // (one no-op INSERT OR IGNORE per row). markSynced records success so
        // a failed push is retried next load.
        if (cloud && stored.length > 0) {
          const synced = getSyncedIds(collectionId)
          const unsynced = stored.filter((c) => !synced.has(c.id))
          if (unsynced.length > 0) {
            void cloud
              .pushComparisons(unsynced)
              .then(() => markSynced(collectionId, unsynced.map((c) => c.id)))
              .catch(() => {})
          }
        }
        if (stored.length > 0) {
          // Pick a smart first pair based on the restored history.
          const restored = replayComparisons(itemIds, stored, seedDate, config)
          setPair(
            selectPair({
              items: collection.items,
              ratings: restored,
              comparisons: stored,
              weights,
              avoidPairKeys: recentPairKeys(stored, avoidWindow),
            }),
          )
        }
        setLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [
    repo,
    collection,
    collectionId,
    itemIds,
    seedDate,
    config,
    weights,
    avoidWindow,
    cloud,
  ])

  const ratings = useMemo(
    () => replayComparisons(itemIds, comparisons, seedDate, config),
    [itemIds, comparisons, seedDate, config],
  )

  const choose = useCallback(
    (winnerId: Id, loserId: Id) => {
      void loserId // loser is derived from the pair when replaying
      const comparison: Comparison = {
        id: crypto.randomUUID(),
        collectionId,
        itemAId: pair[0].id,
        itemBId: pair[1].id,
        winnerId,
        timestamp: new Date().toISOString(),
      }
      const nextComparisons = [...comparisons, comparison]
      const nextRatings = replayComparisons(
        itemIds,
        nextComparisons,
        seedDate,
        config,
      )
      setComparisons(nextComparisons)
      setPair(
        selectPair({
          items: collection.items,
          ratings: nextRatings,
          comparisons: nextComparisons,
          weights,
          avoidPairKeys: recentPairKeys(nextComparisons, avoidWindow),
        }),
      )
      void repo.addComparison(comparison)
      if (cloud)
        void cloud
          .pushComparisons([comparison])
          .then(() => markSynced(collectionId, [comparison.id]))
          .catch(() => {})
    },
    [
      collectionId,
      collection.items,
      comparisons,
      itemIds,
      seedDate,
      config,
      weights,
      avoidWindow,
      pair,
      repo,
      cloud,
    ],
  )

  const skip = useCallback(() => {
    setPair(
      selectPair({
        items: collection.items,
        ratings,
        comparisons,
        weights,
        avoidPairKeys: recentPairKeys(comparisons, avoidWindow),
      }),
    )
  }, [collection.items, ratings, comparisons, weights, avoidWindow])

  const undo = useCallback(() => {
    if (comparisons.length === 0) return
    const last = comparisons[comparisons.length - 1]
    const a = itemsById.get(last.itemAId)
    const b = itemsById.get(last.itemBId)
    if (a && b) setPair([a, b]) // bring the undone pair back up to redo
    setComparisons((prev) => prev.slice(0, -1))
    void repo.deleteComparison(last.id)
    unmarkSynced(collectionId, last.id)
    if (cloud) void cloud.deleteComparison(last.id).catch(() => {})
  }, [comparisons, itemsById, repo, cloud, collectionId])

  const reset = useCallback(() => {
    setComparisons([])
    setPair(randomPair(collection.items))
    void repo.clearComparisons(collectionId)
    clearSynced(collectionId)
    if (cloud) void cloud.reset().catch(() => {})
  }, [collection.items, collectionId, repo, cloud])

  const ranking = useMemo<RankedRow[]>(() => {
    return generateRanking([...ratings.values()]).map((ranked) => {
      const item = itemsById.get(ranked.rating.itemId)!
      const group = item.groupId ? groupById.get(item.groupId) : undefined
      return {
        ...ranked,
        item,
        groupName: group?.name ?? '',
        groupColor: group ? colorFor(group.name, group.color) : colorFor(''),
      }
    })
  }, [ratings, itemsById, groupById])

  return {
    pair,
    choose,
    skip,
    undo,
    canUndo: comparisons.length > 0,
    reset,
    loaded,
    ranking,
    totalComparisons: comparisons.length,
    itemsById,
    comparisons,
    cloud,
  }
}
