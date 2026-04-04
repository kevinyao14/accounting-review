import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import JSZip from "jszip";

export const config = { maxDuration: 30 };

const __dirname = dirname(fileURLToPath(import.meta.url));

const AUDIENCE_LABELS = {
  accounting_manager: "Accounting Manager Report",
  property_manager:   "Property Manager Report",
  asset_manager:      "Asset Manager Report",
};

// ── Escape XML special characters ────────────────────────────────────────────
function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ── Build a Word paragraph XML string ────────────────────────────────────────
function para(text, opts = {}) {
  const {
    style   = "NoSpacing",
    bold    = false,
    color   = "454747",
    sz      = 20,          // half-points
    after   = 0,
    before  = 0,
    font    = "Avenir Next LT Pro",
  } = opts;

  const pPr = `<w:pPr><w:pStyle w:val="${style}"/>${
    (before || after)
      ? `<w:spacing${before ? ` w:before="${before}"` : ""}${after ? ` w:after="${after}"` : ""}/>`
      : ""
  }</w:pPr>`;

  const rPr = `<w:rPr>
    <w:rFonts w:ascii="${font}" w:hAnsi="${font}"/>
    ${bold ? "<w:b/><w:bCs/>" : ""}
    <w:color w:val="${color}"/>
    <w:sz w:val="${sz}"/>
    <w:szCs w:val="${sz}"/>
  </w:rPr>`;

  // Split on bold spans (**text**) within the line
  const parts = String(text).split(/(\*\*[^*]+\*\*)/);
  const runs = parts.map(part => {
    const isBold = /^\*\*[^*]+\*\*$/.test(part);
    const content = esc(isBold ? part.slice(2, -2) : part);
    if (!content) return "";
    const runRpr = `<w:rPr>
      <w:rFonts w:ascii="${font}" w:hAnsi="${font}"/>
      ${(bold || isBold) ? "<w:b/><w:bCs/>" : ""}
      <w:color w:val="${color}"/>
      <w:sz w:val="${sz}"/>
      <w:szCs w:val="${sz}"/>
    </w:rPr>`;
    return `<w:r>${runRpr}<w:t xml:space="preserve">${content}</w:t></w:r>`;
  }).join("");

  return `<w:p>${pPr}${runs || `<w:r>${rPr}<w:t></w:t></w:r>`}</w:p>`;
}

// ── Thin teal rule line ───────────────────────────────────────────────────────
function rulePara() {
  return `<w:p>
    <w:pPr>
      <w:pStyle w:val="NoSpacing"/>
      <w:spacing w:after="120"/>
      <w:pBdr>
        <w:bottom w:val="single" w:sz="6" w:space="1" w:color="08BBBF"/>
      </w:pBdr>
    </w:pPr>
  </w:p>`;
}

// ── Empty spacer paragraph ────────────────────────────────────────────────────
function spacer(after = 80) {
  return `<w:p><w:pPr><w:pStyle w:val="NoSpacing"/><w:spacing w:after="${after}"/></w:pPr></w:p>`;
}

// ── Parse AI markdown into Word XML paragraphs ────────────────────────────────
function parseContent(text) {
  const lines = text.split("\n");
  const paras = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      paras.push(spacer(60));
      continue;
    }

    // ## Section heading
    if (trimmed.startsWith("## ")) {
      paras.push(spacer(120));
      paras.push(para(trimmed.slice(3), {
        style: "Heading2", bold: true, color: "3D59A1", sz: 26, after: 60,
      }));
      paras.push(rulePara());
      continue;
    }

    // ### Sub-heading
    if (trimmed.startsWith("### ")) {
      paras.push(para(trimmed.slice(4), {
        style: "Heading3", bold: true, color: "454747", sz: 22, before: 100, after: 40,
      }));
      continue;
    }

    // Account heading: **605023 Landscape Maintenance Contract** (bold line = account heading)
    if (trimmed.startsWith("**") && trimmed.endsWith("**") && !trimmed.slice(2, -2).includes("**")) {
      paras.push(spacer(80));
      paras.push(para(trimmed.slice(2, -2), {
        bold: true, color: "3D59A1", sz: 22, before: 80, after: 20,
      }));
      continue;
    }

    // Bullet point
    if (trimmed.startsWith("- ") || trimmed.startsWith("• ")) {
      const content = trimmed.slice(2);
      paras.push(`<w:p>
        <w:pPr>
          <w:pStyle w:val="ListParagraph"/>
          <w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>
          <w:spacing w:after="40"/>
        </w:pPr>
        <w:r>
          <w:rPr>
            <w:rFonts w:ascii="Avenir Next LT Pro" w:hAnsi="Avenir Next LT Pro"/>
            <w:color w:val="454747"/>
            <w:sz w:val="20"/>
            <w:szCs w:val="20"/>
          </w:rPr>
          <w:t xml:space="preserve">${esc(content)}</w:t>
        </w:r>
      </w:p>`);
      continue;
    }

    // Regular body paragraph
    paras.push(para(trimmed, { color: "454747", sz: 20, after: 40 }));
  }

  return paras.join("\n");
}

