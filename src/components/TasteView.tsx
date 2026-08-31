import type { DatasetLabelSet } from './RankingsView'

export interface TraitDatum {
  tag: string
  weight: number
  se: number
  n: number
}

export interface YouVsCrowdDatum {
  itemId: string
  name: string
  album: string
  color: string
  you: number
  crowd: number
}

export interface TasteCrowdMeta {
  status: 'idle' | 'loading' | 'ready' | 'error'
  users: number
  totalComparisons: number
  onRefresh: () => void
}

interface TasteViewProps {
  hasTags: boolean
  crowd: TasteCrowdMeta
  traits: TraitDatum[]
  youVsCrowd: YouVsCrowdDatum[]
  personalCount: number
  labels: DatasetLabelSet
}

/** Minimum personal comparisons before the "you vs crowd" panel is meaningful. */
const YOU_MIN = 12

export function TasteView({
  hasTags,
  crowd,
  traits,
  youVsCrowd,
  personalCount,
  labels,
}: TasteViewProps) {
  if (!hasTags) {
    return (
      <p className="text-center text-slate-500 dark:text-slate-400">
        This dataset has no traits tagged, so there’s nothing to analyse here.
      </p>
    )
  }
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

      <TraitPanel status={crowd.status} traits={traits} labels={labels} />
      <YouPanel
        status={crowd.status}
        data={youVsCrowd}
        personalCount={personalCount}
        labels={labels}
      />
    </div>
  )
}

// ---------- What the crowd rewards (trait part-worths, forest plot) ----------
function TraitPanel({
  status,
  traits,
  labels,
}: {
  status: TasteCrowdMeta['status']
  traits: TraitDatum[]
  labels: DatasetLabelSet
}) {
  return (
    <section className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
        What the crowd rewards
      </h3>
      <p className="mt-1 mb-3 text-xs text-slate-500 dark:text-slate-400">
        How much each trait adds to winning a head-to-head (controlling for a{' '}
        {labels.item.toLowerCase()}’s other traits). Whiskers are 95% intervals;
        grey traits cross zero — no clear effect.
      </p>
      {status !== 'ready' ? (
        <StatusLine status={status} what="the crowd’s traits" />
      ) : traits.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Not enough pooled data yet.
        </p>
      ) : (
        <ForestPlot traits={traits} />
      )}
    </section>
  )
}

function ForestPlot({ traits }: { traits: TraitDatum[] }) {
  const rows = [...traits].sort((a, b) => b.weight - a.weight)
  const ci = (t: TraitDatum) => 1.96 * t.se
  const xmin = Math.min(0, ...rows.map((t) => t.weight - ci(t))) - 0.03
  const xmax = Math.max(0, ...rows.map((t) => t.weight + ci(t))) + 0.03
  const W = 680
  const rowH = 22
  const top = 6
  const bottom = 26
  const left = 86
  const right = 30
  const H = top + rows.length * rowH + bottom
  const sx = (v: number) =>
    left + ((v - xmin) / (xmax - xmin)) * (W - left - right)
  const x0 = sx(0)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      <line
        x1={x0}
        y1={top - 2}
        x2={x0}
        y2={top + rows.length * rowH + 2}
        className="stroke-slate-300 dark:stroke-slate-600"
        strokeDasharray="3 3"
      />
      {rows.map((t, i) => {
        const y = top + i * rowH + rowH / 2
        const lo = t.weight - ci(t)
        const hi = t.weight + ci(t)
        const sig = lo > 0 || hi < 0
        const cls = !sig
          ? 'fill-slate-400 stroke-slate-400 dark:fill-slate-500 dark:stroke-slate-500'
          : t.weight > 0
            ? 'fill-emerald-600 stroke-emerald-600 dark:fill-emerald-400 dark:stroke-emerald-400'
            : 'fill-rose-600 stroke-rose-600 dark:fill-rose-500 dark:stroke-rose-500'
        return (
          <g key={t.tag} className={cls}>
            <text
              x={left - 9}
              y={y + 3.5}
              textAnchor="end"
              className="fill-slate-700 text-[11.5px] font-semibold dark:fill-slate-200"
              opacity={sig ? 1 : 0.75}
            >
              {t.tag}
            </text>
            <line
              x1={sx(lo)}
              y1={y}
              x2={sx(hi)}
              y2={y}
              strokeWidth={2}
              opacity={0.5}
            />
            <line x1={sx(lo)} y1={y - 3} x2={sx(lo)} y2={y + 3} strokeWidth={1.4} />
            <line x1={sx(hi)} y1={y - 3} x2={sx(hi)} y2={y + 3} strokeWidth={1.4} />
            <circle cx={sx(t.weight)} cy={y} r={3.6} strokeWidth={0} />
            <text
              x={W - right + 7}
              y={y + 3.5}
              className="fill-slate-400 text-[10px]"
            >
              {t.n}
            </text>
          </g>
        )
      })}
      <text
        x={W - right + 7}
        y={top - 1}
        className="fill-slate-400 text-[10px]"
      >
        n
      </text>
      <text x={left} y={H - 8} className="fill-slate-400 text-[11px]">
        ← loses
      </text>
      <text
        x={W - right}
        y={H - 8}
        textAnchor="end"
        className="fill-slate-400 text-[11px]"
      >
        wins →
      </text>
    </svg>
  )
}

