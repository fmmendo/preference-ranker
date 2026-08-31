import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRankingSession } from './session/useRankingSession'
import { CompareView } from './components/CompareView'
import {
  RankingsView,
  type DatasetLabelSet,
  type DefinitiveRow,
  type RankingsMode,
  type RankingScope,
  type GlobalRankingView,
} from './components/RankingsView'
import {
  AlbumsView,
  type AlbumRow,
  type AlbumSort,
  type AlbumTrack,
  type AlbumsGlobalMeta,
} from './components/AlbumsView'
import { StatsView } from './components/StatsView'
import {
  TasteView,
  type TraitDatum,
  type YouVsCrowdDatum,
} from './components/TasteView'
import { fitTraitWeights } from './engine/traits'
import { ThemeToggle } from './components/ThemeToggle'
import { useTheme } from './session/useTheme'
import { useAggregate } from './session/useAggregate'
import { colorFor } from './data/colors'
import { getModel, type ModelResult } from './engine/model'
import { aggregateByGroup, type GroupMember } from './engine/aggregation'
import { computeStats } from './engine/stats'
import { confidenceFromCount } from './engine/elo'
import { loadCollection } from './data/loadCollection'
import { expandTalliesToLog } from './data/cloudSync'
import type { BuiltCollection } from './data/buildCollection'
import type { RankerRepository } from './data/repository'
import type { Group, Id, Item, Rating } from './domain/types'

type Tab = 'compare' | 'rankings' | 'albums' | 'stats' | 'taste'

const ALBUM_TOP_N = 3

interface AppProps {
  /** Injectable for tests/previews; defaults to the Dexie-backed repository. */
  repository?: RankerRepository
  /** Injectable collection; when omitted it is fetched from the dataset URL. */
  collection?: BuiltCollection
}

