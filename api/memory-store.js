import { put, del } from "@vercel/blob";

export const config = { maxDuration: 60 };

const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

// ── KV helpers (same pattern as all other endpoints) ──────────────────────

async function kvGet(key) {
  const res = await fetch(KV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(["GET", key]),
  });
  const { result } = await res.json();
  return result;
}

async function kvSet(key, value) {
  await fetch(KV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(["SET", key, value]),
  });
}

async function kvDel(key) {
  await fetch(KV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(["DEL", key]),
  });
}

function encodePropertyName(name) {
  return encodeURIComponent(name).replace(/%20/g, "_");
}

function slugify(name) {
  return (name || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
}

// ── Key schema ────────────────────────────────────────────────────────────
//
// GLOBAL (KV):
//   memory:counter_heuristics        → JSON array of CH rules
//   memory:portfolio_intelligence    → JSON portfolio synthesis
//   memory:risk_scores               → JSON property risk rankings
//   memory:budget_intelligence       → JSON category reliability
//   memory:fee_verification          → JSON fee engine config
//   memory:fee_rates                 → JSON rate KB
//   memory:property_index            → JSON array of property names in memory
//
// PER-PROPERTY (KV — small/fast-access):
//   memory:prop:{enc}:baselines      → JSON IS statistical baselines
//   memory:prop:{enc}:kb             → JSON property KB data (fixed costs, accruals, contracts)
//   memory:prop:{enc}:patterns       → JSON volatility/trend patterns
//   memory:prop:{enc}:brief          → text memory brief (.kb format)
//   memory:prop:{enc}:budget         → JSON property budget analysis
//
// PER-PROPERTY (Blob — larger files):
//   memory/{slug}/errors.json        → GL error detector output
//   memory/{slug}/signals/{YYYY-MM}.json → monthly signal files
//   memory/{slug}/feedback/{quarter}.json → review feedback
//
// LARGE GLOBAL (Blob):
//   memory/reliable_error_patterns.json
//   memory/portfolio_crossref.json

const GLOBAL_KV_KEYS = [
  "counter_heuristics",
  "portfolio_intelligence",
  "risk_scores",
  "budget_intelligence",
  "fee_verification",
  "fee_rates",
];

const PROPERTY_KV_KEYS = [
  "baselines",
  "kb",
  "patterns",
  "brief",
  "budget",
];

// ── Helpers ───────────────────────────────────────────────────────────────

async function updatePropertyIndex(propertyName) {
  const raw = await kvGet("memory:property_index");
  const index = raw ? JSON.parse(raw) : [];
  if (!index.includes(propertyName)) {
    index.push(propertyName);
    index.sort();
    await kvSet("memory:property_index", JSON.stringify(index));
  }
}

async function blobPut(path, data) {
  const content = typeof data === "string" ? data : JSON.stringify(data);
  return await put(path, content, {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false,
  });
}

async function blobGet(url) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${BLOB_TOKEN}` },
  });
  if (!res.ok) return null;
  return await res.json();
}

// ══════════════════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    // ── GET ───────────────────────────────────────────────────────────────
    if (req.method === "GET") {
      const { type, key, property, month, quarter, action } = req.query;

      // Health check / verify
      if (action === "verify") {
        return await handleVerify(res);
      }

      // List all properties in memory
      if (type === "property-list") {
        const raw = await kvGet("memory:property_index");
        return res.status(200).json(raw ? JSON.parse(raw) : []);
      }

      // Global KV data
      if (type === "global") {
        if (!key || !GLOBAL_KV_KEYS.includes(key)) {
          return res.status(400).json({ error: `key must be one of: ${GLOBAL_KV_KEYS.join(", ")}` });
        }
        const raw = await kvGet(`memory:${key}`);
        return res.status(200).json(raw ? JSON.parse(raw) : null);
      }

      // Global Blob data (large files)
      if (type === "global-blob") {
        if (key === "reliable_error_patterns") {
          const idxRaw = await kvGet("memory:blob:reliable_error_patterns");
          if (!idxRaw) return res.status(200).json(null);
          const data = await blobGet(idxRaw);
          return res.status(200).json(data);
        }
        if (key === "portfolio_crossref") {
          const idxRaw = await kvGet("memory:blob:portfolio_crossref");
          if (!idxRaw) return res.status(200).json(null);
          const data = await blobGet(idxRaw);
          return res.status(200).json(data);
        }
        return res.status(400).json({ error: "Invalid global-blob key" });
      }

      // Per-property KV data
      if (type === "property") {
        if (!property) return res.status(400).json({ error: "property required" });
        if (!key || !PROPERTY_KV_KEYS.includes(key)) {
          return res.status(400).json({ error: `key must be one of: ${PROPERTY_KV_KEYS.join(", ")}` });
        }
        const enc = encodePropertyName(property);
        const raw = await kvGet(`memory:prop:${enc}:${key}`);
        // Brief is stored as plain text, everything else as JSON
        if (key === "brief") return res.status(200).json({ brief: raw || null });
        return res.status(200).json(raw ? JSON.parse(raw) : null);
      }

      // Per-property Blob data (errors, signals, feedback)
      if (type === "property-blob") {
        if (!property) return res.status(400).json({ error: "property required" });
        const slug = slugify(property);

        if (key === "errors") {
          const idxRaw = await kvGet(`memory:blob:${encodePropertyName(property)}:errors`);
          if (!idxRaw) return res.status(200).json(null);
          const data = await blobGet(idxRaw);
          return res.status(200).json(data);
        }

        if (key === "signals" && month) {
          const idxRaw = await kvGet(`memory:blob:${encodePropertyName(property)}:signals:${month}`);
          if (!idxRaw) return res.status(200).json(null);
          const data = await blobGet(idxRaw);
          return res.status(200).json(data);
        }

        if (key === "signals-index") {
          const raw = await kvGet(`memory:prop:${encodePropertyName(property)}:signals_index`);
          return res.status(200).json(raw ? JSON.parse(raw) : []);
        }

        if (key === "feedback" && quarter) {
          const idxRaw = await kvGet(`memory:blob:${encodePropertyName(property)}:feedback:${quarter}`);
          if (!idxRaw) return res.status(200).json(null);
          const data = await blobGet(idxRaw);
          return res.status(200).json(data);
        }

        return res.status(400).json({ error: "Invalid property-blob key (errors, signals, signals-index, feedback)" });
      }

      return res.status(400).json({ error: "Invalid type" });
    }

    // ── POST ──────────────────────────────────────────────────────────────
    if (req.method === "POST") {
      const { type, key, property, month, quarter, data, action, items } = req.body;

      // Bulk upload — array of { type, key, property, month, quarter, data }
      if (action === "bulk") {
        if (!items || !Array.isArray(items)) {
          return res.status(400).json({ error: "items[] required for bulk upload" });
        }
        const results = [];
        for (const item of items) {
          try {
            const r = await processWrite(item);
            results.push({ ok: true, ...r });
          } catch (e) {
            results.push({ ok: false, error: e.message, item: { type: item.type, key: item.key, property: item.property } });
          }
        }
        return res.status(200).json({ ok: true, results, total: items.length, succeeded: results.filter(r => r.ok).length });
      }

      // Single write
      const result = await processWrite({ type, key, property, month, quarter, data });
      return res.status(200).json({ ok: true, ...result });
    }

    // ── DELETE ─────────────────────────────────────────────────────────────
    if (req.method === "DELETE") {
      const { type, key, property, month, quarter } = req.body;

      if (type === "global" && key && GLOBAL_KV_KEYS.includes(key)) {
        await kvDel(`memory:${key}`);
        return res.status(200).json({ ok: true });
      }

      if (type === "property" && property && key && PROPERTY_KV_KEYS.includes(key)) {
        const enc = encodePropertyName(property);
        await kvDel(`memory:prop:${enc}:${key}`);
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ error: "Invalid delete params" });
    }

    return res.status(405).json({ error: "Method not allowed" });

  } catch (e) {
    console.error("Memory store API error:", e);
    return res.status(500).json({ error: e.message });
  }
}

// ── Process a single write (used by both single POST and bulk) ────────────
async function processWrite({ type, key, property, month, quarter, data }) {
  if (data === undefined || data === null) throw new Error("data required");

  // Global KV
  if (type === "global" && GLOBAL_KV_KEYS.includes(key)) {
    const value = typeof data === "string" ? data : JSON.stringify(data);
    await kvSet(`memory:${key}`, value);
    return { stored: `memory:${key}`, storage: "kv" };
  }

  // Global Blob (large files)
  if (type === "global-blob") {
    if (key === "reliable_error_patterns") {
      const blob = await blobPut("memory/reliable_error_patterns.json", data);
      await kvSet("memory:blob:reliable_error_patterns", blob.url);
      return { stored: "memory/reliable_error_patterns.json", storage: "blob", url: blob.url };
    }
    if (key === "portfolio_crossref") {
      const blob = await blobPut("memory/portfolio_crossref.json", data);
      await kvSet("memory:blob:portfolio_crossref", blob.url);
      return { stored: "memory/portfolio_crossref.json", storage: "blob", url: blob.url };
    }
    throw new Error("Invalid global-blob key");
  }

  // Per-property KV
  if (type === "property" && property && PROPERTY_KV_KEYS.includes(key)) {
    const enc = encodePropertyName(property);
    // Brief is stored as plain text
    const value = key === "brief"
      ? (typeof data === "string" ? data : JSON.stringify(data))
      : (typeof data === "string" ? data : JSON.stringify(data));
    await kvSet(`memory:prop:${enc}:${key}`, value);
    await updatePropertyIndex(property);
    return { stored: `memory:prop:${enc}:${key}`, storage: "kv" };
  }

  // Per-property Blob: errors
  if (type === "property-blob" && property && key === "errors") {
    const slug = slugify(property);
    const enc = encodePropertyName(property);
    const blob = await blobPut(`memory/${slug}/errors.json`, data);
    await kvSet(`memory:blob:${enc}:errors`, blob.url);
    await updatePropertyIndex(property);
    return { stored: `memory/${slug}/errors.json`, storage: "blob", url: blob.url };
  }

  // Per-property Blob: signals (by month)
  if (type === "property-blob" && property && key === "signals" && month) {
    const slug = slugify(property);
    const enc = encodePropertyName(property);
    const blob = await blobPut(`memory/${slug}/signals/${month}.json`, data);
    await kvSet(`memory:blob:${enc}:signals:${month}`, blob.url);

    // Update signals index for this property
    const idxRaw = await kvGet(`memory:prop:${enc}:signals_index`);
    const idx = idxRaw ? JSON.parse(idxRaw) : [];
    if (!idx.includes(month)) {
      idx.push(month);
      idx.sort();
      await kvSet(`memory:prop:${enc}:signals_index`, JSON.stringify(idx));
    }
    await updatePropertyIndex(property);
    return { stored: `memory/${slug}/signals/${month}.json`, storage: "blob", url: blob.url };
  }

  // Per-property Blob: feedback (by quarter)
  if (type === "property-blob" && property && key === "feedback" && quarter) {
    const slug = slugify(property);
    const enc = encodePropertyName(property);
    const blob = await blobPut(`memory/${slug}/feedback/${quarter}.json`, data);
    await kvSet(`memory:blob:${enc}:feedback:${quarter}`, blob.url);
    await updatePropertyIndex(property);
    return { stored: `memory/${slug}/feedback/${quarter}.json`, storage: "blob", url: blob.url };
  }

  throw new Error(`Invalid write params: type=${type} key=${key} property=${property}`);
}

// ── Verify — check what memory data is present ────────────────────────────
async function handleVerify(res) {
  const report = { globals: {}, properties: {}, summary: {} };

  // Check global keys
  for (const key of GLOBAL_KV_KEYS) {
    const raw = await kvGet(`memory:${key}`);
    report.globals[key] = raw ? { present: true, bytes: raw.length } : { present: false };
  }

  // Check global blobs
  for (const blobKey of ["reliable_error_patterns", "portfolio_crossref"]) {
    const url = await kvGet(`memory:blob:${blobKey}`);
    report.globals[blobKey] = url ? { present: true, storage: "blob" } : { present: false };
  }

  // Check property index and per-property data
  const idxRaw = await kvGet("memory:property_index");
  const properties = idxRaw ? JSON.parse(idxRaw) : [];
  report.summary.propertyCount = properties.length;

  // Spot-check first 3 properties for completeness
  const sample = properties.slice(0, 3);
  for (const prop of sample) {
    const enc = encodePropertyName(prop);
    const propReport = {};
    for (const key of PROPERTY_KV_KEYS) {
      const raw = await kvGet(`memory:prop:${enc}:${key}`);
      propReport[key] = raw ? { present: true, bytes: raw.length } : { present: false };
    }
    // Check signals index
    const sigRaw = await kvGet(`memory:prop:${enc}:signals_index`);
    propReport.signalMonths = sigRaw ? JSON.parse(sigRaw).length : 0;
    // Check errors blob
    const errUrl = await kvGet(`memory:blob:${enc}:errors`);
    propReport.errors = errUrl ? { present: true, storage: "blob" } : { present: false };
    report.properties[prop] = propReport;
  }

  // Summary counts
  const globalPresent = Object.values(report.globals).filter(v => v.present).length;
  report.summary.globalsPresent = `${globalPresent}/${GLOBAL_KV_KEYS.length + 2}`;
  report.summary.allProperties = properties;

  return res.status(200).json(report);
}