// ── Build the replacement body XML ───────────────────────────────────────────
function buildBody(reportText, audience, property, period) {
  const audienceLabel = AUDIENCE_LABELS[audience] || audience;
  const now = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  const title = para(`${property}`, {
    style: "Heading1", bold: true, color: "3D59A1", sz: 40, after: 40,
  });
  const subtitle = para(`${period}  ·  ${audienceLabel}`, {
    bold: false, color: "08BBBF", sz: 22, after: 20,
    font: "Avenir Next LT Pro",
  });
  const dateLine = para(`Generated ${now}`, {
    color: "9ca3af", sz: 18, after: 0,
  });

  const content = parseContent(reportText);

  // sectPr must be last child of body — carry over the original page setup
  const sectPr = `<w:sectPr>
    <w:footerReference w:type="even" r:id="rId13"/>
    <w:footerReference w:type="default" r:id="rId14"/>
    <w:pgSz w:w="12240" w:h="15840"/>
    <w:pgMar w:top="720" w:right="1080" w:bottom="1080" w:left="1080" w:header="720" w:footer="0" w:gutter="0"/>
    <w:pgNumType w:fmt="numberInDash"/>
    <w:cols w:space="720"/>
    <w:docGrid w:linePitch="360"/>
  </w:sectPr>`;

  return `<w:body>
    ${spacer(200)}
    ${title}
    ${subtitle}
    ${dateLine}
    ${spacer(60)}
    ${rulePara()}
    ${spacer(40)}
    ${content}
    ${sectPr}
  </w:body>`;
}

// ── Replace body in document.xml while preserving all namespaces ─────────────
function replaceBody(docXml, newBodyXml) {
  // Swap out everything between <w:body> and </w:body> inclusive
  return docXml.replace(/<w:body>[\s\S]*<\/w:body>/, newBodyXml);
}

// ── Add a simple bullet numbering definition if not already present ───────────
function ensureNumbering(numberingXml) {
  if (!numberingXml) {
    // Minimal numbering.xml with bullet list as numId=1
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0">
      <w:start w:val="1"/>
      <w:numFmt w:val="bullet"/>
      <w:lvlText w:val="•"/>
      <w:lvlJc w:val="left"/>
      <w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>
    </w:lvl>
  </w:abstractNum>
  <w:num w:numId="1">
    <w:abstractNumId w:val="0"/>
  </w:num>
</w:numbering>`;
  }

  // Already has numbering — check if numId 1 exists; if not, append
  if (numberingXml.includes('w:numId="1"')) return numberingXml;

  return numberingXml.replace(
    "</w:numbering>",
    `<w:abstractNum w:abstractNumId="99">
      <w:lvl w:ilvl="0">
        <w:start w:val="1"/><w:numFmt w:val="bullet"/>
        <w:lvlText w:val="•"/><w:lvlJc w:val="left"/>
        <w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>
      </w:lvl>
    </w:abstractNum>
    <w:num w:numId="1"><w:abstractNumId w:val="99"/></w:num>
  </w:numbering>`
  );
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { reportText, audience, property, period } = req.body;
    if (!reportText) return res.status(400).json({ error: "reportText required" });

    // Load letterhead template
    const templatePath = join(__dirname, "assets", "STYL_Letterhead.docx");
    const templateBuf  = readFileSync(templatePath);

    // Unzip
    const zip = await JSZip.loadAsync(templateBuf);

    // Replace document.xml body
    const docXml    = await zip.file("word/document.xml").async("string");
    const newBody   = buildBody(reportText, audience, property || "Property", period || "");
    const newDocXml = replaceBody(docXml, newBody);
    zip.file("word/document.xml", newDocXml);

    // Ensure numbering.xml has a bullet list definition
    const numFile   = zip.file("word/numbering.xml");
    const numXml    = numFile ? await numFile.async("string") : null;
    zip.file("word/numbering.xml", ensureNumbering(numXml));

    // If numbering.xml didn't exist, add its relationship and content type
    if (!numFile) {
      const relsXml = await zip.file("word/_rels/document.xml.rels").async("string");
      zip.file("word/_rels/document.xml.rels",
        relsXml.replace("</Relationships>",
          `<Relationship Id="rId99" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`
        )
      );
      const ctXml = await zip.file("[Content_Types].xml").async("string");
      if (!ctXml.includes("numbering")) {
        zip.file("[Content_Types].xml",
          ctXml.replace("</Types>",
            `<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>`
          )
        );
      }
    }

    // Repack to buffer
    const outBuf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });

    // Build filename
    const safeProp   = (property || "Report").replace(/[^a-zA-Z0-9 _-]/g, "").trim().replace(/ +/g, "_");
    const safePeriod = (period || "").replace(/[^a-zA-Z0-9 _-]/g, "").trim().replace(/ +/g, "_");
    const filename   = `${safeProp}_${safePeriod}_${audience}.docx`;

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.status(200).send(outBuf);

  } catch (err) {
    console.error("export-report error:", err);
    return res.status(500).json({ error: err.message || "Export failed" });
  }
}
