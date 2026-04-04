import { kvSet, encodePropertyName } from "../lib/storage.js";

export const config = { maxDuration: 60 };

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
            content: `You are converting an accounting knowledge base into structured rule schema for AI injection during financial reviews. Output only the schema — no preamble, no explanation, no JSON wrapper.

CRITICAL RULES:
- Output ONLY information present in the source text below. Do not add, infer, invent, or hallucinate any content not explicitly stated in the source.
- Every output block must be directly traceable to a specific rule in the source.
- Do not pad or expand. If the source is short, the output will be short.

CONVERSION RULES:
- Each rule block in the source (delimited by "ACCOUNT:") becomes one schema block in this exact format:

[ACCOUNT: {value from source}]
RULE: {distilled rule — one to two sentences. Preserve all account numbers, dollar thresholds, and conditional logic exactly. Cut only filler words.}

- If the rule is conditional on a prior state or situation, add one line before RULE:
CONTEXT: {condition that must be true for this rule to apply}

- CONTEXT is omitted for unconditional rules.
- One blank line between blocks.
- Do not add any other headers, labels, or structural markup.
- Target approximately ${cap} tokens (roughly ${cap * 4} characters) but never exceed the content actually in the source.

Source knowledge base:

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
