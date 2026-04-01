export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { userMessage, currentSource, scope } = req.body;
    if (!userMessage) return res.status(400).json({ error: "userMessage required" });

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        system: `You are a knowledge base manager for a multifamily property accounting firm. The user will describe knowledge they want to add, update, or remove.

Respond with a JSON object only — no markdown, no backticks, no preamble:
{
  "action": "add" | "update" | "remove",
  "preview": "1-2 sentence human-readable description of the change. If removing, quote the exact text being removed.",
  "proposedSource": "The complete updated source document after applying the change."
}

Rules for proposedSource:
- Preserve ALL existing content unless explicitly asked to change or remove it
- Add new content grouped with related rules
- Format rules as dense declarative statements
- Prefix account-specific rules with [ACCOUNT: XXXXX] or [ACCOUNTS: XXXXX-XXXXX]
- Prefix category rules with [CATEGORY NAME]
- General principles first, then account-specific rules
- Current scope: ${scope === "global" ? "Global firm-wide SOPs" : "Property-specific rules"}`,
        messages: [
          {
            role: "user",
            content: `Current knowledge base:\n${currentSource || "(empty)"}\n\nUser request: ${userMessage}`,
          },
        ],
      }),
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.text();
      return res.status(502).json({ error: `Claude API error: ${err}` });
    }

    const data = await claudeRes.json();
    const text = data.content?.[0]?.text ?? "";

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return res.status(200).json({ error: "Failed to parse response" });
    }

    return res.status(200).json(parsed);
  } catch (e) {
    console.error("KB chat error:", e);
    return res.status(500).json({ error: e.message });
  }
}
