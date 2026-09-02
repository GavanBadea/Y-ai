// تحميل وقراءة ملفات Excel للاستيراد

export async function loadXLSX() {
  if (window.XLSX) return window.XLSX;
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => reject(new Error("فشل تحميل مكتبة Excel"));
    document.head.appendChild(s);
  });
}

export async function downloadExcelTemplate(filename, headers, exampleRows = []) {
  const XLSX = await loadXLSX();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...exampleRows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "البيانات");
  const name = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  XLSX.writeFile(wb, name);
}

export async function parseExcelFile(file) {
  const XLSX = await loadXLSX();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error("الملف لا يحتوي على أوراق عمل");

  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  if (!rows.length) throw new Error("الملف فارغ — أضف صفوف بيانات تحت العناوين");

  return rows.map((row) => {
    const out = {};
    for (const [k, v] of Object.entries(row)) {
      out[String(k).trim()] = v;
    }
    return out;
  });
}

export function formatImportResult(data) {
  const lines = [data?.message || "اكتمل الاستيراد"];
  if (data?.errors?.length) {
    lines.push("");
    lines.push("تفاصيل الأخطاء:");
    data.errors.slice(0, 15).forEach((e) => {
      lines.push(`• صف ${e.row}: ${e.message}`);
    });
    if (data.errors.length > 15) {
      lines.push(`... و${data.errors.length - 15} خطأ آخر`);
    }
  }
  return lines.join("\n");
}
