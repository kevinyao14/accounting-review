function buildEmailHtml(findings, label, propertyName) {
  const title = propertyName ? `${propertyName} — ${label}` : label;
  const count = findings.length;

  const rows = findings.map(f => {
    const srcColor = f.source === "GL" ? "#3a7abf" : "#b8892a";
    const issueRow = f.issue
      ? `<tr>
          <td style="padding:4px 8px;vertical-align:top;white-space:nowrap;font-size:11px;font-weight:700;color:${srcColor};width:32px">${escHtml(f.source || "")}</td>
          <td style="padding:4px 8px;font-size:13px;color:#444;line-height:1.5">${escHtml(f.issue)}</td>
        </tr>`
      : "";
    const actionRow = f.action
      ? `<tr>
          <td style="padding:4px 8px;vertical-align:top;white-space:nowrap;font-size:11px;font-weight:700;color:#555">→</td>
          <td style="padding:4px 8px;font-size:13px;color:#333;line-height:1.5">${escHtml(f.action)}</td>
        </tr>`
      : "";

    return `
      <div style="border-left:3px solid #c9a84c;margin:18px 0;padding:10px 14px;background:#fafafa;border-radius:0 4px 4px 0">
        <div style="font-size:14px;font-weight:700;color:#1a1a1a;margin-bottom:6px">
          ${escHtml(f.accountName)}
          <span style="font-weight:400;color:#888;font-size:12px;margin-left:6px">(${escHtml(f.accountNumber)})</span>
        </div>
        <table style="border-collapse:collapse;width:100%">
          ${issueRow}${actionRow}
        </table>
      </div>`;
  }).join("");

  return `<!DOCTYPE html>
<html>
<body style="font-family:Arial,sans-serif;max-width:740px;margin:0 auto;padding:28px 20px;color:#1a1a1a">
  <div style="border-bottom:2px solid #c9a84c;padding-bottom:14px;margin-bottom:20px">
    <h2 style="margin:0;font-size:20px;color:#1a1a1a">Accounting Review: ${escHtml(title)}</h2>
    <p style="margin:6px 0 0;font-size:13px;color:#888">${count} finding${count !== 1 ? "s" : ""} identified</p>
  </div>
  ${rows}
  <p style="font-size:11px;color:#bbb;margin-top:32px;border-top:1px solid #eee;padding-top:12px">
    Sent automatically by Property Accounting Review
  </p>
</body>
</html>`;
}

function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "RESEND_API_KEY not configured" });

  const { findings, label, propertyName } = req.body ?? {};
  if (!findings || !label) return res.status(400).json({ error: "Missing findings or label" });

  const subject = propertyName
    ? `Accounting Review: ${propertyName} — ${label}`
    : `Accounting Review: ${label}`;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: "Accounting Review <onboarding@resend.dev>",
      to: "kevin.yao@skyboxcapital.com",
      subject,
      html: buildEmailHtml(findings, label, propertyName)
    })
  });

  if (!response.ok) {
    const err = await response.text();
    console.error("Resend error:", err);
    return res.status(502).json({ error: "Email send failed", detail: err });
  }

  return res.status(200).json({ ok: true });
}
