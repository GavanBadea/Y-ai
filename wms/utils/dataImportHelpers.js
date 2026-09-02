// مساعدات مشتركة لاستيراد البيانات من Excel (صفوف JSON من الواجهة)

function str(v) {
  if (v == null) return "";
  return String(v).trim();
}

function num(v) {
  const n = Number(String(v ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function normalizeRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row || {})) {
    out[String(k).trim()] = v;
  }
  return out;
}

function pick(row, ...keys) {
  for (const k of keys) {
    const v = str(row[k]);
    if (v) return v;
  }
  return "";
}

function importResult(added, skipped, errors) {
  const failed = errors.length;
  const parts = [];
  if (added)   parts.push(`أُضيف ${added}`);
  if (skipped) parts.push(`تُخطّى ${skipped}`);
  if (failed)  parts.push(`فشل ${failed}`);
  return {
    success : failed === 0 || added > 0,
    added,
    skipped,
    failed,
    errors,
    message : parts.length ? parts.join(" — ") : "لم يُستورد أي سجل",
  };
}

module.exports = { str, num, normalizeRow, pick, importResult };
