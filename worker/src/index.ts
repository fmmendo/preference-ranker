/// <reference types="@cloudflare/workers-types" />

// Preference Ranker sync API (Cloudflare Worker + D1).
//
// Stores a pooled, anonymous comparison log so the client can show a crowd-wide
// aggregate ranking. No accounts, no PII: only an anonymous GUID + comparison
// edges. The client remains the source of truth for each user's own ranking;
// this is an additive sync target.

export interface Env {
  DB: D1Database
}

const CORS: Record<string, string> = {
  // Public, credential-free API (no cookies/auth), so a wildcard origin is fine.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
}

/** Max comparisons accepted in a single sync POST. */
const MAX_BATCH = 500

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}

interface IncomingComparison {
  id: string
  itemAId: string
  itemBId: string
  winnerId: string
  createdAt?: number
}

function isValidComparison(c: unknown): c is IncomingComparison {
  if (typeof c !== 'object' || c === null) return false
  const o = c as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    typeof o.itemAId === 'string' &&
    typeof o.itemBId === 'string' &&
    typeof o.winnerId === 'string' &&
    (o.winnerId === o.itemAId || o.winnerId === o.itemBId)
  )
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS })
    }

    const url = new URL(request.url)
    const parts = url.pathname.split('/').filter(Boolean)

    try {
      // Routes: /c/:collectionId/(comparisons|comparisons/:id|reset|aggregate)
      if (parts[0] === 'c' && parts[1]) {
        const collectionId = decodeURIComponent(parts[1])
        const sub = parts[2]

        if (sub === 'comparisons' && !parts[3] && request.method === 'POST') {
          return await addComparisons(request, env, collectionId)
        }
        if (sub === 'comparisons' && parts[3] && request.method === 'DELETE') {
          return await deleteComparison(
            env,
            collectionId,
            decodeURIComponent(parts[3]),
            url.searchParams.get('userId'),
          )
        }
        if (sub === 'reset' && request.method === 'POST') {
          return await resetUser(request, env, collectionId)
        }
        if (sub === 'aggregate' && request.method === 'GET') {
          return await aggregate(request, env, collectionId)
        }
      }
      return json({ error: 'not found' }, 404)
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : 'error' }, 400)
    }
  },
} satisfies ExportedHandler<Env>

async function addComparisons(
  request: Request,
  env: Env,
  collectionId: string,
): Promise<Response> {
  const body = (await request.json()) as {
    userId?: unknown
    comparisons?: unknown
  }
  const userId = body.userId
  if (typeof userId !== 'string' || userId.length === 0) {
    return json({ error: 'userId required' }, 400)
  }
  if (!Array.isArray(body.comparisons)) {
    return json({ error: 'comparisons array required' }, 400)
  }
  if (body.comparisons.length > MAX_BATCH) {
    return json({ error: `at most ${MAX_BATCH} comparisons per request` }, 400)
  }

  const now = Date.now()
  const statements: D1PreparedStatement[] = []
  for (const c of body.comparisons) {
    if (!isValidComparison(c)) continue
    const createdAt = typeof c.createdAt === 'number' ? c.createdAt : now
    statements.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO comparisons
           (id, collection_id, user_id, item_a_id, item_b_id, winner_id, created_at, received_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      ).bind(
        c.id,
        collectionId,
        userId,
        c.itemAId,
        c.itemBId,
        c.winnerId,
        createdAt,
        now,
      ),
    )
  }

  const accepted = statements.length
  // Register the user once (INSERT OR IGNORE writes nothing after the first
  // pick). We deliberately don't bump last_seen on every push — it's write
  // churn we don't read, and halving writes matters against D1's daily limit.
  statements.push(
    env.DB.prepare(
      `INSERT OR IGNORE INTO users (user_id, collection_id, first_seen, last_seen)
       VALUES (?,?,?,?)`,
    ).bind(userId, collectionId, now, now),
  )
  await env.DB.batch(statements)
  return json({ accepted })
}

async function deleteComparison(
  env: Env,
  collectionId: string,
  id: string,
  userId: string | null,
): Promise<Response> {
  if (!userId) return json({ error: 'userId required' }, 400)
  await env.DB.prepare(
    `DELETE FROM comparisons WHERE id=? AND collection_id=? AND user_id=?`,
  )
    .bind(id, collectionId, userId)
    .run()
  return json({ ok: true })
}

async function resetUser(
  request: Request,
  env: Env,
  collectionId: string,
): Promise<Response> {
  const { userId } = (await request.json()) as { userId?: unknown }
  if (typeof userId !== 'string' || userId.length === 0) {
    return json({ error: 'userId required' }, 400)
  }
  await env.DB.prepare(
    `DELETE FROM comparisons WHERE collection_id=? AND user_id=?`,
  )
    .bind(collectionId, userId)
    .run()
  return json({ ok: true })
}

async function aggregate(
  request: Request,
  env: Env,
  collectionId: string,
): Promise<Response> {
  // The crowd aggregate is the single most read-heavy query (a full-table
  // GROUP BY scan). Edge-cache it briefly so a burst of "Everyone" views
  // collapses to ~one D1 scan per minute per location instead of one per
  // visitor. A cache hit reads zero rows from D1.
  const cache = caches.default
  const cacheKey = new Request(new URL(request.url).toString(), { method: 'GET' })
  const cached = await cache.match(cacheKey)
  if (cached) return cached

  // Pool every user's comparisons into per-unordered-pair tallies. The client
  // expands these into a synthetic log and runs the existing Bradley-Terry fit.
  const { results } = await env.DB.prepare(
    `SELECT
       CASE WHEN item_a_id < item_b_id THEN item_a_id ELSE item_b_id END AS lo,
       CASE WHEN item_a_id < item_b_id THEN item_b_id ELSE item_a_id END AS hi,
       SUM(CASE WHEN winner_id =
             (CASE WHEN item_a_id < item_b_id THEN item_a_id ELSE item_b_id END)
           THEN 1 ELSE 0 END) AS loWins,
       COUNT(*) AS total
     FROM comparisons
     WHERE collection_id = ?
     GROUP BY lo, hi`,
  )
    .bind(collectionId)
    .all<{ lo: string; hi: string; loWins: number; total: number }>()

  const pairs = results.map((r) => ({
    itemAId: r.lo,
    itemBId: r.hi,
    aWins: r.loWins,
    bWins: r.total - r.loWins,
  }))

  const userRow = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM users WHERE collection_id = ?`,
  )
    .bind(collectionId)
    .first<{ n: number }>()

  const resp = new Response(JSON.stringify({ pairs, users: userRow?.n ?? 0 }), {
    headers: {
      'Content-Type': 'application/json',
      ...CORS,
      // 60s edge TTL — crowd rankings shift slowly, so brief staleness is fine.
      'Cache-Control': 'public, max-age=60',
    },
  })
  await cache.put(cacheKey, resp.clone())
  return resp
}
