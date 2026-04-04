// ── Server-side authentication ────────────────────────────────────────────
// Validates passwords against environment variables instead of hardcoding
// them in client-side code.
//
// Env vars:
//   AUTH_PASSWORD  — main application password (login gate)
//   KB_PASSWORD    — manager password (data store / knowledge base)

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { password, scope } = req.body || {};

  if (!password || !scope) {
    return res.status(400).json({ ok: false, error: "password and scope required" });
  }

  const envKey = scope === "kb" ? "KB_PASSWORD" : "AUTH_PASSWORD";
  const expected = process.env[envKey];

  if (!expected) {
    return res.status(500).json({ ok: false, error: `${envKey} not configured` });
  }

  if (password === expected) {
    return res.status(200).json({ ok: true });
  }

  return res.status(401).json({ ok: false, error: "Incorrect password" });
}
