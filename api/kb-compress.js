export const config = { maxDuration: 60 };

const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

async function kvSet(key, value) {
  await fetch(KV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(["SET", key, value]),
  });
}

function encodePropertyName(name) {
  return encodeURIComponent(name).replace(/%20/g, "_");
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { type, name, source } = req.body;
    if (!type || !source) return res.status(400).json({ error: "type and source required" });

    const cap = type === "global" ? 1500 : 500;

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2000,
        messages: [
          {
            role: "user",
            content: `You are compressing an accounting knowledge base for AI injection. Output only the compressed text — no preamble, no explanation, no JSON wrapper.

Rules:
- Target approximately ${cap} tokens (roughly ${cap * 4} characters)
- Preserve all specific account numbers, dollar thresholds, and named rules verbatim
- Preserve all conditional logic ("if X then Y") exactly
- Convert narrative prose to dense declarative statements
- Use this format for rules: [CATEGORY | accounts if applicable]\nStatement.
- Group related rules under shared category headers
- Cut filler words, examples, and redundant explanations
- If content exceeds the token budget, prioritize: specific rules > general principles > background context

Knowledge base to compress:

${source}`,
          },
        ],
      }),
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.text();
      return res.status(502).json({ error: `Claude API error: ${err}` });
    }

    const data = await claudeRes.json();
    const compressed = data.content?.[0]?.text ?? "";
    const tokenCount = Math.round(compressed.length / 4);

    if (type === "global") {
      await Promise.all([
        kvSet("kb:global:compressed", compressed),
        kvSet("kb:global:token_count", String(tokenCount)),
      ]);
    } else {
      if (!name) return res.status(400).json({ error: "name required for property type" });
      const enc = encodePropertyName(name);
      await Promise.all([
        kvSet(`kb:property:${enc}:compressed`, compressed),
        kvSet(`kb:property:${enc}:token_count`, String(tokenCount)),
      ]);
    }

    return res.status(200).json({ compressed, tokenCount });
  } catch (e) {
    console.error("KB compress error:", e);
    return res.status(500).json({ error: e.message });
  }
}
