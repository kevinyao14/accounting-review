# Dream Cycle — Local Memory Refresh Workflow

This document explains how to sync production data locally, run the dream engine
to recompute memory briefs and patterns, then push the updated memory layer back
to production. Follow these steps exactly.

---

## Prerequisites

- Node.js 18+ (for sync scripts)
- Python 3.10+ (for dream_engine.py)
- Access to the deployed Vercel app URL
- The Cowork workspace folder (default: `C:\Users\kevin\OneDrive\Desktop\Claude Cowork`)

---

## The Three-Step Cycle

```
1. PULL   —  production KV/Blob → local workspace
2. DREAM  —  recompute briefs + patterns from all available data
3. PUSH   —  upload updated memory artifacts back to production
```

### Step 1: Pull (sync production → local)

```bash
# First time — full download of everything
node scripts/sync-local.js pull \
  --base-url https://your-app.vercel.app \
  --dest "C:\Users\kevin\OneDrive\Desktop\Claude Cowork" \
  --full

# Subsequent runs — incremental, only fetches new/changed data
node scripts/sync-local.js pull \
  --base-url https://your-app.vercel.app \
  --dest "C:\Users\kevin\OneDrive\Desktop\Claude Cowork"
```

This downloads:
- Memory layer (briefs, patterns, baselines, signals, errors, kb, budget)
- Financial data (IS timeseries, GL by month, budgets)
- Review history (full payloads + auto-extracts findings for dream engine)
- Knowledge bases (global + per-property source text)
- Committed feedback

A `.sync-manifest.json` file tracks what was pulled so future runs skip unchanged data.

### Step 2: Dream (recompute memory)

```bash
cd "C:\Users\kevin\OneDrive\Desktop\Claude Cowork"

# Single property
python dream_engine.py dream "Encore at Forest Park" --month 2026-04

# All properties
python dream_engine.py dream --all --month 2026-04

# Preview a brief without saving
python dream_engine.py brief "Encore at Forest Park" --month 2026-04

# Check patterns only
python dream_engine.py patterns "Encore at Forest Park"

# Portfolio-wide summary
python dream_engine.py portfolio
```

Dream engine reads from the local workspace and writes to:
- `memory_layer/patterns/{Property}_patterns.json`
- `memory_layer/briefs/{Property}_{YYYY-MM}_brief.kb`

### Step 3: Push (upload memory → production)

```bash
node scripts/upload-memory.js \
  --base-url https://your-app.vercel.app \
  --source "C:\Users\kevin\OneDrive\Desktop\Claude Cowork"

# Or just push briefs and patterns (what dream engine changed)
node scripts/upload-memory.js \
  --base-url https://your-app.vercel.app \
  --source "C:\Users\kevin\OneDrive\Desktop\Claude Cowork" \
  --only briefs

node scripts/upload-memory.js \
  --base-url https://your-app.vercel.app \
  --source "C:\Users\kevin\OneDrive\Desktop\Claude Cowork" \
  --only properties
```

---

## Directory Structure

After a full pull, your workspace will look like this:

```
Claude Cowork/
├── .sync-manifest.json              ← sync state tracker (do not edit)
├── dream_logs/                      ← timestamped change logs from dream engine
│   └── dream_20260405_143022_2026-04.log
│
├── memory_layer/
│   ├── structured/
│   │   └── {Property}_memory.json   ← baselines (from seed, rarely changes)
│   ├── kb/
│   │   └── {Property}_data.json     ← fixed costs, accruals, contracts
│   ├── patterns/
│   │   └── {Property}_patterns.json ★ DREAM ENGINE WRITES THIS
│   ├── briefs/
│   │   └── {Property}_brief.kb      ★ DREAM ENGINE WRITES THIS
│   ├── signals/
│   │   └── {Property}_{MM}_signals.json
│   ├── errors/
│   │   └── {Property}_errors.json
│   ├── budget/
│   │   ├── BUDGET_INTELLIGENCE.json
│   │   └── {Property}_budget_analysis.json
│   ├── fees/
│   │   ├── FEE_VERIFICATION_ENGINE.json
│   │   └── RATE_KB.json
│   ├── feedback/
│   │   └── {Property}_{Q#}_review.json
│   ├── findings/                    ← auto-extracted from review history
│   │   └── {Property}_{period}_{source}.json
│   ├── COUNTER_HEURISTICS.json
│   ├── PORTFOLIO_INTELLIGENCE.json
│   ├── PORTFOLIO_RISK_SCORES.json
│   ├── RELIABLE_ERROR_PATTERNS.json
│   └── PORTFOLIO_IS_GL_CROSSREF.json
│
├── data/                            ← financial fragments from reviews
│   ├── is/
│   │   └── {Property}_timeseries.json
│   ├── gl/
│   │   └── {Property}_{YYYY-MM}.json
│   └── budget/
│       └── {Property}_budget.json
│
├── reviews/                         ← full review payloads
│   └── {Property}_{period}.json
│
├── kb/                              ← KB source text
│   ├── global_source.txt
│   └── {Property}_source.txt
│
├── feedback/
│   └── {Property}_{period}.json
│
└── summaries/                       ← pre-existing local summaries
    ├── {Property}_full.json         (dream engine reads these)
    └── {Property}_compact.json
```

