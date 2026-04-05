#!/usr/bin/env node
/**
 * sync-local.js — Incremental sync between Vercel KV/Blob and local workspace
 *
 * Maintains a .sync-manifest.json to track what's been pulled, so subsequent
 * runs only fetch new/changed data.
 *
 * Usage:
 *   node scripts/sync-local.js pull --base-url https://your-app.vercel.app --dest /path/to/Claude\ Cowork
 *   node scripts/sync-local.js pull --base-url https://your-app.vercel.app --dest /path --only memory
 *   node scripts/sync-local.js pull --base-url https://your-app.vercel.app --dest /path --only data
 *   node scripts/sync-local.js pull --base-url https://your-app.vercel.app --dest /path --only reviews
 *   node scripts/sync-local.js pull --base-url https://your-app.vercel.app --dest /path --full
 *   node scripts/sync-local.js push --base-url https://your-app.vercel.app --source /path/to/Claude\ Cowork
 *
 * Options:
 *   pull             Download KV/Blob → local (incremental by default)
 *   push             Upload local → KV/Blob (delegates to upload-memory.js)
 *   --base-url       Deployed app URL (required)
 *   --dest           Local workspace path for pull (required for pull)
 *   --source         Local workspace path for push (required for push)
 *   --only           Pull only: memory, data, reviews, kb, feedback (default: all)
 *   --property       Sync only a specific property
 *   --full           Force full re-download, ignore manifest
 *   --dry-run        Show what would be synced without downloading
 *
 * Local directory structure (mirrors upload-memory.js expectations):
 *
 *   {dest}/
 *   ├── .sync-manifest.json              ← tracks last sync state
 *   ├── memory_layer/
 *   │   ├── structured/
 *   │   │   └── {Property}_memory.json   ← baselines
 *   │   ├── kb/
 *   │   │   └── {Property}_data.json     ← property KB data
 *   │   ├── patterns/
 *   │   │   └── {Property}_patterns.json
 *   │   ├── briefs/
 *   │   │   └── {Property}_brief.kb
 *   │   ├── signals/
 *   │   │   └── {Property}_{YYYY-MM}_signals.json
 *   │   ├── errors/
 *   │   │   └── {Property}_errors.json
 *   │   ├── budget/
 *   │   │   ├── BUDGET_INTELLIGENCE.json
 *   │   │   └── {Property}_budget_analysis.json
 *   │   ├── fees/
 *   │   │   ├── FEE_VERIFICATION_ENGINE.json
 *   │   │   └── RATE_KB.json
 *   │   ├── feedback/
 *   │   │   └── {Property}_{YYYY-Q#}_review.json
 *   │   ├── findings/                    ← extracted from review history
 *   │   │   └── {Property}_{YYYY-MM}_{source}.json
 *   │   ├── COUNTER_HEURISTICS.json
 *   │   ├── PORTFOLIO_INTELLIGENCE.json
 *   │   ├── PORTFOLIO_RISK_SCORES.json
 *   │   ├── RELIABLE_ERROR_PATTERNS.json
 *   │   └── PORTFOLIO_IS_GL_CROSSREF.json
 *   ├── data/
 *   │   ├── is/
 *   │   │   └── {Property}_timeseries.json
 *   │   ├── gl/
 *   │   │   └── {Property}_{YYYY-MM}.json
 *   │   └── budget/
 *   │       └── {Property}_budget.json
 *   ├── reviews/
 *   │   └── {Property}_{period}.json     ← full review payloads
 *   ├── kb/
 *   │   ├── global_source.txt
 *   │   └── {Property}_source.txt
 *   └── feedback/
 *       └── {Property}_{period}.json
 */

import fs from "fs";
import path from "path";

// ── CLI Args ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const MODE = args[0]; // "pull" or "push"

function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
}
const hasFlag = (name) => args.includes(`--${name}`);

