/**
 * On-device receipt OCR for Firebase cloud mode (no PC backend).
 * tesseract.js is loaded lazily so it does not inflate the main bundle.
 */

export async function extractTextFromImageFile(file, { lang = "eng", onProgress } = {}) {
  if (!file) throw new Error("Image required");
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker(lang, 1, {
    logger: (m) => {
      if (typeof onProgress === "function" && m?.status === "recognizing text" && typeof m.progress === "number") {
        onProgress(m.progress);
      }
    },
  });
  try {
    const result = await worker.recognize(file);
    return String(result?.data?.text || "").trim();
  } finally {
    await worker.terminate().catch(() => {});
  }
}

/** Turn OCR text into grocery-style line suggestions (same shape as cloudApiShim). */
export function grocerySuggestionsFromOcrText(rawText) {
  const text = String(rawText || "");
  const lines = text
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const suggestions = lines.slice(0, 40).map((line, idx) => {
    const priceMatch = line.match(/(\d+(?:\.\d{1,2})?)\s*$/);
    const amount = priceMatch ? Number(priceMatch[1]) : 0;
    const name = priceMatch ? line.slice(0, priceMatch.index).trim() : line;
    return {
      id: `ocr_${idx}`,
      name: name || `Item ${idx + 1}`,
      estimated_price: amount || 0,
      quantity: 1,
      unit: "pcs",
      category: "GENERAL",
      raw_line: line,
    };
  });
  return {
    suggestions,
    suggestion_count: suggestions.length,
    engine: "tesseract_client",
    raw_text: text,
    source: "cloud_local_ocr",
  };
}

/** Expense OCR summary from free text. */
export function expenseParseFromOcrText(rawText) {
  const text = String(rawText || "");
  const lines = text
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  let suggestedTotal = null;
  const totals = [
    ...text.matchAll(/(?:total|grand\s*total|amount|টাকা|মোট)[^\d]*(\d+(?:[.,]\d{1,2})?)/gi),
  ];
  if (totals.length) {
    const last = totals[totals.length - 1][1].replace(",", "");
    suggestedTotal = Number(last) || null;
  }
  if (suggestedTotal == null) {
    const nums = [...text.matchAll(/(\d+(?:\.\d{1,2})?)/g)].map((m) => Number(m[1]));
    if (nums.length) suggestedTotal = Math.max(...nums);
  }
  return {
    suggested_total: suggestedTotal,
    line_count: lines.length,
    lines: lines.slice(0, 50),
    raw_text: text,
    engine: "tesseract_client",
    source: "cloud_local_ocr",
  };
}