/** Loads the dataset (unless injected), then renders the app. */
function App({ repository, collection: injected }: AppProps = {}) {
  const [collection, setCollection] = useState<BuiltCollection | null>(
    injected ?? null,
  )
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (injected) return
    let cancelled = false
    loadCollection()
      .then((c) => {
        if (!cancelled) setCollection(c)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [injected])

  if (error) {
    return (
      <main className="mx-auto flex min-h-svh max-w-2xl flex-col items-center justify-center gap-2 px-6 text-center text-slate-900 dark:text-slate-100">
        <h1 className="text-xl font-semibold">Couldn’t load the dataset</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">{error}</p>
      </main>
    )
  }
  if (!collection) {
    return (
      <main className="mx-auto flex min-h-svh max-w-2xl items-center justify-center px-6 text-slate-500 dark:text-slate-400">
        Loading…
      </main>
    )
  }
  return <RankerApp collection={collection} repository={repository} />
}

function RankerApp({
  collection,
  repository,
}: {
  collection: BuiltCollection
  repository?: RankerRepository
}) {
  const session = useRankingSession(collection, repository)
  const { theme, cycle } = useTheme()

  // Elo config for model calls, so Albums "live" scores match the session's.
  const eloConfig = useMemo(
    () => ({
      kFactor: collection.config.eloKFactor,
      initialRating: 1000,
    }),
    [collection.config.eloKFactor],
  )
  const [tab, setTab] = useState<Tab>('compare')
  const [rankMode, setRankMode] = useState<RankingsMode>('live')
  const [rankScope, setRankScope] = useState<RankingScope>('you')
  const [albumMode, setAlbumMode] = useState<RankingsMode>('live')
  const [albumScope, setAlbumScope] = useState<RankingScope>('you')
  const [albumSort, setAlbumSort] = useState<AlbumSort>('mean')
  const [includeBonus, setIncludeBonus] = useState(false)
  const [statsScope, setStatsScope] = useState<RankingScope>('you')

  // Crowd aggregate, fetched only while an "Everyone" view is showing.
  const aggregate = useAggregate(
    session.cloud,
    (tab === 'rankings' && rankScope === 'everyone') ||
      (tab === 'albums' && albumScope === 'everyone') ||
      (tab === 'stats' && statsScope === 'everyone') ||
      tab === 'taste',
  )

  const groupById = useMemo(
    () => new Map(collection.groups.map((g) => [g.id, g])),
    [collection.groups],
  )

  const meta = collection.collection
  const labels: DatasetLabelSet = useMemo(() => {
    const plural = (singular: string | undefined, fallback: string) =>
      singular ? `${singular}s` : fallback
    return {
      group: meta.groupLabel ?? 'Group',
      groupPlural: meta.groupLabelPlural ?? plural(meta.groupLabel, 'Groups'),
      item: meta.itemLabel ?? 'Item',
      itemPlural: meta.itemLabelPlural ?? plural(meta.itemLabel, 'Items'),
    }
  }, [meta])

  const hasBonus = useMemo(
    () => collection.items.some((i) => i.metadata?.isBonus === true),
    [collection.items],
  )

  // Interludes are ranked nowhere (comparisons, song leaderboard, album score);
  // they only appear as greyed rows in the album track list.
  const rankableItemIds = useMemo(
    () =>
      collection.items
        .filter((i) => i.metadata?.isInterlude !== true)
        .map((i) => i.id),
    [collection.items],
  )

  // Trait tags (metadata.tags) power the Taste tab's attribute analysis.
  const tagsById = useMemo(() => {
    const m = new Map<Id, string[]>()
    for (const i of collection.items) {
      const t = i.metadata?.tags
      if (Array.isArray(t) && t.length) m.set(i.id, t.map(String))
    }
    return m
  }, [collection.items])
  const tagVocab = useMemo(() => {
    const s = new Set<string>()
    for (const tags of tagsById.values()) for (const t of tags) s.add(t)
    return [...s]
  }, [tagsById])
  const hasTags = tagsById.size > 0
  const interludeItems = useMemo(
    () => collection.items.filter((i) => i.metadata?.isInterlude === true),
    [collection.items],
  )

  const groupOf = (item: Item): Group | undefined =>
    item.groupId ? groupById.get(item.groupId) : undefined

  const compareLabel = (item: Item): string => {
    const group = groupOf(item)
    if (!group) return ''
    const year = group.metadata?.year
    return year ? `${group.name} · ${year}` : group.name
  }

  const colorOf = (item: Item): string => {
    const group = groupOf(item)
    return group ? colorFor(group.name, group.color) : colorFor('')
  }

  // Turn model results into ranked definitive rows (used by both the personal
  // and the crowd Bradley-Terry rankings).
  const toDefinitiveRows = useCallback(
    (results: ModelResult[]): DefinitiveRow[] => {
      const rated = results
        .filter((r) => r.comparisonCount > 0)
        .sort((a, b) => b.score - a.score)
      return rated.map((r, idx) => {
        const item = session.itemsById.get(r.itemId)!
        const group = item.groupId ? groupById.get(item.groupId) : undefined
        const interval = r.interval95 ?? 0
        const prev = idx > 0 ? rated[idx - 1] : null
        const tie = prev
          ? prev.score - (prev.interval95 ?? 0) <= r.score + interval
          : false
        return {
          rank: idx + 1,
          item,
          groupName: group?.name ?? '',
          groupColor: group ? colorFor(group.name, group.color) : colorFor(''),
          score: r.score,
          interval,
          comparisonCount: r.comparisonCount,
          tie,
        }
      })
    },
    [session.itemsById, groupById],
  )

  // Personal Bradley-Terry ranking (only while the definitive view shows).
  const definitive = useMemo(() => {
    if (rankMode !== 'definitive' || rankScope !== 'you') {
      return { rows: [] as DefinitiveRow[], unranked: 0 }
    }
    const results = getModel('bradley-terry').rank(
      rankableItemIds,
      session.comparisons,
    )
    const rows = toDefinitiveRows(results)
    return { rows, unranked: rankableItemIds.length - rows.length }
  }, [
    rankMode,
    rankScope,
    toDefinitiveRows,
    rankableItemIds,
    session.comparisons,
  ])

  // Crowd Bradley-Terry results (per song) from the pooled aggregate tallies —
  // shared by the Rankings and Albums "Everyone" views.
  const crowdResults = useMemo<ModelResult[]>(() => {
    if (aggregate.status !== 'ready' || !aggregate.data) return []
    const log = expandTalliesToLog(aggregate.data.pairs)
    return getModel('bradley-terry').rank(rankableItemIds, log)
  }, [aggregate.status, aggregate.data, rankableItemIds])

  const crowdTotalComparisons = aggregate.data
    ? aggregate.data.pairs.reduce((s, p) => s + p.aWins + p.bWins, 0)
    : 0

  // Taste tab: crowd trait part-worths (feature-Bradley-Terry over the pooled
  // log), and the current user's ranking vs the crowd's, per song.
  const traitResults = useMemo<TraitDatum[]>(() => {
    if (tab !== 'taste' || aggregate.status !== 'ready' || !aggregate.data)
      return []
    const log = expandTalliesToLog(aggregate.data.pairs)
    return fitTraitWeights(tagsById, tagVocab, log)
  }, [tab, aggregate.status, aggregate.data, tagsById, tagVocab])

  const youVsCrowd = useMemo<YouVsCrowdDatum[]>(() => {
    if (tab !== 'taste' || crowdResults.length === 0) return []
    const personal = getModel('bradley-terry').rank(
      rankableItemIds,
      session.comparisons,
    )
    const crowdById = new Map(crowdResults.map((r) => [r.itemId, r]))
    return personal
      .filter((r) => r.comparisonCount > 0 && crowdById.has(r.itemId))
      .map((r) => {
        const item = session.itemsById.get(r.itemId)!
        const group = item.groupId ? groupById.get(item.groupId) : undefined
        return {
          itemId: r.itemId,
          name: item.name,
          album: group?.name ?? '',
          color: group ? colorFor(group.name, group.color) : colorFor(''),
          you: Math.round(r.score),
          crowd: Math.round(crowdById.get(r.itemId)!.score),
        }
      })
  }, [
    tab,
    crowdResults,
    rankableItemIds,
    session.comparisons,
    session.itemsById,
    groupById,
  ])

  const globalRows = useMemo<DefinitiveRow[]>(
    () => toDefinitiveRows(crowdResults),
    [crowdResults, toDefinitiveRows],
  )

  const globalView: GlobalRankingView = {
    status: aggregate.status,
    rows: globalRows,
    users: aggregate.data?.users ?? 0,
    totalComparisons: crowdTotalComparisons,
    onRefresh: aggregate.refresh,
  }

  // Build album rows + per-group ranked tracks from a set of per-song results.
  const buildAlbums = useCallback(
    (results: ModelResult[]) => {
      const members: GroupMember[] = []
      const trackLists = new Map<string, AlbumTrack[]>()
      for (const r of results) {
        const item = session.itemsById.get(r.itemId)!
        const gid = item.groupId ?? ''
        const isBonus = item.metadata?.isBonus === true
        members.push({
          groupId: gid,
          score: r.score,
          interval95: r.interval95,
          excluded: !includeBonus && isBonus,
        })
        const list = trackLists.get(gid) ?? []
        list.push({
          rank: 0,
          itemId: r.itemId,
          name: item.name,
          score: r.score,
          isBonus,
          comparisonCount: r.comparisonCount,
        })
        trackLists.set(gid, list)
      }

      const tracksByGroup = new Map<string, AlbumTrack[]>()
      for (const [gid, list] of trackLists) {
        list.sort((a, b) => b.score - a.score)
        tracksByGroup.set(
          gid,
          list.map((t, i) => ({ ...t, rank: i + 1 })),
        )
      }

      // Interludes aren't scored or ranked, but still list them (greyed) at the
      // foot of their album so the tracklist reads complete.
      for (const item of interludeItems) {
        const gid = item.groupId ?? ''
        const list = tracksByGroup.get(gid) ?? []
        list.push({
          rank: 0,
          itemId: item.id,
          name: item.name,
          score: 0,
          isBonus: false,
          isInterlude: true,
          comparisonCount: 0,
        })
        tracksByGroup.set(gid, list)
      }

      const rows = aggregateByGroup(members, ALBUM_TOP_N).map((g) => {
        const group = groupById.get(g.groupId)
        return {
          groupId: g.groupId,
          name: group?.name ?? '',
          color: group ? colorFor(group.name, group.color) : colorFor(''),
          year: group?.metadata?.year as number | undefined,
          meanScore: g.mean.score,
          meanInterval: g.mean.interval95,
          topNScore: g.topN.score,
          topNInterval: g.topN.interval95,
          songCount: g.mean.count,
        }
      })

      const key = albumSort === 'mean' ? 'meanScore' : 'topNScore'
      rows.sort((a, b) => b[key] - a[key])
      return {
        rows: rows.map((r, i) => ({ ...r, rank: i + 1 })),
        tracksByGroup,
      }
    },
    [session.itemsById, groupById, includeBonus, albumSort, interludeItems],
  )

  // Album view for the active scope (only on the Albums tab).
  const albums = useMemo(() => {
    const empty = {
      rows: [] as AlbumRow[],
      tracksByGroup: new Map<string, AlbumTrack[]>(),
    }
    if (tab !== 'albums') return empty
    if (albumScope === 'everyone') return buildAlbums(crowdResults)

    const model = albumMode === 'definitive' ? 'bradley-terry' : 'elo'
    const results = getModel(model).rank(
      rankableItemIds,
      session.comparisons,
      eloConfig,
    )
    return buildAlbums(results)
  }, [
    tab,
    albumScope,
    albumMode,
    buildAlbums,
    crowdResults,
    rankableItemIds,
    session.comparisons,
    eloConfig,
  ])

  const albumsGlobal: AlbumsGlobalMeta = {
    status: aggregate.status,
    users: aggregate.data?.users ?? 0,
    totalComparisons: crowdTotalComparisons,
    onRefresh: aggregate.refresh,
  }

  const stats = useMemo(() => {
    if (tab !== 'stats' || statsScope !== 'you') return null
    return computeStats(
      session.ranking.map((row) => row.rating),
      session.totalComparisons,
    )
  }, [tab, statsScope, session.ranking, session.totalComparisons])

  // Crowd-wide stats, from the pooled tallies. Confidence is the same count
  // proxy as the personal view, so the two scopes are directly comparable.
  const crowdStats = useMemo(() => {
    if (tab !== 'stats' || statsScope !== 'everyone') return null
    if (aggregate.status !== 'ready') return null
    const ratings: Rating[] = crowdResults.map((r) => ({
      itemId: r.itemId,
      score: r.score,
      confidence: confidenceFromCount(r.comparisonCount),
      wins: 0,
      losses: 0,
      comparisonCount: r.comparisonCount,
      lastUpdated: '',
    }))
    return computeStats(ratings, crowdTotalComparisons)
  }, [tab, statsScope, aggregate.status, crowdResults, crowdTotalComparisons])

  const comparisonLabel = `${session.totalComparisons} comparison${
    session.totalComparisons === 1 ? '' : 's'
  }`

  const handleReset = () => {
    if (
      window.confirm(
        `Clear all ${session.totalComparisons} comparisons for ${meta.name}? This cannot be undone.`,
      )
    ) {
      session.reset()
    }
  }

  return (
    <main className="mx-auto flex min-h-svh max-w-2xl flex-col gap-8 px-6 py-10 text-slate-900 dark:text-slate-100">
      <header className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">
            Preference Ranker
          </h1>
          <div className="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
            <span>
              {meta.name} · {comparisonLabel}
            </span>
            {session.totalComparisons > 0 && (
              <button
                type="button"
                onClick={handleReset}
                className="underline-offset-4 transition hover:text-rose-500 hover:underline"
              >
                Reset
              </button>
            )}
            <ThemeToggle theme={theme} onCycle={cycle} />
          </div>
        </div>

        <nav className="flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
          <TabButton
            active={tab === 'compare'}
            onClick={() => setTab('compare')}
          >
            Compare
          </TabButton>
          <TabButton
            active={tab === 'rankings'}
            onClick={() => setTab('rankings')}
          >
            Rankings
          </TabButton>
          <TabButton active={tab === 'albums'} onClick={() => setTab('albums')}>
            {labels.groupPlural}
          </TabButton>
          <TabButton active={tab === 'stats'} onClick={() => setTab('stats')}>
            Stats
          </TabButton>
          {session.cloud && hasTags && (
            <TabButton active={tab === 'taste'} onClick={() => setTab('taste')}>
              Taste
            </TabButton>
          )}
        </nav>
      </header>

      {!session.loaded ? (
        <p className="text-center text-slate-500 dark:text-slate-400">
          Loading…
        </p>
      ) : tab === 'compare' ? (
        <CompareView
          pair={session.pair}
          onChoose={session.choose}
          onSkip={session.skip}
          onUndo={session.undo}
          canUndo={session.canUndo}
          albumLabel={compareLabel}
          albumColor={colorOf}
        />
      ) : tab === 'rankings' ? (
        <RankingsView
          syncEnabled={session.cloud !== null}
          scope={rankScope}
          onScopeChange={setRankScope}
          mode={rankMode}
          onModeChange={setRankMode}
          liveRanking={session.ranking}
          definitiveRanking={definitive.rows}
          unrankedCount={definitive.unranked}
          totalComparisons={session.totalComparisons}
          labels={labels}
          global={globalView}
        />
      ) : tab === 'albums' ? (
        <AlbumsView
          syncEnabled={session.cloud !== null}
          scope={albumScope}
          onScopeChange={setAlbumScope}
          mode={albumMode}
          onModeChange={setAlbumMode}
          includeBonus={includeBonus}
          onIncludeBonusChange={setIncludeBonus}
          showBonusToggle={hasBonus}
          sortBy={albumSort}
          onSortChange={setAlbumSort}
          topN={ALBUM_TOP_N}
          albums={albums.rows}
          tracksByGroup={albums.tracksByGroup}
          totalComparisons={session.totalComparisons}
          labels={labels}
          global={albumsGlobal}
        />
      ) : tab === 'stats' ? (
        <StatsView
          syncEnabled={session.cloud !== null}
          scope={statsScope}
          onScopeChange={setStatsScope}
          stats={statsScope === 'everyone' ? crowdStats : stats}
          labels={labels}
          crowd={{
            status: aggregate.status,
            users: aggregate.data?.users ?? 0,
            totalComparisons: crowdTotalComparisons,
            onRefresh: aggregate.refresh,
          }}
        />
      ) : (
        <TasteView
          hasTags={hasTags}
          crowd={{
            status: aggregate.status,
            users: aggregate.data?.users ?? 0,
            totalComparisons: crowdTotalComparisons,
            onRefresh: aggregate.refresh,
          }}
          traits={traitResults}
          youVsCrowd={youVsCrowd}
          personalCount={session.totalComparisons}
          labels={labels}
        />
      )}

      {session.cloud && (
        <footer className="mt-auto pt-4 text-center text-xs text-slate-400">
          Anonymous &amp; account-free — a random id is kept in your browser and
          your comparisons are pooled to build a shared ranking. No personal
          data.
        </footer>
      )}
    </main>
  )
}

interface TabButtonProps {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}

function TabButton({ active, onClick, children }: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active}
      className={
        'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ' +
        (active
          ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-slate-100'
          : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200')
      }
    >
      {children}
    </button>
  )
}

export default App