const BASE_URL  = getArg("base-url");
const DEST      = getArg("dest") || getArg("source");
const ONLY      = getArg("only");
const ONLY_PROP = getArg("property");
const FULL      = hasFlag("full");
const DRY_RUN   = hasFlag("dry-run");

if (!MODE || !["pull", "push"].includes(MODE) || !BASE_URL || !DEST) {
  console.error(`Usage:
  node scripts/sync-local.js pull --base-url <url> --dest <path> [--only memory|data|reviews|kb|feedback] [--full] [--dry-run]
  node scripts/sync-local.js push --base-url <url> --source <path>`);
  process.exit(1);
}

if (MODE === "push") {
  console.log("Push mode delegates to upload-memory.js:");
  console.log(`  node scripts/upload-memory.js --base-url ${BASE_URL} --source ${DEST}`);
  console.log("Run that command directly. sync-local.js push is a reminder only.");
  process.exit(0);
}

// ── Manifest ──────────────────────────────────────────────────────────────

const MANIFEST_PATH = path.join(DEST, ".sync-manifest.json");

function loadManifest() {
  if (FULL) return {};
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function saveManifest(m) {
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(m, null, 2));
}

// ── Helpers ───────────────────────────────────────────────────────────────

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function writeJSON(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function writeText(filePath, text) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, text, "utf-8");
}

