// أدوات طباعة/تصدير الجداول — نفس هوامش فواتير المشتريات (openReportPrint)
import { openReportPrint } from "./invoicePrint";

const escHtml = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

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

export async function exportTableExcel(filename, sheetName, headers, rows) {
  if (!rows?.length && !headers?.length) return alert("لا توجد بيانات للتصدير");
  try {
    const XLSX = await loadXLSX();
    const data = headers?.length ? [headers, ...rows] : rows;
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, (sheetName || "Sheet1").slice(0, 31));
    XLSX.writeFile(wb, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
  } catch (e) {
    alert("خطأ في التصدير: " + e.message);
  }
}

export function printTableReport(company, title, subtitle, headers, rows) {
  if (!rows?.length) return alert("لا توجد بيانات للطباعة");
  const thead = headers.map((h) => `<th>${escHtml(h)}</th>`).join("");
  const tbody = rows
    .map(
      (cells, i) =>
        `<tr style="background:${i % 2 ? "#f1f5f9" : "#fff"}">${cells
          .map((c) => `<td>${escHtml(c)}</td>`)
          .join("")}</tr>`
    )
    .join("");
  openReportPrint({
    title,
    subtitle: subtitle || "",
    company: company || {},
    tableHtml: `<table class="items"><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>`,
  });
}

export function ExportPrintBar({ onExcel, onPrint, disabled }) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button
        type="button"
        onClick={onExcel}
        disabled={disabled}
        style={barBtnSt}
      >
        📊 Excel
      </button>
      <button
        type="button"
        onClick={onPrint}
        disabled={disabled}
        style={barBtnSt}
      >
        🖨 طباعة
      </button>
    </div>
  );
}

const barBtnSt = {
  padding: "6px 14px",
  borderRadius: 8,
  border: "1px solid var(--border, #334155)",
  background: "var(--bg-card, #0f172a)",
  color: "var(--text-secondary, #94a3b8)",
  fontWeight: 700,
  fontSize: ".78rem",
  cursor: "pointer",
  fontFamily: "inherit",
};
