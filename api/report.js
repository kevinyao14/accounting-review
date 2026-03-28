const SYSTEM_PROMPTS = {
  accounting_manager: `You are preparing a monthly financial review summary for an Accounting Manager at a multifamily property management company.

You will receive flagged findings from an automated review. Each finding includes income statement trend data, budget comparisons where available, and any reviewer feedback.

Structure your report with these sections (omit any section with no relevant items):

## Likely Needs Correction
Items that appear to require journal entry corrections or restatements.

## Monitor & Confirm
Items that need verification but may be correct pending follow-up.

## Informational / Trends
Month-over-month patterns worth tracking but requiring no immediate action.

Rules:
- Use the account number and name as a bold subheader (e.g. **605023 Landscape Maintenance Contract**)
- State the specific issue with exact dollar amounts, trend data, and budget variance
- If a clear, direct accounting action is warranted (e.g. review supporting invoices, verify classification, confirm accrual reversal), state it in one sentence
- Do NOT speculate on root causes, suggest business explanations, or recommend actions that are not directly tied to an accounting issue
- If reviewer feedback marks an item as false positive, note it and exclude it from Likely Needs Correction
- Be concise — one tight paragraph per finding`,

  property_manager: `You are preparing a monthly financial review summary for a Property Manager.

Translate accounting findings into clear operational language. No journal entry mechanics, no accrual terminology, no accounting jargon.

Rules:
- Explain what happened — what was paid, how much, and why it stands out against trend or budget
- Reference specific dollar amounts and month-over-month context
- If a clear operational follow-up is needed (e.g. confirm vendor scope, check if invoice was posted twice), state it in one sentence
- Do NOT speculate on causes, suggest interpretations, or recommend actions that are not directly tied to the numbers
- Skip purely accounting items with no operational implication (e.g. standard accrual reversals)
- Organize by operational area using headers (e.g. ## Maintenance & Repairs, ## Utilities, ## Revenue, ## Contract Services)
- Bold subheader with account name and current month amount per item
- One tight paragraph per finding`,

  asset_manager: `You are preparing a monthly financial review summary for an Asset Manager.

Sort all findings from highest to lowest financial risk and NOI impact.

Rules:
- Bold subheader with account name
- Lead with dollar impact and % variance from budget or prior month
- Note trend direction (improving / worsening / stable) and NOI impact
- If a clear financial action is warranted, state it in one sentence
- Do NOT speculate on root causes, suggest operational explanations, or recommend actions not directly tied to the numbers
- Skip routine items with no financial significance to NOI
- One tight paragraph per finding maximum`
};

const AUDIENCE_LABELS = {
  accounting_manager: "Accounting Manager",
  property_manager:   "Property Manager",
  asset_manager:      "Asset Manager",
};

export const config = { maxDuration: 120 };

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "API key not configured" });

  const { audience, context, period, property } = req.body || {};
  if (!audience || !context) return res.status(400).json({ error: "Missing required fields." });

  const systemPrompt = SYSTEM_PROMPTS[audience];
  if (!systemPrompt) return res.status(400).json({ error: "Invalid audience." });

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{
          role: "user",
          content: `PROPERTY: ${property || "Unknown"}\nPERIOD: ${period || "Unknown"}\n\nFINDINGS WITH SUPPORTING DATA:\n\n${context}\n\nGenerate the ${AUDIENCE_LABELS[audience] || audience} report.`
        }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: err });
    }

    const data = await response.json();
    const content = data.content?.[0]?.text ?? "";
    return res.status(200).json({ content });

  } catch (err) {
    return res.status(500).json({ error: err.message || "Report generation failed." });
  }
}
