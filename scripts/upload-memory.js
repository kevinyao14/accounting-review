#!/usr/bin/env node
/**
 * upload-memory.js — Seed production KV/Blob with Cowork memory layer data
 *
 * Reads all memory layer files from the Cowork workspace and uploads them
 * to the deployed memory-store API endpoint.
 *
 * Usage:
 *   node scripts/upload-memory.js --base-url https://your-app.vercel.app --source /path/to/Claude\ Cowork
 *   node scripts/upload-memory.js --base-url http://localhost:3000 --source ./cowork-data
 *   node scripts/upload-memory.js --base-url https://your-app.vercel.app --source /path --dry-run
 *   node scripts/upload-memory.js --base-url https://your-app.vercel.app --source /path --only globals
 *   node scripts/upload-memory.js --base-url https://your-app.vercel.app --source /path --only property --property "ASA Flats and Lofts"
 *
 * Options:
 *   --base-url   The deployed app URL (required)
 *   --source     Path to the Cowork workspace root (required)
 *   --dry-run    List what would be uploaded without actually uploading
 *   --only       Upload only: globals, properties, signals, errors, briefs, feedback, budgets
 *   --property   Upload only a specific property (used with --only property)
 *   --batch-size Number of items per bulk upload request (default: 10)
 *   --verify     Run verify check after upload
 */

import fs from "fs";
import path from "path";

// ── CLI Args ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
}
const hasFlag = (name) => args.includes(`--${name}`);

const BASE_URL   = getArg("base-url");
const SOURCE     = getArg("source");
const DRY_RUN    = hasFlag("dry-run");
const ONLY       = getArg("only");
const ONLY_PROP  = getArg("property");
const BATCH_SIZE = parseInt(getArg("batch-size") || "10", 10);
const VERIFY     = hasFlag("verify");

if (!BASE_URL || !SOURCE) {
  console.error("Usage: node scripts/upload-memory.js --base-url <url> --source <path>");
  process.exit(1);
}

const API = `${BASE_URL.replace(/\/$/, "")}/api/memory-store`;

// ── File helpers ──────────────────────────────────────────────────────────

function readJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (e) {
    console.warn(`  ⚠ Could not read ${filePath}: ${e.message}`);
    return null;
  }
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch (e) {
    console.warn(`  ⚠ Could not read ${filePath}: ${e.message}`);
    return null;
  }
}

function listFiles(dir, pattern) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => pattern.test(f)).map(f => path.join(dir, f));
}

function extractPropertyName(filename, suffix) {
  return filename.replace(suffix, "");
}

// ── API caller ────────────────────────────────────────────────────────────

async function postToApi(items) {
  if (DRY_RUN) {
    for (const item of items) {
      console.log(`  [DRY RUN] Would upload: type=${item.type} key=${item.key} property=${item.property || "—"} month=${item.month || "—"}`);
    }
    return { ok: true, results: items.map(() => ({ ok: true })) };
  }

  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "bulk", items }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }

  return await res.json();
}

async function uploadBatch(items, label) {
  console.log(`\n📦 ${label} (${items.length} items)`);
  const batches = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    batches.push(items.slice(i, i + BATCH_SIZE));
  }

  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    try {
      const result = await postToApi(batch);
      const batchOk = result.results ? result.results.filter(r => r.ok).length : batch.length;
      const batchFail = result.results ? result.results.filter(r => !r.ok).length : 0;
      succeeded += batchOk;
      failed += batchFail;
      if (batchFail > 0) {
        const failures = result.results.filter(r => !r.ok);
        for (const f of failures) {
          console.error(`  ✗ ${f.error} — ${JSON.stringify(f.item)}`);
        }
      }
      process.stdout.write(`  Batch ${i + 1}/${batches.length}: ${batchOk}✓ ${batchFail > 0 ? batchFail + "✗" : ""}\n`);
    } catch (e) {
      console.error(`  ✗ Batch ${i + 1} failed: ${e.message}`);
      failed += batch.length;
    }
  }

  console.log(`  → ${succeeded} succeeded, ${failed} failed`);
  return { succeeded, failed };
}

// ══════════════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════════════