---

## What Files Does Dream Engine Change?

Dream engine ONLY writes to two directories:

| Output | Path | Pushed back to KV |
|--------|------|--------------------|
| Patterns | `memory_layer/patterns/{Property}_patterns.json` | Yes — `memory:prop:{enc}:patterns` |
| Briefs | `memory_layer/briefs/{Property}_{month}_brief.kb` | Yes — `memory:prop:{enc}:brief` |

Everything else is **read-only input**. Do not modify these files manually
unless you know what you're doing:

### DO NOT MODIFY (pulled from production, read-only)
- `.sync-manifest.json` — tracks sync state
- `data/` — financial fragments ingested during reviews
- `reviews/` — full review history payloads
- `memory_layer/findings/` — auto-extracted from reviews by sync script
- `feedback/` — user feedback on reviews

### SAFE TO EDIT (your local data, not overwritten by pull)
- `summaries/` — pre-built IS summaries (dream engine input)
- `memory_layer/kb/` — property KB structured data (also editable via app UI)
- `memory_layer/structured/` — baselines (seeded once, rarely updated)

### DREAM ENGINE OUTPUT (will be pushed to production)
- `memory_layer/patterns/` — recomputed by dream engine
- `memory_layer/briefs/` — recomputed by dream engine
- `dream_logs/` — change logs (local only, never pushed)

---

## Dream Change Logs

Every dream cycle writes a timestamped log to `dream_logs/`. The log shows
exactly what changed per property compared to the previous run.

**Log location:** `dream_logs/dream_{YYYYMMDD}_{HHMMSS}_{month}.log`

**Example log output:**
```
DREAM CYCLE LOG
Started:  2026-04-05 14:30:22
Duration: 8.3s
Month:    2026-04
Changed:  12 properties
Unchanged: 32 properties

──────────────────────────────��────────────────────��──────────────────
△ Encore at Forest Park:
  recurring findings: 0 → 3 (+3)
  NEW RECURRING: Acct 601023 — 'Landscape contract variance' (3x)
  NEW RECURRING: Acct 505001 — 'Insurance accrual timing' (2x)
  new finding months ingested: 2026-03, 2026-04
  brief: 2841 → 3102 chars (+261), +8 lines, -2 lines
△ ASA Flats and Lofts:
  watch list items: 5 → 7 (+2)
  trending accounts: 3 → 4 (+1)
  brief: 1920 → 2044 chars (+124), +4 lines, -1 lines
· Anthem on Ashley: no changes
· 1100 South: no changes
────────────────────────────────────────────────────────────────��─────
END — 12 changed, 32 unchanged
```

**What the log tracks per property:**
- Count changes for all pattern categories (stable, volatile, trending, reversals, etc.)
- Newly detected recurring findings (flagged in 2+ reviews) — highlighted as `NEW RECURRING`
- Data source upgrades (e.g., `memory_only → full_summary`)
- New finding months ingested since last run
- Brief size and line-level diff summary

---

## Incremental Sync Details

The sync script uses `.sync-manifest.json` to avoid re-downloading unchanged data.
It tracks:

- **Memory layer items**: content length (bytes) — re-pulls if size changed
- **Financial data**: account count + date range — re-pulls if new months added
- **GL months**: entry count + ingest timestamp — re-pulls if re-ingested
- **Reviews**: timestamp — each review pulled once, never re-pulled
- **KB**: source text length — re-pulls if edited via app
- **Feedback**: presence flag — pulled once per review

To force a full re-download, add `--full`:
```bash
node scripts/sync-local.js pull --base-url ... --dest ... --full
```

To see what would be synced without downloading:
```bash
node scripts/sync-local.js pull --base-url ... --dest ... --dry-run
```

---

## Typical Workflow After Reviews

After running a batch of reviews in the app:

```bash
# 1. Pull new review data + financial fragments
node scripts/sync-local.js pull --base-url $URL --dest $COWORK

# 2. Run dream engine to recompute with new findings
python dream_engine.py dream --all --month 2026-04

# 3. Push updated briefs + patterns back to production
node scripts/upload-memory.js --base-url $URL --source $COWORK --only briefs
node scripts/upload-memory.js --base-url $URL --source $COWORK --only properties

# Now future reviews will use the updated memory layer
```

---

## Troubleshooting

**"0 fetched, everything skipped"** — Manifest says everything is up to date.
Use `--full` to force re-download, or delete `.sync-manifest.json`.

**Sync seems slow** — First full pull downloads everything including GL blobs.
Subsequent incremental syncs are much faster.

**Dream engine says "no data"** — Make sure you pulled financial data
(`--only data`) and reviews (`--only reviews`). Dream engine needs
`summaries/` or `data/is/` files to compute volatility patterns.

**Push only changed files** — Use `--only briefs` or `--only properties`
with upload-memory.js to avoid re-uploading unchanged globals.
