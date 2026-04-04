export const config = { maxDuration: 300 };

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

// ── Fetch memory context via the memory-context endpoint ──────────────────
// This calls /api/memory-context internally rather than duplicating the logic.
// In Vercel serverless, we can call our own endpoint via the VERCEL_URL env var
// or fall back to a relative fetch.

async function fetchMemoryContext(property, month, reqHeaders) {
  // Build the internal URL — Vercel provides VERCEL_URL for self-referencing
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

  const params = new URLSearchParams({ property, month });
  const url = `${baseUrl}/api/memory-context?${params}`;

  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`memory-context returned ${res.status}: ${errText}`);
  }

  const ctx = await res.json();

  // Reshape to match what buildSystemPrompt expects
  return {
    brief: ctx.brief || "",
    counterHeuristics: ctx.counterHeuristics || [],
    patterns: ctx.patterns || null,
    budgetIntel: ctx.budgetIntelligence || null,
    propertyKb: ctx.propertyKb || null,
    propertyBudget: ctx.propertyBudget || null,
    feeRates: ctx.feeRates || null,
    signals: [
      ...(ctx.signals?.current ? [ctx.signals.current] : []),
      ...(ctx.signals?.trailing || []),
    ],
  };
}

// ── Build the Stage 2 system prompt ───────────────────────────────────────