async function main() {
  console.log(`\n🧠 Memory Layer Upload`);
  console.log(`   Source: ${SOURCE}`);
  console.log(`   Target: ${API}`);
  console.log(`   Mode:   ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  if (ONLY) console.log(`   Filter: ${ONLY}${ONLY_PROP ? ` (${ONLY_PROP})` : ""}`);

  const memoryDir    = path.join(SOURCE, "memory_layer");
  const structuredDir = path.join(memoryDir, "structured");
  const kbDir        = path.join(memoryDir, "kb");
  const patternsDir  = path.join(memoryDir, "patterns");
  const briefsDir    = path.join(memoryDir, "briefs");
  const signalsDir   = path.join(memoryDir, "signals");
  const errorsDir    = path.join(memoryDir, "errors");
  const feedbackDir  = path.join(memoryDir, "feedback");
  const budgetDir    = path.join(memoryDir, "budget");
  const feesDir      = path.join(memoryDir, "fees");

  let totalSucceeded = 0;
  let totalFailed = 0;

  // ── 1. Global KV data ─────────────────────────────────────────────────
  if (!ONLY || ONLY === "globals") {
    const globalItems = [];

    // Counter heuristics
    const ch = readJSON(path.join(structuredDir, "COUNTER_HEURISTICS.json"));
    if (ch) globalItems.push({ type: "global", key: "counter_heuristics", data: ch });

    // Portfolio intelligence
    const pi = readJSON(path.join(memoryDir, "PORTFOLIO_INTELLIGENCE.json"));
    if (pi) globalItems.push({ type: "global", key: "portfolio_intelligence", data: pi });

    // Risk scores
    const rs = readJSON(path.join(memoryDir, "PORTFOLIO_RISK_SCORES.json"));
    if (rs) globalItems.push({ type: "global", key: "risk_scores", data: rs });

    // Budget intelligence
    const bi = readJSON(path.join(memoryDir, "BUDGET_INTELLIGENCE.json"));
    if (bi) globalItems.push({ type: "global", key: "budget_intelligence", data: bi });

    // Fee verification
    const fv = readJSON(path.join(feesDir, "FEE_VERIFICATION_ENGINE.json"));
    if (fv) globalItems.push({ type: "global", key: "fee_verification", data: fv });

    // Fee rates
    const fr = readJSON(path.join(feesDir, "RATE_KB.json"));
    if (fr) globalItems.push({ type: "global", key: "fee_rates", data: fr });

    const r = await uploadBatch(globalItems, "Global KV Data");
    totalSucceeded += r.succeeded;
    totalFailed += r.failed;

    // Global Blobs (large files — uploaded individually, not bulk)
    console.log("\n📦 Global Blob Data");

    const rep = readJSON(path.join(memoryDir, "RELIABLE_ERROR_PATTERNS.json"));
    if (rep) {
      if (DRY_RUN) {
        console.log("  [DRY RUN] Would upload: reliable_error_patterns (Blob)");
      } else {
        try {
          const res = await fetch(API, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "global-blob", key: "reliable_error_patterns", data: rep }),
          });
          console.log(`  reliable_error_patterns → ${res.ok ? "✓" : "✗ " + res.status}`);
          totalSucceeded += res.ok ? 1 : 0;
          totalFailed += res.ok ? 0 : 1;
        } catch (e) {
          console.error(`  ✗ reliable_error_patterns: ${e.message}`);
          totalFailed++;
        }
      }
    }

    const xref = readJSON(path.join(memoryDir, "PORTFOLIO_IS_GL_CROSSREF.json"));
    if (xref) {
      if (DRY_RUN) {
        console.log("  [DRY RUN] Would upload: portfolio_crossref (Blob)");
      } else {
        try {
          const res = await fetch(API, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "global-blob", key: "portfolio_crossref", data: xref }),
          });
          console.log(`  portfolio_crossref → ${res.ok ? "✓" : "✗ " + res.status}`);
          totalSucceeded += res.ok ? 1 : 0;
          totalFailed += res.ok ? 0 : 1;
        } catch (e) {
          console.error(`  ✗ portfolio_crossref: ${e.message}`);
          totalFailed++;
        }
      }
    }
  }

  // ── 2. Per-property KV data ───────────────────────────────────────────
  if (!ONLY || ONLY === "properties" || ONLY === "property") {
    const propItems = [];

    // Memory baselines (structured/{Prop}_memory.json)
    const memoryFiles = listFiles(structuredDir, /_memory\.json$/);
    for (const f of memoryFiles) {
      const propName = extractPropertyName(path.basename(f), "_memory.json");
      if (ONLY_PROP && propName !== ONLY_PROP) continue;
      const data = readJSON(f);
      if (data) propItems.push({ type: "property", key: "baselines", property: propName, data });
    }

    // Property KB data (kb/{Prop}_data.json)
    const kbFiles = listFiles(kbDir, /_data\.json$/);
    for (const f of kbFiles) {
      const propName = extractPropertyName(path.basename(f), "_data.json");
      if (ONLY_PROP && propName !== ONLY_PROP) continue;
      const data = readJSON(f);
      if (data) propItems.push({ type: "property", key: "kb", property: propName, data });
    }

    // Patterns (patterns/{Prop}_patterns.json)
    const patternFiles = listFiles(patternsDir, /_patterns\.json$/);
    for (const f of patternFiles) {
      const propName = extractPropertyName(path.basename(f), "_patterns.json");
      if (ONLY_PROP && propName !== ONLY_PROP) continue;
      const data = readJSON(f);
      if (data) propItems.push({ type: "property", key: "patterns", property: propName, data });
    }

    // Budget analysis (budget/{Prop}_budget_analysis.json)
    const budgetFiles = listFiles(budgetDir, /_budget_analysis\.json$/);
    for (const f of budgetFiles) {
      const propName = extractPropertyName(path.basename(f), "_budget_analysis.json");
      if (ONLY_PROP && propName !== ONLY_PROP) continue;
      const data = readJSON(f);
      if (data) propItems.push({ type: "property", key: "budget", property: propName, data });
    }

    const r = await uploadBatch(propItems, "Per-Property KV Data");
    totalSucceeded += r.succeeded;
    totalFailed += r.failed;
  }

  // ── 3. Memory briefs ──────────────────────────────────────────────────
  if (!ONLY || ONLY === "briefs") {
    const briefItems = [];
    const briefFiles = listFiles(briefsDir, /_brief\.kb$/);
    for (const f of briefFiles) {
      // Filename: {Prop}_{YYYY-MM}_brief.kb — we store the latest one
      const basename = path.basename(f, "_brief.kb");
      const parts = basename.match(/^(.+)_(\d{4}-\d{2})$/);
      if (!parts) continue;
      const propName = parts[1];
      if (ONLY_PROP && propName !== ONLY_PROP) continue;
      const briefText = readText(f);
      if (briefText) briefItems.push({ type: "property", key: "brief", property: propName, data: briefText });
    }
    const r = await uploadBatch(briefItems, "Memory Briefs");
    totalSucceeded += r.succeeded;
    totalFailed += r.failed;
  }

  // ── 4. Signals (per property per month → Blob) ────────────────────────
  if (!ONLY || ONLY === "signals") {
    const signalItems = [];
    const signalFiles = listFiles(signalsDir, /_signals\.json$/);
    for (const f of signalFiles) {
      // Filename: {Prop}_{YYYY-MM}_signals.json
      const basename = path.basename(f, "_signals.json");
      const parts = basename.match(/^(.+)_(\d{4}-\d{2})$/);
      if (!parts) continue;
      const propName = parts[1];
      const month = parts[2];
      if (ONLY_PROP && propName !== ONLY_PROP) continue;
      const data = readJSON(f);
      if (data) signalItems.push({ type: "property-blob", key: "signals", property: propName, month, data });
    }
    const r = await uploadBatch(signalItems, "Signals (Blob)");
    totalSucceeded += r.succeeded;
    totalFailed += r.failed;
  }

  // ── 5. Errors (per property → Blob) ───────────────────────────────────
  if (!ONLY || ONLY === "errors") {
    const errorItems = [];
    const errorFiles = listFiles(errorsDir, /_errors\.json$/);
    for (const f of errorFiles) {
      const propName = extractPropertyName(path.basename(f), "_errors.json");
      if (ONLY_PROP && propName !== ONLY_PROP) continue;
      const data = readJSON(f);
      if (data) errorItems.push({ type: "property-blob", key: "errors", property: propName, data });
    }
    const r = await uploadBatch(errorItems, "GL Errors (Blob)");
    totalSucceeded += r.succeeded;
    totalFailed += r.failed;
  }

  // ── 6. Feedback (per property per quarter → Blob) ─────────────────────
  if (!ONLY || ONLY === "feedback") {
    const fbItems = [];
    const fbFiles = listFiles(feedbackDir, /_review.*\.json$/);
    for (const f of fbFiles) {
      const basename = path.basename(f, ".json");
      // Filename: {Prop}_{YYYY-Q#}_review[_v2].json
      const parts = basename.match(/^(.+)_(\d{4}-Q\d)_review(_v\d+)?$/);
      if (!parts) continue;
      const propName = parts[1];
      const quarter = parts[2];
      const version = parts[3] || "";
      if (ONLY_PROP && propName !== ONLY_PROP) continue;
      const data = readJSON(f);
      if (data) fbItems.push({ type: "property-blob", key: "feedback", property: propName, quarter: quarter + version, data });
    }
    const r = await uploadBatch(fbItems, "Feedback / Reviews (Blob)");
    totalSucceeded += r.succeeded;
    totalFailed += r.failed;
  }

  // ── Summary ───────────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(60));
  console.log(`✅ Upload complete: ${totalSucceeded} succeeded, ${totalFailed} failed`);
  if (DRY_RUN) console.log("   (DRY RUN — nothing was actually uploaded)");

  // ── Optional verify ───────────────────────────────────────────────────
  if (VERIFY && !DRY_RUN) {
    console.log("\n🔍 Running verification...");
    try {
      const res = await fetch(`${API}?action=verify`);
      const report = await res.json();
      console.log(JSON.stringify(report, null, 2));
    } catch (e) {
      console.error(`Verify failed: ${e.message}`);
    }
  }
}

main().catch(e => {
  console.error(`\n💥 Fatal error: ${e.message}`);
  process.exit(1);
});
