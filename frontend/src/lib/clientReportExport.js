/**
 * Client-side report exports for cloud-local mode (no backend / no Firebase Storage).
 * Excel → .xls (SpreadsheetML HTML that Excel/Sheets open)
 * PDF → minimal text PDF
 */

function cellText(value) {
  if (value == null) return "";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function escapeHtml(s) {
  return cellText(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeXml(s) {
  return cellText(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function flattenRows(rows) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (!list.length) return { headers: ["message"], rows: [["No data"]] };
  const headers = [...new Set(list.flatMap((row) => Object.keys(row || {})))];
  const body = list.map((row) => headers.map((h) => cellText(row?.[h])));
  return { headers, rows: body };
}

/** Prefer readable columns for common finance exports. */
export function normalizeReportRows(type, payload) {
  const list = Array.isArray(payload) ? payload : [];
  if (type === "transactions" || type === "cashflow") {
    return list.map((tx) => ({
      id: tx?.id ?? "",
      date: tx?.transaction_date || tx?.date || tx?.created_at || "",
      type: tx?.transaction_type || tx?.type || "",
      amount: tx?.amount ?? "",
      currency: tx?.currency || "",
      wallet_id: tx?.wallet_id || tx?.account_id || "",
      category_id: tx?.category_id || "",
      note: tx?.note || tx?.description || tx?.title || "",
    }));
  }
  if (type === "goals") {
    return list.map((g) => ({
      kind: g?.kind || "",
      id: g?.id ?? "",
      name: g?.name || g?.title || "",
      target_amount: g?.target_amount ?? g?.goal_amount ?? "",
      current_amount: g?.current_amount ?? g?.saved_amount ?? "",
      status: g?.status || "",
      currency: g?.currency || "",
    }));
  }
  return list;
}

export function buildExcelBlob(rows, sheetName = "Report") {
  const { headers, rows: body } = flattenRows(rows);
  const safeSheet = String(sheetName || "Report")
    .replace(/[^\w\s-]/g, "")
    .slice(0, 31) || "Report";

  const headerCells = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("");
  const bodyRows = body
    .map((cols) => `<tr>${cols.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`)
    .join("");

  const html = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="UTF-8" />
<!--[if gte mso 9]><xml>
 <x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
  <x:Name>${escapeXml(safeSheet)}</x:Name>
  <x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
 </x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook>
</xml><![endif]-->
</head>
<body>
<table border="1">
<thead><tr>${headerCells}</tr></thead>
<tbody>${bodyRows}</tbody>
</table>
</body>
</html>`;

  return new Blob([html], {
    type: "application/vnd.ms-excel;charset=utf-8",
  });
}

function pdfEscape(text) {
  return cellText(text)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

/**
 * Minimal multi-line PDF (Helvetica). Good enough for tabular exports.
 */
export function buildPdfBlob(rows, title = "S4 Report") {
  const { headers, rows: body } = flattenRows(rows);
  const lines = [];
  lines.push(String(title || "S4 Report"));
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push(headers.join(" | "));
  lines.push("-".repeat(Math.min(100, Math.max(20, headers.join(" | ").length))));
  for (const cols of body.slice(0, 500)) {
    const line = cols.map((c) => (c.length > 40 ? `${c.slice(0, 37)}...` : c)).join(" | ");
    lines.push(line || " ");
  }
  if (body.length > 500) {
    lines.push(`... and ${body.length - 500} more rows`);
  }

  const pageWidth = 842; // landscape A4-ish
  const pageHeight = 595;
  const fontSize = 9;
  const leading = 12;
  const marginX = 36;
  const marginTop = 40;
  const maxLinesPerPage = Math.floor((pageHeight - marginTop - 36) / leading);

  const pages = [];
  for (let i = 0; i < lines.length; i += maxLinesPerPage) {
    pages.push(lines.slice(i, i + maxLinesPerPage));
  }
  if (!pages.length) pages.push(["No data"]);

  const objects = [];
  const addObj = (content) => {
    objects.push(content);
    return objects.length;
  };

  const kids = [];
  const contentIds = [];

  for (const pageLines of pages) {
    const contentParts = [
      "BT",
      `/F1 ${fontSize} Tf`,
      `${leading} TL`,
      `${marginX} ${pageHeight - marginTop} Td`,
    ];
    pageLines.forEach((line, idx) => {
      const safe = pdfEscape(line).slice(0, 180);
      if (idx === 0) contentParts.push(`(${safe}) Tj`);
      else contentParts.push(`T* (${safe}) Tj`);
    });
    contentParts.push("ET");
    const contentId = addObj(
      `<< /Length ${contentParts.join("\n").length} >>\nstream\n${contentParts.join("\n")}\nendstream`
    );
    contentIds.push(contentId);
  }

  const fontId = addObj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  for (let i = 0; i < pages.length; i += 1) {
    const pageId = addObj(
      `<< /Type /Page /Parent 0 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents ${contentIds[i]} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`
    );
    kids.push(pageId);
  }

  const pagesId = addObj(`<< /Type /Pages /Kids [${kids.map((id) => `${id} 0 R`).join(" ")}] /Count ${kids.length} >>`);
  // Patch parent refs in page objects
  for (let i = 0; i < kids.length; i += 1) {
    const id = kids[i];
    objects[id - 1] = objects[id - 1].replace("/Parent 0 0 R", `/Parent ${pagesId} 0 R`);
  }

  const catalogId = addObj(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i <= objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\n`;
  pdf += `startxref\n${xrefStart}\n%%EOF`;

  return new Blob([pdf], { type: "application/pdf" });
}

export function buildReportExportBlob({ type, format, payload }) {
  const rows = normalizeReportRows(type, payload);
  const fmt = String(format || "").toLowerCase();
  if (fmt === "pdf") {
    return {
      blob: buildPdfBlob(rows, `S4 ${String(type || "report").toUpperCase()} Report`),
      fileName: `s4_${type}_report.pdf`,
    };
  }
  // excel (default tabular)
  return {
    blob: buildExcelBlob(rows, String(type || "Report")),
    fileName: `s4_${type}_report.xls`,
  };
}
