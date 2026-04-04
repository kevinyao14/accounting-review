export const config = { maxDuration: 120 };

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

// ── KV/Blob helpers ───────────────────────────────────────────────────────

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
    if (url.startsWith("kv:")) {
      const raw = await kvGet(url.slice(3));
      if (!raw) return null;
      return typeof raw === "string" ? JSON.parse(raw) : raw;
    }
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${BLOB_TOKEN}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// ── Fetch targeted memory context based on the question ───────────────────

async function fetchMemoryForChat(property, month, accountNumbers) {
  const enc = encodePropertyName(property);

  // Always fetch: brief, counter-heuristics, patterns, fee rates
  const [briefRaw, patternsRaw, feeRatesRaw, propertyKbRaw, signalsIndexRaw] = await Promise.all([
    kvGet(`memory:prop:${enc}:brief`),
    kvGet(`memory:prop:${enc}:patterns`),
    kvGet("memory:fee_rates"),
    kvGet(`memory:prop:${enc}:kb`),
    kvGet(`memory:prop:${enc}:signals_index`),
  ]);

  // Fetch signals for the relevant month window
  const signalsIndex = signalsIndexRaw ? JSON.parse(signalsIndexRaw) : [];
  let signals = [];
  if (month && signalsIndex.length > 0) {
    const [yr, mo] = month.split("-").map(Number);
    const targetMonths = [month];
    for (let i = 1; i <= 2; i++) {
      let pm = mo - i, py = yr;
      if (pm <= 0) { pm += 12; py -= 1; }
      targetMonths.push(`${py}-${String(pm).padStart(2, "0")}`);
    }
    const results = await Promise.all(
      targetMonths.filter(m => signalsIndex.includes(m)).map(async (m) => {
        const url = await kvGet(`memory:blob:${enc}:signals:${m}`);
        if (!url) return null;
        const data = await blobGet(url);
        return data ? { month: m, ...data } : null;
      })
    );
    signals = results.filter(Boolean);
  }

  return {
    brief: briefRaw || "",
    patterns: patternsRaw ? JSON.parse(patternsRaw) : null,
    feeRates: feeRatesRaw ? JSON.parse(feeRatesRaw) : null,
    propertyKb: propertyKbRaw ? JSON.parse(propertyKbRaw) : null,
    signals,
    signalMonths: signalsIndex,
  };
}

// ── Build chat system prompt ──────────────────────────────────────────────

function buildChatSystemPrompt(property, month, memory) {
  const parts = [];

  parts.push(`You are an expert property accounting assistant with deep historical knowledge of ${property}.
You are answering questions from an accounting reviewer who has just completed a review of ${property} for ${month}.
You have access to 12+ months of historical data including account baselines, vendor patterns, accrual cycles, and known issues.

RULES:
- Answer in plain professional English — no internal codes, rule IDs, or signal IDs
- Cite specific dollar amounts, dates, vendors, and account numbers
- Be concise and direct — the reviewer is experienced and wants facts, not explanations of methodology
- If you don't have data on something, say so clearly`);

  if (memory.brief) {
    parts.push(`\n═══ PROPERTY MEMORY BRIEF ═══\n${memory.brief}`);
  }

  if (memory.patterns) {
    const p = memory.patterns;
    const sections = [];
    if (p.stable_accounts?.length) sections.push(`Stable accounts: ${p.stable_accounts.map(a => a.account || a).join(", ")}`);
    if (p.volatile_accounts?.length) sections.push(`Volatile accounts: ${p.volatile_accounts.map(a => a.account || a).join(", ")}`);
    if (p.trending?.length) sections.push(`Trending: ${p.trending.map(t => `${t.account} (${t.direction})`).join(", ")}`);
    if (sections.length) parts.push(`\n═══ ACCOUNT PATTERNS ═══\n${sections.join("\n")}`);
  }

  if (memory.propertyKb) {
    const kb = memory.propertyKb;
    const sections = [];
    if (kb.fixed_costs?.length) {
      sections.push(`Fixed costs:\n${kb.fixed_costs.map(fc => `  ${fc.account}: ${fc.description} — $${fc.typical_monthly?.toLocaleString() || "?"}/mo`).join("\n")}`);
    }
    if (kb.accrual_baselines?.length) {
      sections.push(`Accrual baselines:\n${kb.accrual_baselines.map(ab => `  ${ab.account}: ${ab.description} — ~$${ab.typical_amount?.toLocaleString() || "?"}/mo`).join("\n")}`);
    }
    if (kb.contract_baselines?.length) {
      sections.push(`Contract baselines:\n${kb.contract_baselines.map(cb => `  ${cb.vendor}: ~$${cb.typical_monthly?.toLocaleString() || "?"}/mo on ${(cb.account_list || []).join(", ")}`).join("\n")}`);
    }
    if (sections.length) parts.push(`\n═══ PROPERTY BASELINES ═══\n${sections.join("\n\n")}`);
  }

  if (memory.signals.length > 0) {
    const allSignals = memory.signals.flatMap(s => (s.signals || []).map(sig => ({ ...sig, fromMonth: s.month })));
    if (allSignals.length > 0) {
      const display = allSignals.filter(s => s.severity === "high" || s.severity === "medium").slice(0, 30);
      if (display.length) {
        parts.push(`\n═══ KNOWN ISSUES (from historical analysis) ═══\n${display.map(s =>
          `${s.account_code} ${s.account_name}: ${s.issue_type} — $${s.amount?.toLocaleString() || "?"} (${s.severity}, ${s.fromMonth}) — ${s.supporting_evidence}`
        ).join("\n")}`);
      }
    }
  }

  if (memory.feeRates) {
    parts.push(`\n═══ FEE RATE DATA ═══\n${JSON.stringify(memory.feeRates, null, 2)}`);
  }

  return parts.join("\n\n");
}

// ══════════════════════════════════════════════════════════════════════════
// POST /api/memory-chat
// Body: { property, month, messages: [{ role, content }] }
//
// Returns: { response: "..." }
// ══════════════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { property, month, messages } = req.body;
  if (!property || !messages?.length) {
    return res.status(400).json({ error: "property and messages required" });
  }

  try {
    // Extract account numbers mentioned in the conversation for targeted context
    const allText = messages.map(m => m.content).join(" ");
    const accountNumbers = [...new Set((allText.match(/\d{6}/g) || []))];

    const memory = await fetchMemoryForChat(property, month || "", accountNumbers);
    const systemPrompt = buildChatSystemPrompt(property, month || "current", memory);

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        system: systemPrompt,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
      }),
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.text();
      return res.status(claudeRes.status).json({ error: `Claude API error: ${err}` });
    }

    const claudeData = await claudeRes.json();
    let responseText = "";
    for (const block of claudeData.content || []) {
      if (block.type === "text") responseText += block.text;
    }

    return res.status(200).json({
      response: responseText,
      memoryLoaded: {
        hasBrief: !!memory.brief,
        hasPatterns: !!memory.patterns,
        signalMonths: memory.signalMonths.length,
        hasPropertyKb: !!memory.propertyKb,
      },
    });

  } catch (e) {
    console.error("Memory chat API error:", e);
    return res.status(500).json({ error: e.message });
  }
}
