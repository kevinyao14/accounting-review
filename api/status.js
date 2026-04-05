export const config = { maxDuration: 10 };

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  try {
    const r = await fetch("https://status.anthropic.com/api/v2/status.json");
    const data = await r.json();
    return res.status(200).json({ indicator: data?.status?.indicator ?? "none" });
  } catch {
    return res.status(200).json({ indicator: "none" });
  }
}