async function api(endpoint, params = {}) {
  const url = new URL(`${BASE_URL.replace(/\/$/, "")}${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString());
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${endpoint}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function fetchBlob(blobUrl) {
  const res = await fetch(`${BASE_URL.replace(/\/$/, "")}/api/history?url=${encodeURIComponent(blobUrl)}`);
  if (!res.ok) throw new Error(`${res.status} fetching blob`);
  return res.json();
}

let stats = { fetched: 0, skipped: 0, errors: 0 };

// ── Pull: Memory Layer ────────────────────────────────────────────────────

async function pullMemory(manifest) {
  console.log("\n📦 Pulling memory layer...");
  const memDir = path.join(DEST, "memory_layer");

  // Get property list
  const properties = await api("/api/memory-store", { type: "property-list" });
  const propList = ONLY_PROP ? properties.filter(p => p === ONLY_PROP) : properties;
  console.log(`  ${propList.length} properties`);

  // ── Globals ──────────────────────────────────────────────────────────
  const globalKvKeys = [
    { key: "counter_heuristics",    file: "COUNTER_HEURISTICS.json" },
    { key: "portfolio_intelligence", file: "PORTFOLIO_INTELLIGENCE.json" },
    { key: "risk_scores",           file: "PORTFOLIO_RISK_SCORES.json" },
    { key: "budget_intelligence",   file: path.join("budget", "BUDGET_INTELLIGENCE.json") },
    { key: "fee_verification",      file: path.join("fees", "FEE_VERIFICATION_ENGINE.json") },
    { key: "fee_rates",             file: path.join("fees", "RATE_KB.json") },
  ];

  for (const g of globalKvKeys) {
    const mKey = `global:${g.key}`;
    try {
      const data = await api("/api/memory-store", { type: "global", key: g.key });
      if (data == null) { stats.skipped++; continue; }
      const hash = JSON.stringify(data).length;
      if (!FULL && manifest[mKey] === hash) { stats.skipped++; continue; }
      const filePath = path.join(memDir, g.file);
      if (DRY_RUN) { console.log(`  → would write ${g.file}`); stats.fetched++; continue; }
      writeJSON(filePath, data);
      manifest[mKey] = hash;
      stats.fetched++;
      console.log(`  ✓ ${g.file}`);
    } catch (e) { console.warn(`  ✗ ${g.key}: ${e.message}`); stats.errors++; }
  }

  // Global blobs
  const globalBlobKeys = [
    { key: "reliable_error_patterns", file: "RELIABLE_ERROR_PATTERNS.json" },
    { key: "portfolio_crossref",      file: "PORTFOLIO_IS_GL_CROSSREF.json" },
  ];

  for (const g of globalBlobKeys) {
    const mKey = `global-blob:${g.key}`;
    try {
      const data = await api("/api/memory-store", { type: "global-blob", key: g.key });
      if (data == null) { stats.skipped++; continue; }
      const hash = JSON.stringify(data).length;
      if (!FULL && manifest[mKey] === hash) { stats.skipped++; continue; }
      if (DRY_RUN) { console.log(`  → would write ${g.file}`); stats.fetched++; continue; }
      writeJSON(path.join(memDir, g.file), data);
      manifest[mKey] = hash;
      stats.fetched++;
      console.log(`  ✓ ${g.file}`);
    } catch (e) { console.warn(`  ✗ ${g.key}: ${e.message}`); stats.errors++; }
  }

  // ── Per-property KV ──────────────────────────────────────────────────
  const propKvKeys = [
    { key: "baselines", dir: "structured", suffix: "_memory.json", json: true },
    { key: "kb",        dir: "kb",         suffix: "_data.json",   json: true },
    { key: "patterns",  dir: "patterns",   suffix: "_patterns.json", json: true },
    { key: "brief",     dir: "briefs",     suffix: "_brief.kb",   json: false },
    { key: "budget",    dir: "budget",     suffix: "_budget_analysis.json", json: true },
  ];

  for (const prop of propList) {
    for (const pk of propKvKeys) {
      const mKey = `prop:${prop}:${pk.key}`;
      try {
        const data = await api("/api/memory-store", { type: "property", property: prop, key: pk.key });
        // Brief returns {brief: string|null}
        const value = pk.key === "brief" ? data?.brief : data;
        if (value == null) { stats.skipped++; continue; }
        const hash = typeof value === "string" ? value.length : JSON.stringify(value).length;
        if (!FULL && manifest[mKey] === hash) { stats.skipped++; continue; }
        const filePath = path.join(memDir, pk.dir, `${prop}${pk.suffix}`);
        if (DRY_RUN) { console.log(`  → would write ${pk.dir}/${prop}${pk.suffix}`); stats.fetched++; continue; }
        if (pk.json) writeJSON(filePath, value);
        else writeText(filePath, value);
        manifest[mKey] = hash;
        stats.fetched++;
      } catch (e) { console.warn(`  ✗ ${prop}/${pk.key}: ${e.message}`); stats.errors++; }
    }

    // Signals (by month)
    try {
      const sigIndex = await api("/api/memory-store", { type: "property-blob", property: prop, key: "signals-index" });
      const months = Array.isArray(sigIndex) ? sigIndex : [];
      for (const month of months) {
        const mKey = `prop:${prop}:signals:${month}`;
        if (!FULL && manifest[mKey]) { stats.skipped++; continue; }
        try {
          const data = await api("/api/memory-store", { type: "property-blob", property: prop, key: "signals", month });
          if (data == null) { stats.skipped++; continue; }
          const filePath = path.join(memDir, "signals", `${prop}_${month}_signals.json`);
          if (DRY_RUN) { console.log(`  → would write signals/${prop}_${month}_signals.json`); stats.fetched++; continue; }
          writeJSON(filePath, data);
          manifest[mKey] = 1;
          stats.fetched++;
        } catch (e) { console.warn(`  ✗ ${prop}/signals/${month}: ${e.message}`); stats.errors++; }
      }
    } catch { /* no signals index */ }

    // Errors
    {
      const mKey = `prop:${prop}:errors`;
      try {
        const data = await api("/api/memory-store", { type: "property-blob", property: prop, key: "errors" });
        if (data == null) { stats.skipped++; }
        else {
          const hash = JSON.stringify(data).length;
          if (!FULL && manifest[mKey] === hash) { stats.skipped++; }
          else {
            const filePath = path.join(memDir, "errors", `${prop}_errors.json`);
            if (DRY_RUN) { console.log(`  → would write errors/${prop}_errors.json`); stats.fetched++; }
            else { writeJSON(filePath, data); manifest[mKey] = hash; stats.fetched++; }
          }
        }
      } catch (e) { console.warn(`  ✗ ${prop}/errors: ${e.message}`); stats.errors++; }
    }

    // Feedback (need to discover quarters from review index)
    // Pulled separately in pullFeedback()
  }

  console.log(`  Memory done: ${stats.fetched} fetched, ${stats.skipped} skipped, ${stats.errors} errors`);
}

// ── Pull: Financial Data ──────────────────────────────────────────────────

async function pullData(manifest) {
  console.log("\n📊 Pulling financial data...");
  const dataDir = path.join(DEST, "data");
  const before = { ...stats };

  const properties = await api("/api/data-store", { type: "property-list" });
  const propList = ONLY_PROP ? properties.filter(p => p === ONLY_PROP) : properties;
  console.log(`  ${propList.length} properties with financial data`);

  for (const prop of propList) {
    // IS timeseries
    {
      const mKey = `data:is:${prop}`;
      try {
        const data = await api("/api/data-store", { property: prop, type: "timeseries" });
        if (!data?.accounts) { stats.skipped++; }
        else {
          const hash = data.totalAccounts + ":" + (data.dateRange?.to || "");
          if (!FULL && manifest[mKey] === hash) { stats.skipped++; }
          else {
            const filePath = path.join(dataDir, "is", `${prop}_timeseries.json`);
            if (DRY_RUN) { console.log(`  → would write is/${prop}_timeseries.json`); stats.fetched++; }
            else { writeJSON(filePath, data); manifest[mKey] = hash; stats.fetched++; console.log(`  ✓ is/${prop}`); }
          }
        }
      } catch (e) { console.warn(`  ✗ ${prop}/is: ${e.message}`); stats.errors++; }
    }

    // GL by month
    try {
      const glIndex = await api("/api/data-store", { property: prop, type: "gl-periods" });
      if (Array.isArray(glIndex)) {
        for (const entry of glIndex) {
          const month = entry.month;
          const mKey = `data:gl:${prop}:${month}`;
          const hash = entry.totalEntries + ":" + (entry.ingestedAt || "");
          if (!FULL && manifest[mKey] === hash) { stats.skipped++; continue; }
          try {
            // Fetch GL blob directly
            if (!entry.blobUrl) { stats.skipped++; continue; }
            const data = await fetchBlob(entry.blobUrl);
            const filePath = path.join(dataDir, "gl", `${prop}_${month}.json`);
            if (DRY_RUN) { console.log(`  → would write gl/${prop}_${month}.json`); stats.fetched++; continue; }
            writeJSON(filePath, data);
            manifest[mKey] = hash;
            stats.fetched++;
          } catch (e) { console.warn(`  ✗ ${prop}/gl/${month}: ${e.message}`); stats.errors++; }
        }
      }
    } catch { /* no GL data */ }

    // Budget
    {
      const mKey = `data:budget:${prop}`;
      try {
        const data = await api("/api/data-store", { property: prop, type: "budget" });
        if (!data?.accounts) { stats.skipped++; }
        else {
          const hash = data.totalAccounts + ":" + (data.fiscalYear || "");
          if (!FULL && manifest[mKey] === hash) { stats.skipped++; }
          else {
            const filePath = path.join(dataDir, "budget", `${prop}_budget.json`);
            if (DRY_RUN) { console.log(`  → would write budget/${prop}_budget.json`); stats.fetched++; }
            else { writeJSON(filePath, data); manifest[mKey] = hash; stats.fetched++; console.log(`  ✓ budget/${prop}`); }
          }
        }
      } catch (e) { console.warn(`  ✗ ${prop}/budget: ${e.message}`); stats.errors++; }
    }
  }

  console.log(`  Data done: ${stats.fetched - before.fetched} fetched, ${stats.skipped - before.skipped} skipped`);
}

// ── Pull: Review History + Extract Findings ───────────────────────────────

async function pullReviews(manifest) {
  console.log("\n📝 Pulling review history...");
  const reviewDir = path.join(DEST, "reviews");
  const findingsDir = path.join(DEST, "memory_layer", "findings");
  const before = { ...stats };

  const index = await api("/api/history");
  if (!Array.isArray(index)) { console.log("  No reviews found"); return; }

  const reviews = ONLY_PROP ? index.filter(r => r.property === ONLY_PROP) : index;
  console.log(`  ${reviews.length} reviews in index`);

  for (const entry of reviews) {
    const slug = `${entry.property}_${entry.period}`;
    const mKey = `review:${slug}:${entry.timestamp}`;

    if (!FULL && manifest[mKey]) { stats.skipped++; continue; }
    if (!entry.blobUrl) { stats.skipped++; continue; }

    try {
      const data = await fetchBlob(entry.blobUrl);
      const filePath = path.join(reviewDir, `${slug}.json`);
      if (DRY_RUN) { console.log(`  → would write ${slug}.json`); stats.fetched++; continue; }
      writeJSON(filePath, data);
      manifest[mKey] = 1;
      stats.fetched++;

      // Extract findings for dream engine ingestion
      if (data.findings && Array.isArray(data.findings)) {
        // Group findings by source type
        const bySrc = {};
        for (const f of data.findings) {
          const src = f.source || f.checkType || "IS";
          if (!bySrc[src]) bySrc[src] = [];
          bySrc[src].push(f);
        }
        for (const [src, findings] of Object.entries(bySrc)) {
          const findingsFile = path.join(findingsDir, `${entry.property}_${entry.period}_${src}.json`);
          writeJSON(findingsFile, {
            property: entry.property,
            month: entry.period,
            source: src,
            ingested: new Date().toISOString(),
            findings,
            finding_count: findings.length,
          });
        }
      }

      // Also save general findings if present
      if (data.generalFindings && data.generalFindings.length > 0) {
        const gfFile = path.join(findingsDir, `${entry.property}_${entry.period}_GENERAL.json`);
        writeJSON(gfFile, {
          property: entry.property,
          month: entry.period,
          source: "GENERAL",
          ingested: new Date().toISOString(),
          findings: data.generalFindings,
          finding_count: data.generalFindings.length,
        });
      }
    } catch (e) { console.warn(`  ✗ ${slug}: ${e.message}`); stats.errors++; }
  }

  console.log(`  Reviews done: ${stats.fetched - before.fetched} fetched, ${stats.skipped - before.skipped} skipped`);
}

// ── Pull: KB Source ───────────────────────────────────────────────────────

async function pullKb(manifest) {
  console.log("\n📚 Pulling knowledge bases...");
  const kbDir = path.join(DEST, "kb");
  const before = { ...stats };

  // Global KB
  {
    const mKey = "kb:global";
    try {
      const data = await api("/api/kb", { type: "global" });
      if (data?.source) {
        const hash = data.source.length;
        if (!FULL && manifest[mKey] === hash) { stats.skipped++; }
        else {
          if (DRY_RUN) { console.log("  → would write global_source.txt"); stats.fetched++; }
          else {
            writeText(path.join(kbDir, "global_source.txt"), data.source);
            if (data.compressed) writeText(path.join(kbDir, "global_compressed.txt"), data.compressed);
            manifest[mKey] = hash;
            stats.fetched++;
            console.log("  ✓ global KB");
          }
        }
      } else { stats.skipped++; }
    } catch (e) { console.warn(`  ✗ global KB: ${e.message}`); stats.errors++; }
  }

  // Property KB list
  try {
    const kbProps = await api("/api/kb", { type: "property-list" });
    const propList = ONLY_PROP ? kbProps.filter(p => p === ONLY_PROP) : kbProps;

    for (const prop of propList) {
      const mKey = `kb:prop:${prop}`;
      try {
        const data = await api("/api/kb", { type: "property", name: prop });
        if (data?.source) {
          const hash = data.source.length;
          if (!FULL && manifest[mKey] === hash) { stats.skipped++; continue; }
          if (DRY_RUN) { console.log(`  → would write ${prop}_source.txt`); stats.fetched++; continue; }
          writeText(path.join(kbDir, `${prop}_source.txt`), data.source);
          if (data.compressed) writeText(path.join(kbDir, `${prop}_compressed.txt`), data.compressed);
          manifest[mKey] = hash;
          stats.fetched++;
        } else { stats.skipped++; }
      } catch (e) { console.warn(`  ✗ ${prop} KB: ${e.message}`); stats.errors++; }
    }
  } catch (e) { console.warn(`  ✗ KB list: ${e.message}`); stats.errors++; }

  console.log(`  KB done: ${stats.fetched - before.fetched} fetched, ${stats.skipped - before.skipped} skipped`);
}

// ── Pull: Feedback ────────────────────────────────────────────────────────

async function pullFeedback(manifest) {
  console.log("\n💬 Pulling feedback...");
  const fbDir = path.join(DEST, "feedback");
  const before = { ...stats };

  // Get review index to find reviews with feedback
  const index = await api("/api/history");
  if (!Array.isArray(index)) { console.log("  No reviews found"); return; }

  const withFeedback = index.filter(r => r.hasFeedback || r.feedbackCommitted);
  const filtered = ONLY_PROP ? withFeedback.filter(r => r.property === ONLY_PROP) : withFeedback;
  console.log(`  ${filtered.length} reviews have feedback`);

  for (const entry of filtered) {
    const slug = `${entry.property}_${entry.period}`;
    const mKey = `feedback:${slug}`;
    if (!FULL && manifest[mKey]) { stats.skipped++; continue; }
    if (!entry.blobUrl) { stats.skipped++; continue; }

    try {
      const data = await api("/api/feedback", { blobUrl: entry.blobUrl });
      if (data == null) { stats.skipped++; continue; }
      const filePath = path.join(fbDir, `${slug}.json`);
      if (DRY_RUN) { console.log(`  → would write ${slug}.json`); stats.fetched++; continue; }
      writeJSON(filePath, { property: entry.property, period: entry.period, feedback: data });
      manifest[mKey] = 1;
      stats.fetched++;
    } catch (e) { console.warn(`  ✗ feedback ${slug}: ${e.message}`); stats.errors++; }
  }

  console.log(`  Feedback done: ${stats.fetched - before.fetched} fetched, ${stats.skipped - before.skipped} skipped`);
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log(`🔄 sync-local.js — ${FULL ? "FULL" : "incremental"} pull`);
  console.log(`   Source: ${BASE_URL}`);
  console.log(`   Dest:   ${DEST}`);
  if (ONLY) console.log(`   Only:   ${ONLY}`);
  if (ONLY_PROP) console.log(`   Property: ${ONLY_PROP}`);
  if (DRY_RUN) console.log("   DRY RUN — no files will be written");

  ensureDir(DEST);
  const manifest = loadManifest();

  const sections = ONLY ? [ONLY] : ["memory", "data", "reviews", "kb", "feedback"];

  for (const section of sections) {
    try {
      if (section === "memory")   await pullMemory(manifest);
      if (section === "data")     await pullData(manifest);
      if (section === "reviews")  await pullReviews(manifest);
      if (section === "kb")       await pullKb(manifest);
      if (section === "feedback") await pullFeedback(manifest);
    } catch (e) {
      console.error(`\n✗ ${section} failed: ${e.message}`);
      stats.errors++;
    }

    // Save manifest after each section in case of crash
    if (!DRY_RUN) saveManifest(manifest);
  }

  manifest._lastSync = new Date().toISOString();
  if (!DRY_RUN) saveManifest(manifest);

  console.log(`\n✅ Sync complete`);
  console.log(`   Fetched: ${stats.fetched}`);
  console.log(`   Skipped: ${stats.skipped} (already up to date)`);
  console.log(`   Errors:  ${stats.errors}`);
}

main().catch(e => { console.error(`\n💥 Fatal: ${e.message}`); process.exit(1); });