// ---------- You vs the crowd (scatter + hot takes) ----------
function YouPanel({
  status,
  data,
  personalCount,
  labels,
}: {
  status: TasteCrowdMeta['status']
  data: YouVsCrowdDatum[]
  personalCount: number
  labels: DatasetLabelSet
}) {
  return (
    <section className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
        You vs. the crowd
      </h3>
      <p className="mt-1 mb-3 text-xs text-slate-500 dark:text-slate-400">
        Each dot is a {labels.item.toLowerCase()}: crowd score across, your score
        up. On the line you agree; above it you rate it higher than everyone,
        below it lower.
      </p>
      {personalCount < YOU_MIN ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Rank a few more — you’ve made {personalCount} comparison
          {personalCount === 1 ? '' : 's'}; this needs about {YOU_MIN} to place
          you against the crowd.
        </p>
      ) : status !== 'ready' ? (
        <StatusLine status={status} what="the crowd" />
      ) : data.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          No overlap with the crowd yet.
        </p>
      ) : (
        <>
          <YouScatter data={data} />
          <HotTakes data={data} labels={labels} />
        </>
      )}
    </section>
  )
}

function YouScatter({ data }: { data: YouVsCrowdDatum[] }) {
  const xs = data.map((d) => d.crowd)
  const ys = data.map((d) => d.you)
  const lo = Math.min(...xs, ...ys)
  const hi = Math.max(...xs, ...ys)
  const pad = (hi - lo) * 0.04 || 10
  const [Lo, Hi] = [lo - pad, hi + pad]
  const W = 680
  const H = 380
  const m = { l: 44, r: 14, t: 12, b: 34 }
  const sx = (v: number) => m.l + ((v - Lo) / (Hi - Lo)) * (W - m.l - m.r)
  const sy = (v: number) => H - m.b - ((v - Lo) / (Hi - Lo)) * (H - m.t - m.b)
  const hot = [...data]
    .sort((a, b) => Math.abs(b.you - b.crowd) - Math.abs(a.you - a.crowd))
    .slice(0, 5)
  const hotset = new Set(hot.map((h) => h.itemId))
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      <line
        x1={sx(Lo)}
        y1={sy(Lo)}
        x2={sx(Hi)}
        y2={sy(Hi)}
        className="stroke-slate-300 dark:stroke-slate-600"
        strokeDasharray="5 4"
        strokeWidth={1.4}
      />
      {data.map((d) => {
        const big = hotset.has(d.itemId)
        return (
          <circle
            key={d.itemId}
            cx={sx(d.crowd)}
            cy={sy(d.you)}
            r={big ? 5.5 : 4}
            fill={d.color}
            fillOpacity={big ? 0.95 : 0.5}
            stroke={d.color}
            strokeWidth={big ? 1.2 : 0.5}
          >
            <title>
              {d.name} · {d.album} · you {d.you} vs crowd {d.crowd}
            </title>
          </circle>
        )
      })}
      {hot.map((d) => (
        <text
          key={d.itemId}
          x={sx(d.crowd) + 7}
          y={sy(d.you) + (d.you > d.crowd ? -6 : 12)}
          className="fill-slate-700 text-[10.5px] font-semibold dark:fill-slate-200"
        >
          {d.name}
        </text>
      ))}
      <text
        x={(m.l + (W - m.r)) / 2}
        y={H - 6}
        textAnchor="middle"
        className="fill-slate-500 text-[11px] font-medium dark:fill-slate-400"
      >
        crowd score →
      </text>
      <text
        transform={`translate(12,${(m.t + (H - m.b)) / 2}) rotate(-90)`}
        textAnchor="middle"
        className="fill-slate-500 text-[11px] font-medium dark:fill-slate-400"
      >
        your score →
      </text>
    </svg>
  )
}

function HotTakes({
  data,
  labels,
}: {
  data: YouVsCrowdDatum[]
  labels: DatasetLabelSet
}) {
  const hot = [...data]
    .map((d) => ({ ...d, delta: d.you - d.crowd }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 6)
  const max = Math.max(...hot.map((h) => Math.abs(h.delta)), 1)
  return (
    <div className="mt-4">
      <h4 className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">
        Your hot takes — where you most disagree with the crowd
      </h4>
      <div className="flex flex-col gap-1.5">
        {hot.map((h) => (
          <div
            key={h.itemId}
            className="grid grid-cols-[auto_140px_1fr_46px] items-center gap-2 text-sm"
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: h.color }}
            />
            <span className="truncate text-right text-slate-700 dark:text-slate-200">
              {h.name}
            </span>
            <span className="relative h-4">
              <span className="absolute inset-y-0 left-1/2 w-px bg-slate-300 dark:bg-slate-600" />
              <span
                className="absolute inset-y-0.5 block rounded"
                style={{
                  [h.delta > 0 ? 'left' : 'right']: '50%',
                  width: `${(Math.abs(h.delta) / max) * 50}%`,
                  backgroundColor: h.delta > 0 ? '#12a150' : '#e5484d',
                }}
              />
            </span>
            <span
              className={
                'text-right font-semibold tabular-nums ' +
                (h.delta > 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-rose-600 dark:text-rose-400')
              }
            >
              {h.delta > 0 ? '+' : ''}
              {h.delta}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-slate-400">
        Higher = you rate the {labels.item.toLowerCase()} above the crowd; lower =
        below.
      </p>
    </div>
  )
}

function StatusLine({
  status,
  what,
}: {
  status: TasteCrowdMeta['status']
  what: string
}) {
  return (
    <p className="text-sm text-slate-500 dark:text-slate-400">
      {status === 'error'
        ? `Couldn’t load ${what}. Try Refresh.`
        : `Loading ${what}…`}
    </p>
  )
}
