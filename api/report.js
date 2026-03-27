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

For each item:
- Use the account number and name as a bold subheader (e.g. **605023 Landscape Maintenance Contract**)
- State the specific issue with exact dollar amounts and dates
- Reference IS trend data: note direction and magnitude of change across the months shown
- Reference budget variance if budget data is provided
- State the recommended action clearly
- If reviewer feedback marks an item as false positive, note it and do not include it in Likely Needs Correction

Use technical accounting language. Be concise and precise.`,

  property_manager: `You are preparing a monthly financial review summary for a Property Manager.

Translate accounting findings into clear operational language. No journal entry mechanics, no accrual terminology, no accounting jargon.

For each relevant finding:
- Explain what happened in plain English — what was paid, to whom, when, and why it stands out
- Reference specific vendors, service dates, and dollar amounts where available
- Where actuals differ from budget, explain what is driving it operationally
- State specifically what the property manager needs to follow up on or confirm

Skip purely accounting items with no operational implication (e.g. standard accrual reversals, routine accounting entries).

Organize by operational area using headers (e.g. ## Maintenance & Repairs, ## Utilities, ## Revenue, ## Contract Services).

For each item use a bold subheader with the account name and current month amount.
Write in clear, direct prose. Keep it actionable.`,

  asset_manager: `You are preparing a monthly financial review summary for an Asset Manager.

Sort all findings from highest to lowest financial risk and NOI impact.

For each material item:
- Bold subheader with account name
- Lead with the dollar impact and % variance from budget or prior month
- State the trend direction (improving / worsening / stable)
- Note the NOI risk or opportunity explicitly
- One concise paragraph per item maximum

Prioritize: revenue variances, material expense overages vs budget, patterns affecting NOI, any items likely requiring restatement.

Skip routine items with no financial significance to NOI.
Use accounting language where necessary but keep framing financial and operational.
Exclude entry-level detail — no invoice numbers, PO numbers, or individual journal entry references.`
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
