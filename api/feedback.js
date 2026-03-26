const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

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

// Derive a stable KV key from a blob URL
function feedbackKey(blobUrl) {
  // e.g. "feedback:reviews/2026-03-26T15-00-00-hampton.json"
  const match = blobUrl.match(/reviews\/[^?]+/);
  return "feedback:" + (match ? match[0] : blobUrl.slice(-60));
}

// Update a single entry in the review_index by blobUrl
async function updateIndexEntry(blobUrl, updates) {
  const raw   = await kvGet("review_index");
  const index = raw ? JSON.parse(raw) : [];
  const idx   = index.findIndex(e => e.blobUrl === blobUrl);
  if (idx !== -1) {
    index[idx] = { ...index[idx], ...updates };
    await kvSet("review_index", JSON.stringify(index));
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    // GET /api/feedback?blobUrl=... — load existing feedback for a review
    if (req.method === "GET") {
      const { blobUrl } = req.query;
      if (!blobUrl) return res.status(400).json({ error: "blobUrl required" });
      const raw = await kvGet(feedbackKey(blobUrl));
      return res.status(200).json(raw ? JSON.parse(raw) : null);
    }

    if (req.method === "POST") {
      const { blobUrl, feedback, action } = req.body;
      if (!blobUrl) return res.status(400).json({ error: "blobUrl required" });

      // POST /api/feedback { blobUrl, action:"commit" } — manager commits feedback for training
      if (action === "commit") {
        const raw      = await kvGet(feedbackKey(blobUrl));
        const existing = raw ? JSON.parse(raw) : {};
        await kvSet(feedbackKey(blobUrl), JSON.stringify({
          ...existing,
          committed:   true,
          committedAt: new Date().toISOString(),
        }));
        await updateIndexEntry(blobUrl, { feedbackCommitted: true });
        return res.status(200).json({ ok: true });
      }

      // POST /api/feedback { blobUrl, action:"uncommit" } — revert committed feedback
      if (action === "uncommit") {
        const raw      = await kvGet(feedbackKey(blobUrl));
        const existing = raw ? JSON.parse(raw) : {};
        const { committed, committedAt, ...rest } = existing;
        await kvSet(feedbackKey(blobUrl), JSON.stringify(rest));
        await updateIndexEntry(blobUrl, { feedbackCommitted: false });
        return res.status(200).json({ ok: true });
      }

      // POST /api/feedback { blobUrl, feedback } — save feedback for a review
      if (!feedback) return res.status(400).json({ error: "feedback required" });
      await kvSet(feedbackKey(blobUrl), JSON.stringify({
        ...feedback,
        savedAt: new Date().toISOString(),
      }));
      await updateIndexEntry(blobUrl, { hasFeedback: true });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error("Feedback API error:", e);
    return res.status(500).json({ error: e.message });
  }
}