function buildSystemPrompt(property, month, memory) {
  const parts = [];

  parts.push(`You are a senior accounting reviewer performing a MEMORY-ENRICHED second pass on findings from an automated property review.

PROPERTY: ${property}
REVIEW MONTH: ${month}

You have access to historical memory for this property built from 12+ months of GL error mining, IS pattern analysis, and prior review feedback. Your job is to review each Stage 1 finding and:

1. SUPPRESS findings that match a counter-heuristic (cite the CH ID)
2. ELEVATE findings that match a known reliable error pattern or persistent issue
3. ADD CONTEXT from the memory brief (baselines, typical amounts, volatility info)
4. FLAG any signals from the memory layer that were NOT caught in Stage 1

For each finding, output a disposition:
- "keep" — finding is valid, no changes needed
- "suppress" — finding matches a counter-heuristic, should be removed or downgraded
- "elevate" — finding matches a known pattern, confidence should increase
- "context" — finding is valid but needs additional context from memory
- "new" — a signal from memory that Stage 1 missed entirely`);

  // Counter-heuristics
  if (memory.counterHeuristics.length > 0) {
    parts.push(`\n═══ COUNTER-HEURISTICS (False Positive Suppression Rules) ═══
These are battle-tested rules from 12+ rounds of review refinement across 44 properties.
If a Stage 1 finding matches a counter-heuristic condition, SUPPRESS it and cite the CH ID.

${memory.counterHeuristics.map(ch =>
  `[${ch.id}] ${ch.finding_type}: ${ch.condition}\n  → ${ch.guidance}`
).join("\n\n")}`);
  }

  // Memory brief
  if (memory.brief) {
    parts.push(`\n═══ PROPERTY MEMORY BRIEF ═══
This contains historical baselines, volatility classifications, accrual patterns, and contract norms.
Use this to add context to findings and calibrate sensitivity.

${memory.brief}`);
  }

  // Patterns
  if (memory.patterns) {
    const p = memory.patterns;
    const sections = [];
    if (p.stable_accounts?.length) {
      sections.push(`STABLE accounts (CV < 0.05 — heighten sensitivity): ${p.stable_accounts.map(a => a.account || a).join(", ")}`);
    }
    if (p.volatile_accounts?.length) {
      sections.push(`VOLATILE accounts (CV > 0.20 — reduce false positives): ${p.volatile_accounts.map(a => a.account || a).join(", ")}`);
    }
    if (p.reversal_pairs?.length) {
      sections.push(`REVERSAL PAIRS (expected accrual cycles): ${p.reversal_pairs.map(r => `${r.debit_account}↔${r.credit_account}`).join(", ")}`);
    }
    if (p.trending?.length) {
      sections.push(`TRENDING accounts: ${p.trending.map(t => `${t.account} (${t.direction})`).join(", ")}`);
    }
    if (sections.length) {
      parts.push(`\n═══ ACCOUNT PATTERNS ═══\n${sections.join("\n")}`);
    }
  }

  // Property KB (baselines)
  if (memory.propertyKb) {
    const kb = memory.propertyKb;
    const sections = [];
    if (kb.fixed_costs?.length) {
      sections.push(`FIXED COSTS:\n${kb.fixed_costs.map(fc => `  ${fc.account}: ${fc.description} — $${fc.typical_monthly?.toLocaleString() || "?"}/mo`).join("\n")}`);
    }
    if (kb.accrual_baselines?.length) {
      sections.push(`ACCRUAL BASELINES:\n${kb.accrual_baselines.map(ab => `  ${ab.account}: ${ab.description} — ~$${ab.typical_amount?.toLocaleString() || "?"}/mo, reversal day ${ab.reversal_day || "?"}`).join("\n")}`);
    }
    if (kb.contract_baselines?.length) {
      sections.push(`CONTRACT BASELINES:\n${kb.contract_baselines.map(cb => `  ${cb.vendor}: ~$${cb.typical_monthly?.toLocaleString() || "?"}/mo on ${(cb.account_list || []).join(", ")}`).join("\n")}`);
    }
    if (sections.length) {
      parts.push(`\n═══ PROPERTY BASELINES ═══\n${sections.join("\n\n")}`);
    }
  }

  // Budget intelligence
  if (memory.budgetIntel) {
    const bi = memory.budgetIntel;
    if (bi.categories) {
      const unreliable = Object.entries(bi.categories)
        .filter(([_, v]) => v.avg_alignment < 30)
        .map(([k, v]) => `${k}: alignment ${v.avg_alignment?.toFixed(0)}% (${v.reliability || "UNRELIABLE"})`)
        .slice(0, 10);
      if (unreliable.length) {
        parts.push(`\n═══ BUDGET INTELLIGENCE ═══
WARNING: These budget categories are empirically UNRELIABLE for variance detection:
${unreliable.join("\n")}
Do NOT suppress IS findings just because the budget shows a similar variance.`);
      }
    }
  }

  // Recent signals
  if (memory.signals.length > 0) {
    const allSignals = memory.signals.flatMap(s => (s.signals || []).map(sig => ({ ...sig, fromMonth: s.month })));
    if (allSignals.length > 0) {
      const high = allSignals.filter(s => s.severity === "high").slice(0, 20);
      const medium = allSignals.filter(s => s.severity === "medium").slice(0, 10);
      const display = [...high, ...medium];
      if (display.length) {
        parts.push(`\n═══ MEMORY SIGNALS (from GL error mining) ═══
These are known issues detected by the GL error miner. If Stage 1 missed any of these for the review month, flag them as "new" findings.

${display.map(s =>
  `[${s.id}] ${s.account_code} ${s.account_name}: ${s.issue_type} — $${s.amount?.toLocaleString() || "?"} (${s.severity}, confidence ${s.confidence?.toFixed(2)}) — ${s.supporting_evidence}`
).join("\n")}`);
      }
    }
  }

  // Fee rates
  if (memory.feeRates) {
    parts.push(`\n═══ FEE RATE KB ═══
Use this to verify management fee (608001) calculations.
${JSON.stringify(memory.feeRates, null, 2)}`);
  }

  return parts.join("\n\n");
}

