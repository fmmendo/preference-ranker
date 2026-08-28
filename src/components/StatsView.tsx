import type { Stats } from '../engine/stats'
import type { DatasetLabelSet, RankingScope } from './RankingsView'

export interface StatsCrowdMeta {
  status: 'idle' | 'loading' | 'ready' | 'error'
  users: number
  totalComparisons: number
  onRefresh: () => void
}

interface StatsViewProps {
  /** Stats for the active scope, or null while unavailable/loading. */
  stats: Stats | null
  labels: DatasetLabelSet
  syncEnabled: boolean
  scope: RankingScope
  onScopeChange: (scope: RankingScope) => void
  crowd: StatsCrowdMeta
}

export function StatsView({
  stats,
  labels,
  syncEnabled,
  scope,
  onScopeChange,
  crowd,
}: StatsViewProps) {
  return (
    <div className="flex flex-col gap-4">
      {syncEnabled && (
        <div className="flex justify-center">
          <Segmented
            options={[
              { value: 'you', label: 'You' },
              { value: 'everyone', label: 'Everyone' },
            ]}
            value={scope}
            onChange={(v) => onScopeChange(v as RankingScope)}
          />
        </div>
      )}

      {scope === 'everyone' && syncEnabled ? (
        <CrowdStats stats={stats} labels={labels} crowd={crowd} />
      ) : (
        <StatsBody stats={stats} labels={labels} scope="you" />
      )}
    </div>
  )
}

function CrowdStats({
  stats,
  labels,
  crowd,
}: {
  stats: Stats | null
  labels: DatasetLabelSet
  crowd: StatsCrowdMeta
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-center gap-3 text-xs text-slate-500 dark:text-slate-400">
        {crowd.status === 'ready' && (
          <span>
            {crowd.users} {crowd.users === 1 ? 'person' : 'people'} ·{' '}
            {crowd.totalComparisons} comparisons
          </span>
        )}
        <button
          type="button"
          onClick={crowd.onRefresh}
          className="underline-offset-4 transition hover:text-slate-800 hover:underline dark:hover:text-slate-200"
        >
          Refresh
        </button>
      </div>

      {crowd.status === 'loading' || crowd.status === 'idle' ? (
        <p className="text-center text-slate-500 dark:text-slate-400">
          Loading the crowd’s stats…
        </p>
      ) : crowd.status === 'error' ? (
        <p className="text-center text-slate-500 dark:text-slate-400">
          Couldn’t load the crowd stats. Try Refresh.
        </p>
      ) : (
        <StatsBody stats={stats} labels={labels} scope="everyone" />
      )}
    </div>
  )
}

function StatsBody({
  stats,
  labels,
  scope,
}: {
  stats: Stats | null
  labels: DatasetLabelSet
  scope: RankingScope
}) {
  if (!stats || stats.totalComparisons === 0) {
    return (
      <p className="text-center text-slate-500 dark:text-slate-400">
        {scope === 'everyone'
          ? 'No pooled comparisons yet — stats will appear as the crowd ranks.'
          : 'No comparisons yet — stats will appear as you rank.'}
      </p>
    )
  }

  const pct = (v: number) => `${Math.round(v * 100)}%`

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Tile label="Comparisons" value={stats.totalComparisons.toString()} />
        <Tile
          label={`${labels.itemPlural} covered`}
          value={`${stats.songsCompared}/${stats.totalSongs}`}
          hint={pct(stats.coverage)}
        />
        <Tile label="Mean confidence" value={pct(stats.meanConfidence)} />
        <Tile
          label="Well-ranked"
          value={`${stats.wellRankedCount}/${stats.totalSongs}`}
          hint="≥8 comparisons"
        />
        <Tile
          label="Est. remaining"
          value={stats.estimatedRemaining.toString()}
          hint="to settle all"
        />
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400">
          Confidence distribution
        </h3>
        <ConfidenceHistogram
          buckets={stats.confidenceBuckets}
          total={stats.totalSongs}
        />
      </section>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        {scope === 'everyone'
          ? `Pooled across everyone who has ranked. Confidence rises as ${labels.itemPlural.toLowerCase()} get more comparisons.`
          : `Convergence rises as low-confidence ${labels.itemPlural.toLowerCase()} get surfaced for more comparisons. “Est. remaining” assumes ~8 comparisons per ${labels.item.toLowerCase()}.`}
      </p>
    </div>
  )
}

function Tile({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
        {value}
      </div>
      {hint ? (
        <div className="text-xs text-slate-500 dark:text-slate-400">{hint}</div>
      ) : null}
    </div>
  )
}

function ConfidenceHistogram({
  buckets,
  total,
}: {
  buckets: Stats['confidenceBuckets']
  total: number
}) {
  const max = Math.max(1, ...buckets.map((b) => b.count))
  return (
    <div className="flex flex-col gap-1.5">
      {buckets.map((b) => (
        <div key={b.label} className="flex items-center gap-2 text-xs">
          <span className="w-16 shrink-0 text-right text-slate-500 dark:text-slate-400">
            {b.label}
          </span>
          <div className="h-4 flex-1 overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
            <div
              className="h-full rounded bg-indigo-500"
              style={{ width: `${(b.count / max) * 100}%` }}
            />
          </div>
          <span className="w-8 shrink-0 tabular-nums text-slate-500 dark:text-slate-400">
            {b.count}
          </span>
        </div>
      ))}
      <span className="sr-only">{total} songs total</span>
    </div>
  )
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="inline-flex gap-1 rounded-lg bg-slate-100 p-1 text-sm dark:bg-slate-800">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          aria-current={value === opt.value}
          className={
            'rounded-md px-3 py-1 font-medium transition ' +
            (value === opt.value
              ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-slate-100'
              : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200')
          }
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
