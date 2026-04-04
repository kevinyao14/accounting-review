export const config = { maxDuration: 30 };

const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

// ── KV helpers ────────────────────────────────────────────────────────────

async function kvGet(key) {
  const res = await fetch(KV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(["GET", key]),
  });
  const { result } = await res.json();
  return result;
}

function encodePropertyName(name) {
  return encodeURIComponent(name).replace(/%20/g, "_");
}

async function blobGet(url) {
  if (!url) return null;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${BLOB_TOKEN}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ── Rough token estimator (4 chars ≈ 1 token) ────────────────────────────
function estimateTokens(obj) {
  if (!obj) return 0;
  const str = typeof obj === "string" ? obj : JSON.stringify(obj);
  return Math.ceil(str.length / 4);
}

// ══════════════════════════════════════════════════════════════════════════
// GET /api/memory-context?property={name}&month={YYYY-MM}[&accounts=601001,603001]
//
// Returns the full memory payload assembled for a single property + review month.
// Optional `accounts` param filters counter-heuristics to only matching accounts.
//
// Response:
// {
//   property, month,
//   brief,                    ← text (dream engine .kb brief)
//   counterHeuristics,        ← array (optionally filtered)
//   patterns,                 ← object (volatility/trend classification)
//   budgetIntelligence,       ← object (category reliability scores)
//   propertyKb,               ← object (fixed costs, accrual baselines, contracts)
//   propertyBudget,           ← object (property-specific budget analysis)
//   feeRates,                 ← object (management fee rate KB)
//   signals: { current, trailing },
//   portfolioContext: { riskScore },
//   tokenEstimate,
//   dataAge                   ← when each piece was last updated
// }
// ══════════════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  const { property, month, accounts } = req.query;
  if (!property || !month) {
    return res.status(400).json({ error: "property and month required" });
  }

  const enc = encodePropertyName(property);
  const accountFilter = accounts ? accounts.split(",").map(a => a.trim()) : null;

  try {
    // ── Parallel fetch everything we need ──────────────────────────────
    const [
      briefRaw,
      counterHeuristicsRaw,
      patternsRaw,
      budgetIntelRaw,
      propertyKbRaw,
      propertyBudgetRaw,
      feeRatesRaw,
      riskScoresRaw,
      signalsIndexRaw,
    ] = await Promise.all([
      kvGet(`memory:prop:${enc}:brief`),
      kvGet("memory:counter_heuristics"),
      kvGet(`memory:prop:${enc}:patterns`),
      kvGet("memory:budget_intelligence"),
      kvGet(`memory:prop:${enc}:kb`),
      kvGet(`memory:prop:${enc}:budget`),
      kvGet("memory:fee_rates"),
      kvGet("memory:risk_scores"),
      kvGet(`memory:prop:${enc}:signals_index`),
    ]);

    // ── Parse KV results ───────────────────────────────────────────────
    const brief = briefRaw || null;

    let counterHeuristics = counterHeuristicsRaw ? JSON.parse(counterHeuristicsRaw) : [];
    // Optionally filter to only heuristics relevant to the accounts in this review
    if (accountFilter && counterHeuristics.length > 0) {
      counterHeuristics = counterHeuristics.filter(ch => {
        // Keep GENERAL rules (no specific account) + rules matching any uploaded account
        if (!ch.condition || ch.finding_type === "general") return true;
        // Check if any account in the filter appears in the condition text
        return accountFilter.some(acct => ch.condition.includes(acct)) || true;
        // Actually, counter-heuristics apply by finding_type not account number,
        // so we keep them all for now — the model decides which apply.
      });
    }

    const patterns = patternsRaw ? JSON.parse(patternsRaw) : null;
    const budgetIntelligence = budgetIntelRaw ? JSON.parse(budgetIntelRaw) : null;
    const propertyKb = propertyKbRaw ? JSON.parse(propertyKbRaw) : null;
    const propertyBudget = propertyBudgetRaw ? JSON.parse(propertyBudgetRaw) : null;
    const feeRates = feeRatesRaw ? JSON.parse(feeRatesRaw) : null;

    // Extract this property's risk score from portfolio scores
    let riskScore = null;
    if (riskScoresRaw) {
      const scores = JSON.parse(riskScoresRaw);
      if (Array.isArray(scores)) {
        riskScore = scores.find(s => s.property === property) || null;
      } else if (scores[property]) {
        riskScore = scores[property];
      }
    }

    // ── Fetch signals: current month + trailing 2 months from Blob ─────
    const signalsIndex = signalsIndexRaw ? JSON.parse(signalsIndexRaw) : [];

    // Determine which months to fetch (current + 2 prior)
    const [yr, mo] = month.split("-").map(Number);
    const targetMonths = [month];
    for (let i = 1; i <= 2; i++) {
      let pm = mo - i;
      let py = yr;
      if (pm <= 0) { pm += 12; py -= 1; }
      targetMonths.push(`${py}-${String(pm).padStart(2, "0")}`);
    }

    const signalFetches = targetMonths
      .filter(m => signalsIndex.includes(m))
      .map(async (m) => {
        const url = await kvGet(`memory:blob:${enc}:signals:${m}`);
        if (!url) return null;
        const data = await blobGet(url);
        return data ? { month: m, ...data } : null;
      });

    const signalResults = await Promise.all(signalFetches);
    const currentSignals = signalResults.find(s => s && s.month === month) || null;
    const trailingSignals = signalResults.filter(s => s && s.month !== month);

    // ── Assemble response ──────────────────────────────────────────────
    const payload = {
      property,
      month,
      brief,
      counterHeuristics,
      patterns,
      budgetIntelligence,
      propertyKb,
      propertyBudget,
      feeRates,
      signals: {
        current: currentSignals,
        trailing: trailingSignals,
        availableMonths: signalsIndex,
      },
      portfolioContext: {
        riskScore,
      },
    };

    // Token estimate for the full payload
    const tokenEstimate = {
      brief: estimateTokens(brief),
      counterHeuristics: estimateTokens(counterHeuristics),
      patterns: estimateTokens(patterns),
      budgetIntelligence: estimateTokens(budgetIntelligence),
      propertyKb: estimateTokens(propertyKb),
      signals: estimateTokens(currentSignals) + estimateTokens(trailingSignals),
      total: 0,
    };
    tokenEstimate.total = Object.values(tokenEstimate).reduce((s, v) => s + (typeof v === "number" ? v : 0), 0);
    payload.tokenEstimate = tokenEstimate;

    // Data freshness
    payload.dataAge = {
      signalsAvailable: signalsIndex.length,
      latestSignalMonth: signalsIndex.length ? signalsIndex[signalsIndex.length - 1] : null,
      hasCounterHeuristics: counterHeuristics.length > 0,
      hasBrief: !!brief,
      hasPatterns: !!patterns,
      hasBudgetIntel: !!budgetIntelligence,
    };

    return res.status(200).json(payload);

  } catch (e) {
    console.error("Memory context API error:", e);
    return res.status(500).json({ error: e.message });
  }
}
