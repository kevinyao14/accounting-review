/**
 * seed-coa.js — Seed COA data from the Excel-derived JSON
 *
 * Usage:
 *   node scripts/seed-coa.js --base-url https://property-accounting-review.vercel.app
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
};

const BASE_URL = getArg("base-url");
if (!BASE_URL) {
  console.error("Usage: node scripts/seed-coa.js --base-url <url>");
  process.exit(1);
}

const seedPath = path.join(__dirname, "coa-seed.json");
const seedData = JSON.parse(fs.readFileSync(seedPath, "utf-8"));

const API = `${BASE_URL.replace(/\/$/, "")}/api/coa`;

async function main() {
  console.log(`Seeding COA to ${API}...`);
  console.log(`  ${seedData.stylAccounts.length} STYL accounts`);
  console.log(`  Maps: ${Object.keys(seedData.maps).join(", ")}`);

  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "seed", ...seedData }),
  });

  const data = await res.json();
  if (!res.ok) {
    console.error("  [ERR]", data.error);
    process.exit(1);
  }
  console.log("  [OK]", data.message || `Seeded ${data.seeded} accounts`);
}

main().catch(e => { console.error(e); process.exit(1); });
