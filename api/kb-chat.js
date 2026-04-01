export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { userMessage, currentSource, scope, mode, clarifyQuestions } = req.body;
    if (mode !== "clarify" && !userMessage) return res.status(400).json({ error: "userMessage required" });

    const isClarify = mode === "clarify";

    const system = isClarify
      ? `You are reviewing an accounting knowledge base for a multifamily property management firm to identify gaps that would reduce its usefulness during automated financial reviews.

Respond with a JSON object only — no markdown, no backticks, no preamble:
{
  "questions": ["question 1", "question 2", ...]
}

Rules:
- Ask only questions whose answers would materially change how a rule is applied — a missing dollar threshold, an unspecified condition, an ambiguous account range, or a missing exception
- Do not ask about things already clearly defined in the source
- Do not ask generic or obvious questions
- If the source is thorough and no meaningful clarifications are needed, return an empty array`
      : `You are a knowledge base manager for a multifamily property accounting firm. The user will describe knowledge they want to add, update, or remove.

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
- Current scope: ${scope === "global" ? "Global firm-wide SOPs" : "Property-specific rules"}`;

    const clarifyContext = clarifyQuestions?.length > 0
      ? `\n\nThe following clarifying questions were previously posed to the user:\n${clarifyQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n")}\n\nThe user's message may be answering some or all of these by number. Interpret their answers in the context of those questions.`
      : "";

    const userContent = isClarify
      ? `Review this knowledge base and ask any questions whose answers would materially improve the precision of its rules:\n\n${currentSource || "(empty)"}`
      : `Current knowledge base:\n${currentSource || "(empty)"}\n\nUser request: ${userMessage}${clarifyContext}`;

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
        system,
        messages: [{ role: "user", content: userContent }],
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