// ══════════════════════════════════════════════════════════════════════════
// POST /api/memory-review
// Body: { property, month, findings: [...Stage1 findings...] }
//
// Returns: {
//   enrichedFindings: [{
//     original: { ...Stage1 finding... },
//     disposition: "keep" | "suppress" | "elevate" | "context" | "new",
//     memory_note: "CH007 applies — seasonal contract",
//     confidence_adjustment: +0.2 / -0.3 / etc.,
//     ch_id: "CH007" (if suppressed)
//   }],
//   newSignals: [...memory signals not caught in Stage 1...],
//   summary: { total, kept, suppressed, elevated, contextualized, new }
// }
// ══════════════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { property, month, findings } = req.body;
  if (!property || !month || !findings) {
    return res.status(400).json({ error: "property, month, and findings required" });
  }

  try {
    // 1. Fetch full memory context via /api/memory-context
    const memory = await fetchMemoryContext(property, month, req.headers);

    // 2. Build system prompt with all memory context
    const systemPrompt = buildSystemPrompt(property, month, memory);

    // 3. Format Stage 1 findings for the user message
    const findingsText = findings.map((f, i) => {
      const parts = [`[Finding ${i + 1}]`];
      if (f.accountNumber) parts.push(`Account: ${f.accountNumber} ${f.accountName || ""}`);
      if (f.issue) parts.push(`Issue: ${f.issue}`);
      if (f.action) parts.push(`Action: ${f.action}`);
      if (f.source) parts.push(`Source: ${f.source}`);
      if (f.checkType) parts.push(`Check: ${f.checkType}`);
      return parts.join("\n  ");
    }).join("\n\n");

    const userMessage = `Here are the ${findings.length} findings from the Stage 1 automated review of ${property} for ${month}.

Review each finding against the memory context and counter-heuristics. For each finding, provide a disposition and memory note.

Then, check if there are any memory signals that Stage 1 missed — if so, add them as new findings.

STAGE 1 FINDINGS:
${findingsText}

Respond with a JSON object matching this schema exactly:
{
  "enrichedFindings": [
    {
      "findingIndex": 0,
      "disposition": "keep|suppress|elevate|context",
      "memory_note": "explanation of why this disposition was chosen",
      "confidence_adjustment": 0.0,
      "ch_id": null
    }
  ],
  "newSignals": [
    {
      "accountNumber": "601001",
      "accountName": "R&M",
      "issue": "description",
      "source": "memory",
      "disposition": "new",
      "memory_note": "detected by GL error miner signal SIG-xxx",
      "severity": "high|medium|low"
    }
  ]
}

IMPORTANT: Return ONLY the JSON object, no markdown fences, no explanation outside the JSON.`;

    // 4. Call Claude
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 16000,
        thinking: { type: "enabled", budget_tokens: 4000 },
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.text();
      return res.status(claudeRes.status).json({ error: `Claude API error: ${err}` });
    }

    const claudeData = await claudeRes.json();

    // 5. Extract text from response (skip thinking blocks)
    let responseText = "";
    for (const block of claudeData.content || []) {
      if (block.type === "text") responseText += block.text;
    }

    // 6. Parse JSON response
    let parsed;
    try {
      // Strip any markdown fences if present
      const cleaned = responseText.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      return res.status(200).json({
        error: "Could not parse Claude response as JSON",
        rawResponse: responseText,
        findings,
      });
    }

    // 7. Merge enriched findings with originals
    const enrichedFindings = (parsed.enrichedFindings || []).map(ef => {
      const original = findings[ef.findingIndex] || null;
      return {
        original,
        disposition: ef.disposition,
        memory_note: ef.memory_note,
        confidence_adjustment: ef.confidence_adjustment || 0,
        ch_id: ef.ch_id || null,
      };
    });

    const newSignals = parsed.newSignals || [];

    // 8. Build summary
    const summary = {
      total: enrichedFindings.length + newSignals.length,
      kept: enrichedFindings.filter(f => f.disposition === "keep").length,
      suppressed: enrichedFindings.filter(f => f.disposition === "suppress").length,
      elevated: enrichedFindings.filter(f => f.disposition === "elevate").length,
      contextualized: enrichedFindings.filter(f => f.disposition === "context").length,
      new: newSignals.length,
      originalCount: findings.length,
    };

    return res.status(200).json({
      enrichedFindings,
      newSignals,
      summary,
      memoryAvailable: {
        hasBrief: !!memory.brief,
        counterHeuristicCount: memory.counterHeuristics.length,
        hasPatterns: !!memory.patterns,
        signalMonths: memory.signals.length,
        hasPropertyKb: !!memory.propertyKb,
      },
    });

  } catch (e) {
    console.error("Memory review API error:", e);
    return res.status(500).json({ error: e.message });
  }
}
