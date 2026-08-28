import { useEffect } from 'react'
import type { CSSProperties } from 'react'
import type { Id, Item } from '../domain/types'

interface CompareViewProps {
  pair: [Item, Item]
  onChoose: (winnerId: Id, loserId: Id) => void
  onSkip: () => void
  onUndo: () => void
  canUndo: boolean
  albumLabel: (item: Item) => string
  albumColor: (item: Item) => string
}

export function CompareView({
  pair,
  onChoose,
  onSkip,
  onUndo,
  canUndo,
  albumLabel,
  albumColor,
}: CompareViewProps) {
  const [left, right] = pair

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === '1' || e.key === 'ArrowLeft') {
        onChoose(left.id, right.id)
      } else if (e.key === '2' || e.key === 'ArrowRight') {
        onChoose(right.id, left.id)
      } else if (e.key === ' ' || e.key.toLowerCase() === 's') {
        e.preventDefault()
        onSkip()
      } else if (e.key.toLowerCase() === 'u' || e.key === 'Backspace') {
        e.preventDefault()
        onUndo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [left, right, onChoose, onSkip, onUndo])

  return (
    <section className="flex flex-col items-center gap-6">
      <h2 className="text-lg font-medium text-slate-500 dark:text-slate-400">
        Which do you prefer?
      </h2>

      <div className="grid w-full gap-4 sm:grid-cols-2">
        <ChoiceCard
          item={left}
          hint="1"
          albumLabel={albumLabel(left)}
          accent={albumColor(left)}
          onClick={() => onChoose(left.id, right.id)}
        />
        <ChoiceCard
          item={right}
          hint="2"
          albumLabel={albumLabel(right)}
          accent={albumColor(right)}
          onClick={() => onChoose(right.id, left.id)}
        />
      </div>

      <div className="flex items-center gap-6 text-sm">
        <button
          type="button"
          onClick={onSkip}
          className="text-slate-500 dark:text-slate-400 underline-offset-4 transition hover:text-slate-600 hover:underline active:text-slate-800 dark:hover:text-slate-300"
        >
          Skip (space)
        </button>
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          className="text-slate-500 dark:text-slate-400 underline-offset-4 transition hover:text-slate-600 hover:underline active:text-slate-800 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:no-underline dark:hover:text-slate-300"
        >
          Undo last (u)
        </button>
      </div>
    </section>
  )
}

interface ChoiceCardProps {
  item: Item
  hint: string
  albumLabel: string
  accent: string
  onClick: () => void
}

function ChoiceCard({
  item,
  hint,
  albumLabel,
  accent,
  onClick,
}: ChoiceCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Choose ${item.name}`}
      style={{ '--album': accent } as CSSProperties}
      className="group relative flex min-h-40 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-slate-200 bg-white p-6 text-center transition duration-150 hover:-translate-y-0.5 hover:border-[var(--album)] hover:shadow-lg active:translate-y-0 active:scale-[0.98] active:shadow-sm focus-visible:border-[var(--album)] focus-visible:outline-none dark:border-slate-700 dark:bg-slate-900"
    >
      <span className="absolute left-3 top-3 flex h-6 w-6 items-center justify-center rounded-md border border-slate-200 text-xs text-slate-500 dark:text-slate-400 transition-colors group-hover:border-[var(--album)] group-hover:text-[var(--album)] dark:border-slate-700">
        {hint}
      </span>
      {item.image ? (
        <img
          src={item.image}
          alt=""
          decoding="async"
          className="mb-1 h-28 w-28 rounded-lg object-cover"
          onError={(e) => {
            // A transient CDN cache-miss shouldn't permanently blank a cover
            // (onError otherwise sticks until the element remounts). Retry a
            // couple of times with a cache-busting param, then give up quietly.
            const img = e.currentTarget
            const tries = Number(img.dataset.retry ?? '0')
            if (tries < 2) {
              img.dataset.retry = String(tries + 1)
              const base = img.src.split('?')[0]
              setTimeout(
                () => {
                  img.src = `${base}?retry=${tries + 1}`
                },
                400 * (tries + 1),
              )
            } else {
              img.style.display = 'none'
            }
          }}
        />
      ) : null}
      <span className="text-xl font-semibold text-slate-900 dark:text-slate-100">
        {item.name}
      </span>
      <span className="flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: accent }}
        />
        {albumLabel}
      </span>
    </button>
  )
}
