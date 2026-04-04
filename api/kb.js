import { kvGet, kvSet, kvDel, encodePropertyName } from "../lib/storage.js";

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    if (req.method === "GET") {
      const { type, name } = req.query;

      if (type === "global") {
        const [source, compressed, tokenCountRaw] = await Promise.all([
          kvGet("kb:global:source"),
          kvGet("kb:global:compressed"),
          kvGet("kb:global:token_count"),
        ]);
        return res.status(200).json({
          source,
          compressed,
          tokenCount: tokenCountRaw != null ? parseInt(tokenCountRaw, 10) : null,
        });
      }

      if (type === "property") {
        if (!name) return res.status(400).json({ error: "name required" });
        const enc = encodePropertyName(name);
        const [source, compressed, tokenCountRaw] = await Promise.all([
          kvGet(`kb:property:${enc}:source`),
          kvGet(`kb:property:${enc}:compressed`),
          kvGet(`kb:property:${enc}:token_count`),
        ]);
        return res.status(200).json({
          source,
          compressed,
          tokenCount: tokenCountRaw != null ? parseInt(tokenCountRaw, 10) : null,
        });
      }

      if (type === "property-list") {
        const raw = await kvGet("kb:property:index");
        return res.status(200).json(raw ? JSON.parse(raw) : []);
      }

      return res.status(400).json({ error: "Invalid type" });
    }

    if (req.method === "POST") {
      const { type, name, source, compressed, tokenCount } = req.body;

      if (type === "global") {
        if (source == null) return res.status(400).json({ error: "source required" });
        await kvSet("kb:global:source", source);
        if (compressed != null) await kvSet("kb:global:compressed", compressed);
        if (tokenCount != null) await kvSet("kb:global:token_count", String(tokenCount));
        return res.status(200).json({ ok: true });
      }

      if (type === "property") {
        if (!name) return res.status(400).json({ error: "name required" });
        if (source == null) return res.status(400).json({ error: "source required" });
        const enc = encodePropertyName(name);
        await kvSet(`kb:property:${enc}:source`, source);
        if (compressed != null) await kvSet(`kb:property:${enc}:compressed`, compressed);
        if (tokenCount != null) await kvSet(`kb:property:${enc}:token_count`, String(tokenCount));
        const raw = await kvGet("kb:property:index");
        const index = raw ? JSON.parse(raw) : [];
        if (!index.includes(name)) {
          index.push(name);
          await kvSet("kb:property:index", JSON.stringify(index));
        }
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ error: "Invalid type" });
    }

    if (req.method === "DELETE") {
      const { name } = req.body;
      if (!name) return res.status(400).json({ error: "name required" });
      const enc = encodePropertyName(name);
      await Promise.all([
        kvDel(`kb:property:${enc}:source`),
        kvDel(`kb:property:${enc}:compressed`),
        kvDel(`kb:property:${enc}:token_count`),
      ]);
      const raw = await kvGet("kb:property:index");
      const index = raw ? JSON.parse(raw) : [];
      const newIndex = index.filter(n => n !== name);
      await kvSet("kb:property:index", JSON.stringify(newIndex));
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error("KB API error:", e);
    return res.status(500).json({ error: e.message });
  }
}
