import { kvGet, kvSet } from "../lib/storage.js";

// ── Chart of Accounts API ────────────────────────────────────────────────
// KV keys:
//   coa:styl:accounts    — [{gl, name}, ...] master STYL chart of accounts
//   coa:map:{mapKey}     — {label, mappings: {stylGl: {gl, name, notes, updatedAt}}}
//
// GET  /api/coa                       — return full COA data (styl + all maps)
// POST /api/coa  {action:"save", ...} — save changes (password protected)
// POST /api/coa  {action:"seed", ...} — seed initial data

const KV_STYL = "coa:styl:accounts";
const kvMapKey = (mapKey) => `coa:map:${mapKey}`;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    // ── GET: return full COA ──
    if (req.method === "GET") {
      const stylRaw = await kvGet(KV_STYL);
      const stylAccounts = stylRaw ? JSON.parse(stylRaw) : [];

      // Load all maps (for now just invesco, but extensible)
      const mapKeys = ["invesco"];
      const maps = {};
      for (const mk of mapKeys) {
        const raw = await kvGet(kvMapKey(mk));
        if (raw) maps[mk] = JSON.parse(raw);
      }

      return res.status(200).json({ stylAccounts, maps });
    }

    // ── POST ──
    if (req.method === "POST") {
      const { action, password } = req.body;

      // ── Seed: initialize from seed data (no password needed, one-time) ──
      if (action === "seed") {
        const { stylAccounts, maps } = req.body;
        if (!stylAccounts || !maps) {
          return res.status(400).json({ error: "stylAccounts and maps required" });
        }

        // Only seed if empty
        const existing = await kvGet(KV_STYL);
        if (existing) {
          return res.status(200).json({ ok: true, message: "Already seeded" });
        }

        await kvSet(KV_STYL, JSON.stringify(stylAccounts));
        for (const [mk, mapData] of Object.entries(maps)) {
          await kvSet(kvMapKey(mk), JSON.stringify(mapData));
        }

        return res.status(200).json({ ok: true, seeded: stylAccounts.length });
      }

      // ── All other actions require KB password ──
      if (!password) {
        return res.status(400).json({ error: "Password required" });
      }
      const expected = process.env.KB_PASSWORD;
      if (!expected || password !== expected) {
        return res.status(401).json({ error: "Incorrect password" });
      }

      // ── Save: update STYL accounts and/or map data ──
      if (action === "save") {
        const { stylAccounts, mapKey, mapData } = req.body;

        if (stylAccounts) {
          await kvSet(KV_STYL, JSON.stringify(stylAccounts));
        }

        if (mapKey && mapData) {
          await kvSet(kvMapKey(mapKey), JSON.stringify(mapData));
        }

        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ error: "Unknown action" });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error("COA error:", e);
    return res.status(500).json({ error: e.message });
  }
}
