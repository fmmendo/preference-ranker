import type { Comparison, Id } from '../domain/types'

// Attribute ("trait") preference analysis, a.k.a. conjoint / feature-Bradley-
// Terry. Each item carries tags (metadata.tags); we model an item's strength as
// the sum of its tags' weights and fit those weights by ridge-penalised logistic
// regression over the comparison log:
//
//   logit P(A beats B) = Σ wₖ · (tagₖ(A) − tagₖ(B))
//
// Each comparison contributes one row: features = winnerTags − loserTags, y = 1.
// The fitted weight wₖ is how much a trait adds to winning (a "part-worth"). We
// also return a 95%-style standard error from the inverse Fisher information, so
// the UI can show which traits are actually distinguishable from zero.

export interface TraitWeight {
  tag: string
  /** Log-odds a trait adds to winning a head-to-head, holding other traits fixed. */
  weight: number
  /** Standard error of the weight (diagonal of the inverse Fisher information). */
  se: number
  /** How many items carry this tag (few → the estimate leans on a handful of items). */
  n: number
}

/** Invert a small square matrix by Gauss–Jordan elimination. */
function invert(A: number[][]): number[][] {
  const n = A.length
  const M = A.map((r, i) => [
    ...r,
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ])
  for (let c = 0; c < n; c++) {
    let piv = c
    for (let r = c + 1; r < n; r++)
      if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r
    ;[M[c], M[piv]] = [M[piv], M[c]]
    const d = M[c][c] || 1e-9
    for (let j = 0; j < 2 * n; j++) M[c][j] /= d
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = M[r][c]
      for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[c][j]
    }
  }
  return M.map((r) => r.slice(n))
}

export interface FitTraitsOptions {
  /** Ridge (Gaussian-prior) strength — shrinks weights toward 0, more so when thin. */
  l2?: number
  iterations?: number
  learningRate?: number
}

/**
 * Fit crowd-level trait part-worths from a comparison log. `tagsById` maps each
 * rankable item to its tags; comparisons referencing untagged items are skipped.
 * Returns one weight (+ SE + item count) per trait, sorted strongest-first.
 */
export function fitTraitWeights(
  tagsById: ReadonlyMap<Id, readonly string[]>,
  vocab: readonly string[],
  comparisons: readonly Comparison[],
  options: FitTraitsOptions = {},
): TraitWeight[] {
  const D = vocab.length
  if (D === 0) return []
  const l2 = options.l2 ?? 0.003
  const iterations = options.iterations ?? 600
  const lr = options.learningRate ?? 0.6

  const idx = new Map(vocab.map((t, k) => [t, k]))
  const cache = new Map<Id, Float64Array>()
  const vec = (id: Id): Float64Array | null => {
    const hit = cache.get(id)
    if (hit) return hit
    const tags = tagsById.get(id)
    if (!tags) return null
    const v = new Float64Array(D)
    for (const t of tags) {
      const k = idx.get(t)
      if (k !== undefined) v[k] = 1
    }
    cache.set(id, v)
    return v
  }

  const rows: Float64Array[] = []
  for (const c of comparisons) {
    const loser = c.winnerId === c.itemAId ? c.itemBId : c.itemAId
    const xw = vec(c.winnerId)
    const xl = vec(loser)
    if (!xw || !xl) continue
    const x = new Float64Array(D)
    for (let k = 0; k < D; k++) x[k] = xw[k] - xl[k]
    rows.push(x)
  }

  const count = new Map<string, number>()
  for (const tags of tagsById.values())
    for (const t of tags) count.set(t, (count.get(t) ?? 0) + 1)

  const zero = () =>
    vocab.map((t) => ({ tag: t, weight: 0, se: Infinity, n: count.get(t) ?? 0 }))
  if (rows.length < D) return zero()

  // Gradient-ascent MAP fit of the ridge-penalised logistic likelihood.
  const b = new Float64Array(D)
  const n = rows.length
  for (let it = 0; it < iterations; it++) {
    const g = new Float64Array(D)
    for (const x of rows) {
      let z = 0
      for (let k = 0; k < D; k++) z += b[k] * x[k]
      const p = 1 / (1 + Math.exp(-z))
      const c = 1 - p
      for (let k = 0; k < D; k++) g[k] += c * x[k]
    }
    for (let k = 0; k < D; k++) b[k] += lr * (g[k] / n - l2 * b[k])
  }

  // Observed Fisher information Σ p(1-p) xxᵀ + λI; invert for the covariance.
  const H: number[][] = Array.from({ length: D }, () => new Array(D).fill(0))
  for (const x of rows) {
    let z = 0
    for (let k = 0; k < D; k++) z += b[k] * x[k]
    const p = 1 / (1 + Math.exp(-z))
    const w = p * (1 - p)
    for (let a = 0; a < D; a++) {
      const xa = x[a]
      if (!xa) continue
      for (let c = 0; c < D; c++) H[a][c] += w * xa * x[c]
    }
  }
  const lam = l2 * n
  for (let k = 0; k < D; k++) H[k][k] += lam
  const cov = invert(H)

  return vocab
    .map((t, k) => ({
      tag: t,
      weight: b[k],
      se: Math.sqrt(Math.max(0, cov[k][k])),
      n: count.get(t) ?? 0,
    }))
    .sort((a, b) => b.weight - a.weight)
}
