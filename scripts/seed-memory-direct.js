#!/usr/bin/env node
/**
 * seed-memory-direct.js — Write memory layer data directly to Upstash KV
 *
 * This bypasses the /api/memory-store endpoint and writes directly to KV
 * using the REST API. Faster and works without the app being deployed.
 *
 * Usage:
 *   node scripts/seed-memory-direct.js --source "/path/to/Claude Cowork"
 *   node scripts/seed-memory-direct.js --source "/path/to/Claude Cowork" --dry-run
 *   node scripts/seed-memory-direct.js --source "/path/to/Claude Cowork" --only globals
 *
 * Reads KV_REST_API_URL and KV_REST_API_TOKEN from .env.local in the repo root.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Load .env.local ──────────────────────────────────────────────────────
function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) {
    console.error("No .env.local found at", envPath);
    process.exit(1);
  }
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  const env = {};
  for (const line of lines) {
    const m = line.match(/^(\w+)="?([^"]*)"?$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

const ENV = loadEnv();
const KV_URL = ENV.KV_REST_API_URL;
const KV_TOKEN = ENV.KV_REST_API_TOKEN;

if (!KV_URL || !KV_TOKEN) {
  console.error("Missing KV_REST_API_URL or KV_REST_API_TOKEN in .env.local");
  process.exit(1);
}

// ── CLI ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i+1] ? args[i+1] : null; };
const hasFlag = (name) => args.includes(`--${name}`);

const SOURCE = getArg("source");
const DRY_RUN = hasFlag("dry-run");
const ONLY = getArg("only");

if (!SOURCE) {
  console.error("Usage: node scripts/seed-memory-direct.js --source /path/to/Claude\\ Cowork");
  process.exit(1);
}

const MEMORY = path.join(SOURCE, "memory_layer");
if (!fs.existsSync(MEMORY)) {
  console.error("memory_layer directory not found at", MEMORY);
  process.exit(1);
}

// ── KV helpers ───────────────────────────────────────────────────────────
let kvOps = 0;
async function kvSet(key, value) {
  if (DRY_RUN) return;
  const res = await fetch(KV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(["SET", key, value]),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`KV SET ${key}: ${res.status} ${text}`);
  }
  kvOps++;
  // Rate-limit: Upstash free tier allows ~1000 req/s, but let's be polite
  if (kvOps % 50 === 0) await new Promise(r => setTimeout(r, 200));
}

async function kvGet(key) {
  const res = await fetch(KV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(["GET", key]),
  });
  const { result } = await res.json();
  return result;
}

// ── File helpers ─────────────────────────────────────────────────────────
function readJSON(fp) {
  try { return JSON.parse(fs.readFileSync(fp, "utf-8")); }
  catch { return null; }
}
function readText(fp) {
  try { return fs.readFileSync(fp, "utf-8"); }
  catch { return null; }
}
function listFiles(dir, re) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => re.test(f)).map(f => path.join(dir, f));
}
function enc(name) { return encodeURIComponent(name).replace(/%20/g, "_"); }

// ══════════════════════════════════════════════════════════════════════════
let ok = 0, fail = 0;

async function store(key, data) {
  const val = typeof data === "string" ? data : JSON.stringify(data);
  const kb = (val.length / 1024).toFixed(1);
  if (DRY_RUN) {
    console.log(`  [DRY] ${key} (${kb} KB)`);
    ok++;
    return;
  }
  try {
    await kvSet(key, val);
    ok++;
  } catch (e) {
    console.error(`  ✗ ${key}: ${e.message}`);
    fail++;
  }
}

async function main() {
  console.log("\n🧠 Memory Layer → Upstash KV Direct Seed");
  console.log(`   Source:  ${SOURCE}`);
  console.log(`   KV URL:  ${KV_URL}`);
  console.log(`   Mode:    ${DRY_RUN ? "DRY RUN" : "LIVE"}\n`);

  // ── 1. GLOBAL DATA ──────────────────────────────────────────────────
  if (!ONLY || ONLY === "globals") {
    console.log("📦 Global data...");
    const globals = [
      ["memory:counter_heuristics",    readJSON(path.join(MEMORY, "structured/COUNTER_HEURISTICS.json"))],
      ["memory:portfolio_intelligence", readJSON(path.join(MEMORY, "PORTFOLIO_INTELLIGENCE.json"))],
      ["memory:risk_scores",           readJSON(path.join(MEMORY, "PORTFOLIO_RISK_SCORES.json"))],
      ["memory:budget_intelligence",   readJSON(path.join(MEMORY, "BUDGET_INTELLIGENCE.json"))],
      ["memory:fee_verification",      readJSON(path.join(MEMORY, "fees/FEE_VERIFICATION_ENGINE.json"))],
      ["memory:fee_rates",             readJSON(path.join(MEMORY, "fees/RATE_KB.json"))],
      ["memory:reliable_error_patterns", readJSON(path.join(MEMORY, "RELIABLE_ERROR_PATTERNS.json"))],
      ["memory:portfolio_crossref",      readJSON(path.join(MEMORY, "PORTFOLIO_IS_GL_CROSSREF.json"))],
    ];
    for (const [key, data] of globals) {
      if (!data) { console.log(`  skip: ${key} (file not found)`); continue; }
      await store(key, data);
      if (!DRY_RUN) console.log(`  ✓ ${key} (${(JSON.stringify(data).length / 1024).toFixed(1)} KB)`);
    }
  }

  // ── 2. PER-PROPERTY DATA ────────────────────────────────────────────
  const propIndex = [];

  if (!ONLY || ONLY === "properties") {
    console.log("\n📦 Per-property KV data...");

    // Baselines
    const memFiles = listFiles(path.join(MEMORY, "structured"), /_memory\.json$/);
    for (const f of memFiles) {
      const prop = path.basename(f).replace("_memory.json", "");
      const data = readJSON(f);
      if (!data) continue;
      await store(`memory:prop:${enc(prop)}:baselines`, data);
      if (!propIndex.includes(prop)) propIndex.push(prop);
    }
    console.log(`  baselines: ${memFiles.length} files`);

    // KB
    const kbFiles = listFiles(path.join(MEMORY, "kb"), /_data\.json$/);
    for (const f of kbFiles) {
      const prop = path.basename(f).replace("_data.json", "");
      const data = readJSON(f);
      if (!data) continue;
      await store(`memory:prop:${enc(prop)}:kb`, data);
      if (!propIndex.includes(prop)) propIndex.push(prop);
    }
    console.log(`  kb: ${kbFiles.length} files`);

    // Patterns
    const patFiles = listFiles(path.join(MEMORY, "patterns"), /_patterns\.json$/);
    for (const f of patFiles) {
      const prop = path.basename(f).replace("_patterns.json", "");
      const data = readJSON(f);
      if (!data) continue;
      await store(`memory:prop:${enc(prop)}:patterns`, data);
      if (!propIndex.includes(prop)) propIndex.push(prop);
    }
    console.log(`  patterns: ${patFiles.length} files`);

    // Budget analysis
    const budFiles = listFiles(path.join(MEMORY, "budget"), /_budget_analysis\.json$/);
    for (const f of budFiles) {
      const prop = path.basename(f).replace("_budget_analysis.json", "");
      const data = readJSON(f);
      if (!data) continue;
      await store(`memory:prop:${enc(prop)}:budget`, data);
      if (!propIndex.includes(prop)) propIndex.push(prop);
    }
    console.log(`  budgets: ${budFiles.length} files`);
  }

  // ── 3. BRIEFS ──────────────────────────────────────────────────────
  if (!ONLY || ONLY === "briefs" || ONLY === "properties") {
    console.log("\n📦 Memory briefs...");
    const briefFiles = listFiles(path.join(MEMORY, "briefs"), /_brief\.kb$/);
    const latestBriefs = {};
    for (const f of briefFiles) {
      const bn = path.basename(f, "_brief.kb");
      const m = bn.match(/^(.+)_(\d{4}-\d{2})$/);
      if (!m) continue;
      const [, prop, month] = m;
      if (!latestBriefs[prop] || month > latestBriefs[prop].month) {
        latestBriefs[prop] = { month, file: f };
      }
    }
    for (const [prop, info] of Object.entries(latestBriefs)) {
      const text = readText(info.file);
      if (!text) continue;
      await store(`memory:prop:${enc(prop)}:brief`, text);
      if (!propIndex.includes(prop)) propIndex.push(prop);
    }
    console.log(`  briefs: ${Object.keys(latestBriefs).length} properties (latest month each)`);
  }

  // ── 4. SIGNALS ─────────────────────────────────────────────────────
  // Signals are small (2-10KB each), so we store them directly in KV
  // rather than needing Vercel Blob. The memory-context endpoint needs
  // to be aware of this — we store a "kv:" prefixed pointer in the
  // blob URL key so it knows to read from KV instead.
  if (!ONLY || ONLY === "signals") {
    console.log("\n📦 Signals...");
    const sigFiles = listFiles(path.join(MEMORY, "signals"), /_signals\.json$/);
    const sigIndex = {};
    let sigCount = 0;
    for (const f of sigFiles) {
      const bn = path.basename(f, "_signals.json");
      const m = bn.match(/^(.+)_(\d{4}-\d{2})$/);
      if (!m) continue;
      const [, prop, month] = m;
      const data = readJSON(f);
      if (!data) continue;
      await store(`memory:prop:${enc(prop)}:signal:${month}`, data);
      // Store pointer for memory-context.js blob lookup
      await store(`memory:blob:${enc(prop)}:signals:${month}`, `kv:memory:prop:${enc(prop)}:signal:${month}`);
      if (!sigIndex[prop]) sigIndex[prop] = [];
      if (!sigIndex[prop].includes(month)) sigIndex[prop].push(month);
      sigCount++;
    }
    // Store signal month indexes
    for (const [prop, months] of Object.entries(sigIndex)) {
      months.sort();
      await store(`memory:prop:${enc(prop)}:signals_index`, months);
      if (!propIndex.includes(prop)) propIndex.push(prop);
    }
    console.log(`  signals: ${sigCount} files across ${Object.keys(sigIndex).length} properties`);
  }

  // ── 5. GL ERRORS ───────────────────────────────────────────────────
  if (!ONLY || ONLY === "errors") {
    console.log("\n📦 GL errors...");
    const errFiles = listFiles(path.join(MEMORY, "errors"), /_errors\.json$/);
    for (const f of errFiles) {
      const prop = path.basename(f).replace("_errors.json", "");
      const data = readJSON(f);
      if (!data) continue;
      await store(`memory:prop:${enc(prop)}:errors`, data);
      await store(`memory:blob:${enc(prop)}:errors`, `kv:memory:prop:${enc(prop)}:errors`);
      if (!propIndex.includes(prop)) propIndex.push(prop);
    }
    console.log(`  errors: ${errFiles.length} files`);
  }

  // ── 6. PROPERTY INDEX ──────────────────────────────────────────────
  if (propIndex.length > 0) {
    propIndex.sort();
    await store("memory:property_index", propIndex);
    console.log(`\n📋 Property index: ${propIndex.length} properties`);
  }

  // ── SUMMARY ────────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(50));
  console.log(`✅ Done: ${ok} stored, ${fail} failed, ${kvOps} KV operations`);
  if (DRY_RUN) console.log("   (DRY RUN — nothing was written)");

  // ── VERIFY ─────────────────────────────────────────────────────────
  if (!DRY_RUN) {
    console.log("\n🔍 Quick verify...");
    const ch = await kvGet("memory:counter_heuristics");
    console.log(`  counter_heuristics: ${ch ? "✓ present" : "✗ MISSING"} (${ch ? (ch.length/1024).toFixed(1) + " KB" : ""})`);
    const pi = await kvGet("memory:property_index");
    const props = pi ? JSON.parse(pi) : [];
    console.log(`  property_index: ${props.length} properties`);
    if (props.length > 0) {
      const sample = props[0];
      const brief = await kvGet(`memory:prop:${enc(sample)}:brief`);
      console.log(`  ${sample} brief: ${brief ? "✓ present" : "✗ MISSING"} (${brief ? (brief.length/1024).toFixed(1) + " KB" : ""})`);
      const sigIdx = await kvGet(`memory:prop:${enc(sample)}:signals_index`);
      console.log(`  ${sample} signals: ${sigIdx ? JSON.parse(sigIdx).length + " months" : "✗ MISSING"}`);
    }
  }
}

main().catch(e => {
  console.error("\n💥 Fatal:", e.message);
  process.exit(1);
});
