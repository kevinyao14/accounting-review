#!/usr/bin/env node
/**
 * upload-data.js — Re-upload raw GL/IS/Budget CSVs through the data-store API
 *
 * Reads CSV files from the Cowork workspace and uploads them through the
 * existing /api/data-store endpoint, which extracts, merges, and stores
 * the data in Vercel Blob/KV with full field support (including doc + jnl).
 *
 * Usage:
 *   node scripts/upload-data.js --base-url https://your-app.vercel.app --source /path/to/Claude\ Cowork
 *   node scripts/upload-data.js --base-url https://your-app.vercel.app --source /path --type gl
 *   node scripts/upload-data.js --base-url https://your-app.vercel.app --source /path --type is
 *   node scripts/upload-data.js --base-url https://your-app.vercel.app --source /path --property "Preston View"
 *   node scripts/upload-data.js --base-url https://your-app.vercel.app --source /path --dry-run
 *
 * Options:
 *   --base-url   The deployed app URL (required)
 *   --source     Path to the Cowork workspace with CSV files (required)
 *   --type       Upload only: gl, is, budget (default: all)
 *   --property   Upload only a specific property
 *   --dry-run    List what would be uploaded without actually uploading
 *   --period     Period tag for metadata (default: "2026-03")
 */

import fs from "fs";
import path from "path";

const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
}
const hasFlag = (name) => args.includes(`--${name}`);

const BASE_URL  = getArg("base-url");
const SOURCE    = getArg("source");
const DRY_RUN   = hasFlag("dry-run");
const TYPE      = getArg("type");       // gl, is, budget, or null for all
const ONLY_PROP = getArg("property");
const PERIOD    = getArg("period") || "2026-03";

if (!BASE_URL || !SOURCE) {
  console.error("Usage: node scripts/upload-data.js --base-url <url> --source <path>");
  process.exit(1);
}

const API = `${BASE_URL.replace(/\/$/, "")}/api/data-store`;

// ── Discover CSV files ─────────────────────────────────────────────────────

function discoverCSVs(sourceDir, suffix) {
  const files = [];
  for (const f of fs.readdirSync(sourceDir)) {
    if (!f.endsWith(suffix)) continue;
    const propName = f.replace(suffix, "");
    if (ONLY_PROP && propName !== ONLY_PROP) continue;
    files.push({ property: propName, filePath: path.join(sourceDir, f) });
  }
  return files.sort((a, b) => a.property.localeCompare(b.property));
}

// ── Upload a single CSV ────────────────────────────────────────────────────

async function uploadCSV(property, filePath, dataType) {
  const rawCsv = fs.readFileSync(filePath, "utf-8");
  const body = { property, period: PERIOD };

  if (dataType === "gl") { body.action = "ingest-gl"; body.rawGl = rawCsv; }
  else if (dataType === "is") { body.action = "ingest-is"; body.rawIs = rawCsv; }
  else if (dataType === "budget") { body.action = "ingest-budget"; body.rawBudget = rawCsv; }

  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const stats = { uploaded: 0, skipped: 0, errors: 0 };
  const types = TYPE ? [TYPE] : ["gl", "is", "budget-2025", "budget-2026"];

  for (const dataType of types) {
    const suffix = dataType === "gl" ? "_GL.csv"
                 : dataType === "is" ? "_IS.csv"
                 : dataType === "budget-2025" ? "_Budget_2025.csv"
                 : dataType === "budget-2026" ? "_Budget_2026.csv"
                 : dataType === "budget" ? "_Budget_2026.csv"
                 : null;
    if (!suffix) continue;
    const uploadType = dataType.startsWith("budget") ? "budget" : dataType;

    const files = discoverCSVs(SOURCE, suffix);
    if (!files.length) {
      console.log(`\nNo ${dataType.toUpperCase()} CSV files found.`);
      continue;
    }

    console.log(`\n=== Uploading ${files.length} ${dataType.toUpperCase()} files ===\n`);

    for (const { property, filePath } of files) {
      if (DRY_RUN) {
        console.log(`  [DRY] ${property} (${dataType})`);
        stats.skipped++;
        continue;
      }

      try {
        const result = await uploadCSV(property, filePath, uploadType);
        const detail = uploadType === "gl"
          ? `${result.glMonthsInIndex || "?"} months`
          : `${result.totalAccounts || "?"} accounts`;
        console.log(`  [OK] ${property.padEnd(45)} ${detail}`);
        stats.uploaded++;
      } catch (e) {
        console.error(`  [ERR] ${property}: ${e.message}`);
        stats.errors++;
      }
    }
  }

  console.log(`\n=== Done ===`);
  console.log(`  Uploaded: ${stats.uploaded}`);
  console.log(`  Skipped:  ${stats.skipped}`);
  console.log(`  Errors:   ${stats.errors}`);
}

main().catch(e => { console.error(e); process.exit(1); });
