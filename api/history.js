import { put, del } from "@vercel/blob";
import { kvGet, kvSet, kvDel, feedbackKey } from "../lib/storage.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    // GET /api/history — return index of all saved reviews
    if (req.method === "GET" && !req.query.url) {
      const raw   = await kvGet("review_index");
      const index = raw ? JSON.parse(raw) : [];
      return res.status(200).json(index);
    }

    // GET /api/history?url=... — proxy fetch of full review blob (authenticated)
    if (req.method === "GET" && req.query.url) {
      const blobRes = await fetch(req.query.url, {
        headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
      });
      if (!blobRes.ok) return res.status(404).json({ error: "Review not found" });
      const data = await blobRes.json();
      return res.status(200).json(data);
    }

    // POST /api/history — save a completed review
    if (req.method === "POST") {
      const { property, period, timestamp, findings, checklistSnapshot, csvs } = req.body;
      if (!findings || !timestamp) return res.status(400).json({ error: "Missing required fields" });

      // Build unique blob path
      const slug     = (property || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
      const ts       = (timestamp || new Date().toISOString()).replace(/[:.]/g, "-").slice(0, 19);
      const pathname = `reviews/${ts}-${slug}.json`;

      // Write full payload to Blob
      const payload = JSON.stringify({ property, period, timestamp, findings, checklistSnapshot, csvs });
      const blob    = await put(pathname, payload, { access: "private", contentType: "application/json", addRandomSuffix: false });

      // Update KV index (newest first, max 500 entries)
      const raw   = await kvGet("review_index");
      const index = raw ? JSON.parse(raw) : [];
      index.unshift({
        property:     property || "",
        period:       period   || "",
        timestamp:    timestamp,
        findingCount: findings.length,
        blobUrl:      blob.url,
      });
      if (index.length > 500) index.length = 500;
      await kvSet("review_index", JSON.stringify(index));

      return res.status(200).json({ ok: true, blobUrl: blob.url });
    }

    // DELETE /api/history — remove a review (index entry + blob + feedback)
    if (req.method === "DELETE") {
      const { blobUrl } = req.body;
      if (!blobUrl) return res.status(400).json({ error: "blobUrl required" });

      // Remove from KV index
      const raw      = await kvGet("review_index");
      const index    = raw ? JSON.parse(raw) : [];
      const newIndex = index.filter(e => e.blobUrl !== blobUrl);
      await kvSet("review_index", JSON.stringify(newIndex));

      // Delete blob (best-effort)
      try { await del(blobUrl); } catch (e) { console.warn("Blob delete failed:", e.message); }

      // Delete feedback key (best-effort)
      try { await kvDel(feedbackKey(blobUrl)); } catch (e) { console.warn("Feedback delete failed:", e.message); }

      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error("History API error:", e);
    return res.status(500).json({ error: e.message });
  }
}
