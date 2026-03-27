import Anthropic from "@anthropic-ai/sdk";

export const config = { maxDuration: 120 };

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
- Use the account number and name as a bold subheader
- State the specific issue with exact dollar amounts and dates
- Reference IS trend data: note direction and magnitude of change
- Reference budget variance if budget data is provided
- State the recommended action clearly
- If reviewer feedback marks an item as false_positive, note it and consider excluding from top sections

Use technical accounting language. Be concise and precise. Do not restate items marked false_positive as needing correction.`,

  property_manager: `You are preparing a monthly financial review summary for a Property Manager.

Translate accounting findings into clear operational language. No journal entry mechanics, no accrual terminology, no accounting jargon.

For each relevant finding:
- Explain what happened in plain English — what was paid, to whom, when, and why it stands out
- Reference specific vendors, service dates, and dollar amounts where available
- Where actuals differ from budget, explain the operational reason driving it
- State specifically what the property manager needs to follow up on or confirm with vendors, leasing, or maintenance

Skip purely accounting items with no operational implication (e.g. standard accrual reversals working correctly, routine accounting entries).

Focus on: vendor behavior and patterns, maintenance and repair spend, utilities, contract services, lease-related revenue items, and budget variances with operational context.

Organize by operational area using headers (e.g., ## Maintenance & Repairs, ## Utilities, ## Revenue, ## Vendor Items).

Write in clear, direct prose. Keep it actionable.`,

  asset_manager: `You are preparing a monthly financial review summary for an Asset Manager.

Sort all findings from highest to lowest financial risk and NOI impact.

For each material item:
- Lead with the dollar impact and % variance from budget or prior month
- State the trend direction (improving / worsening / stable)
- Note the NOI risk or opportunity explicitly
- One concise paragraph per item maximum

Prioritize: revenue variances, material expense overages vs budget, patterns affecting NOI, any items likely requiring restatement.

Skip routine items with no financial significance to NOI.

Use accounting language where necessary but keep framing financial and operational.
Exclude entry-level detail — no individual invoice numbers, PO numbers, or journal entry references.
Do include vendor names and service categories where they explain the variance.`
};

const AUDIENCE_LABELS = {
  accounting_manager: "Accounting Manager",
  property_manager: "Property Manager",
  asset_manager: "Asset Manager",
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  const { audience, context, period, property } = req.body || {};
  if (!audience || !context) return res.status(400).json({ error: "Missing required fields." });

  const systemPrompt = SYSTEM_PROMPTS[audience];
  if (!systemPrompt) return res.status(400).json({ error: "Invalid audience." });

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{
        role: "user",
        content: `PROPERTY: ${property || "Unknown"}\nPERIOD: ${period || "Unknown"}\n\nFINDINGS WITH SUPPORTING DATA:\n\n${context}\n\nGenerate the ${AUDIENCE_LABELS[audience]} report.`
      }]
    });

    res.json({ content: response.content[0]?.text ?? "" });
  } catch (e) {
    res.status(500).json({ error: e.message || "Report generation failed." });
  }
}
