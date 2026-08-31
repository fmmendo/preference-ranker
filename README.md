# Preference Ranker

Rank anything by **which-do-you-prefer?** pairwise comparisons instead of star
ratings. Two items are shown, you pick a winner, and the app infers a full
ranking — a live **Elo** score as you go, plus an order-independent
**Bradley–Terry** "definitive" ranking with 95% confidence intervals. Group your
items (e.g. albums → songs) and it derives a ranking for the groups too, purely
from the items' scores.

Everything is local-first (IndexedDB, works offline). Optional anonymous
multi-user sync adds a crowd-wide "Everyone" ranking.

**Live example:** [Muse edition](https://www.fmendo.com/muse-ranker/) — ranking
the Muse discography.

## Make it your own

This repo is a **template**. Click **“Use this template”** (or fork), then
replace one file — `public/datasets/dataset.json` — with your own items. That's
it: labels, colours, the whole UI adapt to your data. No code changes needed.

### Dataset format (`public/datasets/dataset.json`)

```jsonc
{
  "version": 1,
  "name": "Pizza",
  "description": "Rank pizzas head-to-head.",
  "config": {
    // optional operator config (sensible defaults if omitted)
    "kFactor": 32, // Elo K-factor
    "avoidWindow": 20, // don't re-show a pair seen in the last N comparisons
    "pairWeights": {
      // pair-selection strategy mix (need not sum to 1)
      "similarRating": 0.4,
      "lowConfidence": 0.3,
      "random": 0.25,
      "verification": 0.05,
    },
    "syncUrl": "https://your-worker.example.workers.dev", // omit for local-only
  },
  "group": { "label": "Style", "labelPlural": "Styles" }, // what a group is called
  "item": { "label": "Pizza", "labelPlural": "Pizzas" }, // what an item is called
  "groups": [
    {
      "name": "Neapolitan",
      "color": "#ef4444", // optional; hashed from the name if omitted
      "image": "images/neapolitan.jpg", // optional; shown on the compare cards
      "metadata": { "year": 1889 }, // optional; e.g. a year shown by the item
      "items": [
        { "name": "Margherita", "metadata": { "tags": ["classic", "veggie"] } },
        { "name": "Marinara", "metadata": { "isBonus": true } }, // isBonus → excludable in group scores
      ],
    },
  ],
}
```

- Images: drop files in `public/datasets/images/` and reference them as
  `images/<file>` (relative to the dataset), or use absolute URLs. An item with
  no image inherits its group's.
- The generic app has no notion of "albums" or "songs" — those are just the
  labels your dataset chooses.
- `metadata.tags` (optional, `string[]`): freeform attribute tags on an item
  (e.g. musical traits for songs, or features like `ice-dispenser` for
  appliances). They power attribute-based preference analysis — fitting how much
  each tag drives a win across the comparison log (conjoint-style part-worths),
  so you can see *which features people actually prefer*, not just which items.
  Keep the vocabulary small and reused across items.

## Develop

```bash
npm install
npm run dev
```

Other scripts: `npm test`, `npm run lint`, `npm run build`.

## Deploy (GitHub Pages)

A GitHub Actions workflow (`.github/workflows/deploy.yml`) builds and deploys to
Pages on every push to `main`. The Vite `base` path is derived from the repo
name automatically, so it works for any fork/instance with no config. Enable
Pages once (Settings → Pages → Source: GitHub Actions), or the first workflow run
will prompt it.

## Optional: anonymous multi-user ("Everyone" ranking)

Set `config.syncUrl` in your dataset to a deployed sync API to pool everyone's
comparisons into a crowd ranking. Identity is an anonymous GUID in localStorage
— no accounts, no personal data.

The API is a small Cloudflare Worker + D1 database in [`worker/`](worker/):

```bash
npm i -D wrangler
npx wrangler login
npx wrangler d1 create preference-ranker      # paste the id into worker/wrangler.toml
npm run worker:schema                          # apply worker/schema.sql
npm run worker:deploy                          # note the Worker URL
```

Then set `config.syncUrl` to that URL. Free-tier friendly. See
[`worker/`](worker/) for details.

## How it works

- **Elo** (live, incremental) drives instant feedback and pair selection.
- **Bradley–Terry** (batch MLE over the whole comparison log) gives the
  order-independent "definitive" ranking with confidence intervals — overlapping
  intervals mean a statistical tie.
- Group rankings aggregate the items' scores (mean = consistency, top-N = peaks).
- Ratings are always derived by replaying the comparison log, so undo, reset and
  sync are trivially correct.

## Tech

React 19 · TypeScript · Vite · Tailwind CSS 4 · Dexie (IndexedDB) · Vitest ·
Cloudflare Workers + D1 (optional).
