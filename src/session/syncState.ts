// Tracks which comparison ids have already been pushed to the cloud, so the
// load-time reconcile only sends genuinely-new comparisons. Without this, every
// page load re-pushed the entire local log — idempotent (INSERT OR IGNORE), but
// still one billable query per row per load, most writing nothing. Kept per
// collection in localStorage, guarded like identity.ts.

const KEY_PREFIX = 'ranker:synced:'

function keyFor(collectionId: string): string {
  return `${KEY_PREFIX}${collectionId}`
}

/** Ids known to be in the cloud already. Empty if storage is unavailable. */
export function getSyncedIds(collectionId: string): Set<string> {
  try {
    const raw = localStorage.getItem(keyFor(collectionId))
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((x): x is string => typeof x === 'string'))
  } catch {
    return new Set()
  }
}

function write(collectionId: string, ids: Set<string>): void {
  try {
    localStorage.setItem(keyFor(collectionId), JSON.stringify([...ids]))
  } catch {
    // Storage unavailable/full — the worst case is a redundant re-push later.
  }
}

/** Record ids as synced (call after a successful push). */
export function markSynced(collectionId: string, ids: readonly string[]): void {
  if (ids.length === 0) return
  const set = getSyncedIds(collectionId)
  for (const id of ids) set.add(id)
  write(collectionId, set)
}

/** Forget one id (call when a comparison is undone/deleted). */
export function unmarkSynced(collectionId: string, id: string): void {
  const set = getSyncedIds(collectionId)
  if (set.delete(id)) write(collectionId, set)
}

/** Forget everything for a collection (call on reset). */
export function clearSynced(collectionId: string): void {
  try {
    localStorage.removeItem(keyFor(collectionId))
  } catch {
    // Nothing to do if storage is unavailable.
  }
}
