import { kvGet, kvSet, kvDel } from "../lib/storage.js";

// ── Chart of Accounts API ────────────────────────────────────────────────
// KV keys:
//   coa:styl:accounts                     — [{gl, name}, ...] master STYL chart
//   coa:mapkeys                           — [{key, label}, ...] group mapping list
//   coa:map:{mapKey}                      — {label, mappings: {stylGl: {gl, name, notes, updatedAt}}}
//   coa:propkeys:{mapKey}                 — [{key, label}, ...] property list per group
//   coa:propmap:{mapKey}:{propKey}        — {label, mappings: {stylGl: {gl, name, updatedAt}}}

const KV_STYL = "coa:styl:accounts";
const KV_MAPKEYS = "coa:mapkeys";
const kvMapKey = (mapKey) => `coa:map:${mapKey}`;
const kvPropKeys = (mapKey) => `coa:propkeys:${mapKey}`;
const kvPropMap = (mapKey, propKey) => `coa:propmap:${mapKey}:${propKey}`;

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

      const mkRaw = await kvGet(KV_MAPKEYS);
      let mapKeys = mkRaw ? JSON.parse(mkRaw) : [];

      // Backward compat
      if (mapKeys.length === 0) {
        const invRaw = await kvGet(kvMapKey("invesco"));
        if (invRaw) {
          mapKeys = [{ key: "invesco", label: "Invesco" }];
          await kvSet(KV_MAPKEYS, JSON.stringify(mapKeys));
        }
      }

      const maps = {};
      const propKeys = {};
      const propMaps = {};
      for (const mk of mapKeys) {
        const raw = await kvGet(kvMapKey(mk.key));
        if (raw) maps[mk.key] = JSON.parse(raw);

        // Load property keys for this group
        const pkRaw = await kvGet(kvPropKeys(mk.key));
        const pks = pkRaw ? JSON.parse(pkRaw) : [];
        if (pks.length > 0) {
          propKeys[mk.key] = pks;
          propMaps[mk.key] = {};
          for (const pk of pks) {
            const pmRaw = await kvGet(kvPropMap(mk.key, pk.key));
            if (pmRaw) propMaps[mk.key][pk.key] = JSON.parse(pmRaw);
          }
        }
      }

      return res.status(200).json({ stylAccounts, mapKeys, maps, propKeys, propMaps });
    }

    // ── POST ──
    if (req.method === "POST") {
      const { action, password } = req.body;

      // ── Seed (no password) ──
      if (action === "seed") {
        const { stylAccounts, maps } = req.body;
        if (!stylAccounts || !maps) return res.status(400).json({ error: "stylAccounts and maps required" });
        const existing = await kvGet(KV_STYL);
        if (existing) return res.status(200).json({ ok: true, message: "Already seeded" });

        await kvSet(KV_STYL, JSON.stringify(stylAccounts));
        const mapKeys = [];
        for (const [mk, mapData] of Object.entries(maps)) {
          await kvSet(kvMapKey(mk), JSON.stringify(mapData));
          mapKeys.push({ key: mk, label: mapData.label || mk });
        }
        await kvSet(KV_MAPKEYS, JSON.stringify(mapKeys));
        return res.status(200).json({ ok: true, seeded: stylAccounts.length });
      }

      // ── All other actions require KB password ──
      if (!password) return res.status(400).json({ error: "Password required" });
      const expected = process.env.KB_PASSWORD;
      if (!expected || password !== expected) return res.status(401).json({ error: "Incorrect password" });

      // ── Save: update STYL accounts, group map, and/or property map(s) ──
      // Accepts either a single propKey/propMapData OR an array `properties: [{propKey, propMapData}]`
      if (action === "save") {
        const { stylAccounts, mapKey, mapData, propKey, propMapData, properties } = req.body;
        if (stylAccounts) await kvSet(KV_STYL, JSON.stringify(stylAccounts));
        if (mapKey && mapData) await kvSet(kvMapKey(mapKey), JSON.stringify(mapData));
        if (mapKey && propKey && propMapData) await kvSet(kvPropMap(mapKey, propKey), JSON.stringify(propMapData));
        if (mapKey && Array.isArray(properties)) {
          for (const p of properties) {
            if (p?.propKey && p?.propMapData) await kvSet(kvPropMap(mapKey, p.propKey), JSON.stringify(p.propMapData));
          }
        }
        return res.status(200).json({ ok: true });
      }

      // ── Create group (idempotent) ──
      if (action === "create-map") {
        const { mapKey, label } = req.body;
        if (!mapKey || !label) return res.status(400).json({ error: "mapKey and label required" });
        const mkRaw = await kvGet(KV_MAPKEYS);
        const mapKeys = mkRaw ? JSON.parse(mkRaw) : [];
        if (mapKeys.some(m => m.key === mapKey)) return res.status(200).json({ ok: true, mapKeys, existed: true });
        mapKeys.push({ key: mapKey, label });
        await kvSet(KV_MAPKEYS, JSON.stringify(mapKeys));
        await kvSet(kvMapKey(mapKey), JSON.stringify({ label, mappings: {} }));
        return res.status(200).json({ ok: true, mapKeys });
      }

      // ── Delete group (and its properties) ──
      if (action === "delete-map") {
        const { mapKey } = req.body;
        if (!mapKey) return res.status(400).json({ error: "mapKey required" });
        const mkRaw = await kvGet(KV_MAPKEYS);
        let mapKeys = mkRaw ? JSON.parse(mkRaw) : [];
        mapKeys = mapKeys.filter(m => m.key !== mapKey);
        await kvSet(KV_MAPKEYS, JSON.stringify(mapKeys));
        await kvDel(kvMapKey(mapKey));
        // Clean up properties
        const pkRaw = await kvGet(kvPropKeys(mapKey));
        const pks = pkRaw ? JSON.parse(pkRaw) : [];
        for (const pk of pks) await kvDel(kvPropMap(mapKey, pk.key));
        await kvDel(kvPropKeys(mapKey));
        return res.status(200).json({ ok: true, mapKeys });
      }

      // ── Create property (idempotent) ──
      if (action === "create-prop") {
        const { mapKey, propKey, label } = req.body;
        if (!mapKey || !propKey || !label) return res.status(400).json({ error: "mapKey, propKey, and label required" });
        const pkRaw = await kvGet(kvPropKeys(mapKey));
        const pks = pkRaw ? JSON.parse(pkRaw) : [];
        if (pks.some(p => p.key === propKey)) return res.status(200).json({ ok: true, propKeys: pks, existed: true });
        pks.push({ key: propKey, label });
        await kvSet(kvPropKeys(mapKey), JSON.stringify(pks));
        await kvSet(kvPropMap(mapKey, propKey), JSON.stringify({ label, mappings: {} }));
        return res.status(200).json({ ok: true, propKeys: pks });
      }

      // ── Delete property ──
      if (action === "delete-prop") {
        const { mapKey, propKey } = req.body;
        if (!mapKey || !propKey) return res.status(400).json({ error: "mapKey and propKey required" });
        const pkRaw = await kvGet(kvPropKeys(mapKey));
        let pks = pkRaw ? JSON.parse(pkRaw) : [];
        pks = pks.filter(p => p.key !== propKey);
        await kvSet(kvPropKeys(mapKey), JSON.stringify(pks));
        await kvDel(kvPropMap(mapKey, propKey));
        return res.status(200).json({ ok: true, propKeys: pks });
      }

      return res.status(400).json({ error: "Unknown action" });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error("COA error:", e);
    return res.status(500).json({ error: e.message });
  }
}
