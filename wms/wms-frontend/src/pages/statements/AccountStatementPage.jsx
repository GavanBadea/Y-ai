// ============================================================
//  src/pages/statements/AccountStatementPage.jsx
//  كشف حسابات الزبائن والموردين — وحدة مستقلة
//
//  Props:
//   type: 'customer' | 'supplier'
//
//  الميزات:
//   ✅ فلترة حسب الطرف ونطاق التاريخ
//   ✅ جدول مع الرصيد التراكمي
//   ✅ تصدير Excel (.xlsx) — SheetJS من CDN
//   ✅ طباعة / تصدير PDF — نافذة طباعة مُنسَّقة A4
//   ✅ إرسال PDF عبر واتساب — للزبون/المورد عند توفر رقم الهاتف
//   ✅ RBAC — محمي بصلاحية can_manage_finance
// ============================================================
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import AppLayout from "@/components/layout/AppLayout";
import api       from "@/services/api";
import { lookupService } from "@/services/api";
import { useNumberLocale } from "@/context/NumberLocaleContext";
import { useCompany, companyLogoUrl } from "@/context/CompanyContext";
import { fmtN, fmtC, fmtDate, fmtDateTime } from "@/utils/numFormat";
import { useRegisterWorkTab } from "@/hooks/useRegisterWorkTab";
import { getToken } from "@/utils/authStorage";

/** مبلغ العرض في عمود مدين/دائن — الفواتير النقدية تظهر دون دخول الرصيد */
const isInvoiceRow = (r) => /فاتورة (بيع|شر)/.test(String(r.txType || ""));

/** عرض قيمة الفاتورة كاملة — وليس المتبقي أو الرصيد التراكمي */
const cellDebit  = (r) => {
  if (r.txType === "مرتجع مشتريات") return r.debit || 0;
  if (r.txType === "مرتجع مبيعات") return 0;
  if (r.invoiceAmount > 0 && isInvoiceRow(r) && /فاتورة ب/.test(r.txType)) return r.invoiceAmount;
  return r.debit || r.displayDebit || 0;
};
const cellCredit = (r) => {
  if (r.txType === "مرتجع مبيعات") return r.credit || 0;
  if (r.txType === "مرتجع مشتريات") return 0;
  if (r.invoiceAmount > 0 && isInvoiceRow(r) && /فاتورة ش/.test(r.txType)) return r.invoiceAmount;
  return r.credit || r.displayCredit || 0;
};
const isCashOnly = (r) => !r.debit && !r.credit && (r.displayDebit || r.displayCredit);

// ── ثوابت ───────────────────────────────────────────────────
const today    = new Date().toISOString().split("T")[0];
const yearStart = `${new Date().getFullYear()}-01-01`;
const PROGRAMMER_FOOTER = "المبرمج Gavan 07504505340";

const escPrint = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const formatTxWhen = (r) => fmtDateTime(r.txDateTime || r.txDate);

/** ترتيب حركات الكشف مع إعادة حساب الرصيد التراكمي */
function sortStatementDisplayRows(rows, dir, supplierStyle) {
  const r2 = (n) => Math.round((+n || 0) * 100) / 100;
  const rowKey = (r) => `${r.txType}|${r.txRef}`;
  const cmpReg = (a, b) => {
    const ta = new Date(a.txDateTime || a.txDate || 0).getTime();
    const tb = new Date(b.txDateTime || b.txDate || 0).getTime();
    if (ta !== tb) return ta - tb;
    const sa = Number(a.txSeq ?? a.txRef ?? 0);
    const sb = Number(b.txSeq ?? b.txRef ?? 0);
    return sa - sb;
  };
  const regSeqMap = new Map();
  [...rows].sort(cmpReg).forEach((r, idx) => regSeqMap.set(rowKey(r), idx + 1));

  const sorted = [...rows].sort((a, b) => {
    const ta = new Date(a.txDateTime || a.txDate || 0).getTime();
    const tb = new Date(b.txDateTime || b.txDate || 0).getTime();
    if (ta !== tb) return dir === "asc" ? ta - tb : tb - ta;
    const sa = Number(a.txSeq ?? a.txRef ?? 0);
    const sb = Number(b.txSeq ?? b.txRef ?? 0);
    return dir === "asc" ? sa - sb : sb - sa;
  });
  let balance = 0;
  return sorted.map((r) => {
    const d = +(r.debit || 0);
    const c = +(r.credit || 0);
    balance = supplierStyle ? r2(balance + c - d) : r2(balance + d - c);
    return { ...r, balance, regSeq: regSeqMap.get(rowKey(r)) ?? 0 };
  });
}

const STMT_PATH = {
  customer: "/customer-statement",
  supplier: "/supplier-statement",
  mandob: "/mandob-statement",
};

const PARTY_CFG = {
  customer: {
    listEndpoint: "/statements/customers-list",
    stmtEndpoint: "/statements/customer",
    idKey: "id_Zabon",
    partyLabel: "الزبون",
    docTitle: "الزبون",
    pageTitle: "كشف حساب الزبائن",
    supplierBalance: false,
    icon: "👤",
    emptyDesc: "يشمل الكشف: فواتير البيع · مرتجعات المبيعات · الديون السابقة · سندات القبض · السماح",
  },
  supplier: {
    listEndpoint: "/statements/suppliers-list",
    stmtEndpoint: "/statements/supplier",
    idKey: "id_Amil",
    partyLabel: "المورد",
    docTitle: "المورد",
    pageTitle: "كشف حساب الموردين",
    supplierBalance: true,
    icon: "🏭",
    emptyDesc: "يشمل الكشف: فواتير الشراء · مرتجعات المشتريات · الديون السابقة · سندات الدفع",
  },
  mandob: {
    listEndpoint: "/statements/mandobs-list",
    stmtEndpoint: "/statements/mandob",
    idKey: "id_Mandob",
    partyLabel: "المندوب",
    docTitle: "المندوب",
    pageTitle: "كشف حساب المندوبين",
    supplierBalance: false,
    icon: "🏅",
    emptyDesc: "يشمل الكشف: فواتير البيع · مرتجعات المبيعات · سندات قبض لزبائن المندوب",
  },
};

const TYPE_LABELS = {
  "فاتورة بيع"       : { color: "#ef4444", bg: "rgba(239,68,68,.10)"  },
  "فاتورة بيع (نقدي)": { color: "#ef4444", bg: "rgba(239,68,68,.10)"  },
  "قبض فوري"         : { color: "#10b981", bg: "rgba(16,185,129,.10)" },
  "فاتورة شراء"      : { color: "#3b82f6", bg: "rgba(59,130,246,.10)" },
  "فاتورة شراء (نقدي)": { color: "#3b82f6", bg: "rgba(59,130,246,.10)" },
  "دفع فوري"         : { color: "#f59e0b", bg: "rgba(245,158,11,.10)" },
  "مرتجع مبيعات"    : { color: "#f97316", bg: "rgba(249,115,22,.10)" },
  "مرتجع مشتريات"   : { color: "#a855f7", bg: "rgba(168,85,247,.10)" },
  "دين سابق"         : { color: "#f59e0b", bg: "rgba(245,158,11,.10)" },
  "سند قبض"          : { color: "#10b981", bg: "rgba(16,185,129,.10)" },
  "سند دفع"          : { color: "#10b981", bg: "rgba(16,185,129,.10)" },
  "سماح"             : { color: "#d97706", bg: "rgba(217,119,6,.12)"  },
};

// ── تحميل SheetJS من CDN ─────────────────────────────────────
async function loadXLSX() {
  if (window.XLSX) return window.XLSX;
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    s.onload  = () => resolve(window.XLSX);
    s.onerror = () => reject(new Error("فشل تحميل مكتبة XLSX"));
    document.head.appendChild(s);
  });
}

async function loadHtml2Pdf() {
  if (window.html2pdf) return window.html2pdf;
  const mod = await import("html2pdf.js");
  const fn = mod.default || mod;
  window.html2pdf = fn;
  return fn;
}

const blobToBase64 = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || "").split(",")[1] || "");
    reader.onerror = () => reject(new Error("فشل تحويل PDF"));
    reader.readAsDataURL(blob);
  });

// ══════════════════════════════════════════════════════════
//  دالة تصدير Excel
// ══════════════════════════════════════════════════════════
async function exportExcel(rows, totals, partyName, dateFrom, dateTo, docTitle) {
  if (!rows.length) return alert("لا توجد بيانات للتصدير");
  try {
    const XLSX = await loadXLSX();

    // ترويسة المعلومات
    const header = [
      [`كشف حساب ${docTitle}: ${partyName}`],
      [`الفترة: من ${dateFrom} إلى ${dateTo}`],
      [`تاريخ الطباعة: ${today}`],
      [],
      ["تسلسل", "تاريخ التسجيل", "نوع الحركة", "نوع الدفع", "رقم السند", "الملاحظة", "مدين", "دائن", "الرصيد"],
    ];

    // صفوف البيانات
    const dataRows = rows.map((r) => [
      r.regSeq || "",
      formatTxWhen(r),
      r.txType,
      r.txSubType || "",
      r.txRef,
      r.txNote || "",
      cellDebit(r)  || "",
      cellCredit(r) || "",
      r.balance,
    ]);

    // صف الإجماليات
    const footerRows = [
      [],
      ["", "", "", "", "الإجماليات", totals.totalDebit, totals.totalCredit, totals.finalBalance],
      ...(totals.totalAllowance > 0 ? [["", "", "", "", "مجموع السماح", "", totals.totalAllowance, ""]] : []),
    ];

    const allRows = [...header, ...dataRows, ...footerRows];
    const ws = XLSX.utils.aoa_to_sheet(allRows);

    // عرض الأعمدة
    ws["!cols"] = [
      { wch: 6 }, { wch: 18 }, { wch: 16 }, { wch: 12 }, { wch: 8 },
      { wch: 30 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "كشف الحساب");
    XLSX.writeFile(wb, `كشف_${partyName}_${dateFrom}_${dateTo}.xlsx`);
  } catch (err) {
    alert("خطأ في تصدير Excel: " + err.message);
  }
}

// ── هامش علوي: شعار + اسم الشركة ← مقابل → عنوان الكشف والفترة ──
function statementPageHeaderHtml(coName, logoUrl, cfg, dateFrom, dateTo, { compact = false } = {}) {
  const logoHtml = logoUrl
    ? `<img src="${escPrint(logoUrl)}" alt="" style="max-height:${compact ? 56 : 72}px;max-width:${compact ? 120 : 150}px;object-fit:contain;display:block;flex-shrink:0;" />`
    : "";
  const nameSize = compact ? "14px" : "17px";
  const titleSize = compact ? "14px" : "17px";
  const metaSize = compact ? "10px" : "10.5px";
  const borderColor = compact ? "#000" : "#003399";

  return `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;width:100%;padding-bottom:10px;margin-bottom:12px;border-bottom:3px solid ${borderColor};">
      <div style="display:flex;align-items:center;justify-content:flex-start;gap:14px;flex:1;min-width:0;">
        ${logoHtml}
        <div style="font-size:${nameSize};font-weight:900;color:#003399;line-height:1.35;word-break:break-word;">${escPrint(coName)}</div>
      </div>
      <div style="text-align:left;flex-shrink:0;min-width:0;color:#000;">
        <div style="font-size:${titleSize};font-weight:900;color:#003399;line-height:1.35;white-space:nowrap;">كشف حساب ${escPrint(cfg.docTitle)}</div>
        <div style="font-size:${metaSize};font-weight:700;margin-top:4px;white-space:nowrap;">الفترة: ${dateFrom} → ${dateTo}</div>
        <div style="font-size:${metaSize};font-weight:700;margin-top:2px;white-space:nowrap;">تاريخ الطباعة: ${today}</div>
      </div>
    </div>`;
}

// ══════════════════════════════════════════════════════════
//  بناء HTML كشف الحساب — للطباعة وإنشاء PDF
// ══════════════════════════════════════════════════════════
function buildStatementHtml(rows, totals, partyName, dateFrom, dateTo, cfg, company = {}, logoUrl = null) {
  const isCustomer = !cfg.supplierBalance;
  const coName = company.CompanyInformation_Name || "اسم الشركة";
  const mobile = company.CompanyInformation_Mobile || "";
  const address = company.CompanyInformation_Adress || "";

  const pageHeader = statementPageHeaderHtml(coName, logoUrl, cfg, dateFrom, dateTo);

  const tdBase = "padding:7px 5px;text-align:center;vertical-align:middle;border:1px solid #666;color:#111;font-weight:600;font-size:10.5px;";
  const tableRows = rows.map((r) => `
    <tr style="background:${(r.regSeq || 0) % 2 === 0 ? "#ffffff" : "#ececec"};">
      <td style="${tdBase}font-family:Consolas,monospace;font-weight:700;">${r.regSeq || ""}</td>
      <td style="${tdBase}">${formatTxWhen(r)}</td>
      <td style="${tdBase}">${r.txType}${r.txSubType ? ` (${r.txSubType})` : ""}</td>
      <td style="${tdBase}font-family:Consolas,monospace;font-weight:700;">${r.txRef}</td>
      <td style="${tdBase}">${r.txNote || ""}</td>
      <td style="${tdBase}font-family:Consolas,monospace;color:#b00000;font-weight:800;">${cellDebit(r)  ? fmtC(cellDebit(r))  : ""}</td>
      <td style="${tdBase}font-family:Consolas,monospace;color:#006400;font-weight:800;">${cellCredit(r) ? fmtC(cellCredit(r)) : ""}</td>
      <td style="${tdBase}font-family:Consolas,monospace;color:${r.balance >= 0 ? "#003399" : "#b00000"};font-weight:900;">${fmtC(r.balance)}</td>
    </tr>`).join("");

  const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <title> </title>
  <style>
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; font-family: "Segoe UI", Tahoma, Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html, body {
      height: 100%;
      margin: 0;
      padding: 0;
      direction: rtl;
      color: #000;
      font-size: 11px;
      background: #fff;
    }
    .wrap {
      max-width: 820px;
      margin: 0 auto;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      padding: 12mm 10mm 10mm;
      background: #fff;
      color: #000;
    }
    .main { flex: 1 0 auto; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
                 background: #e0e0e0; border: 1px solid #666; border-radius: 6px;
                 padding: 10px 14px; margin-bottom: 14px; text-align: center; color: #000; }
    .info-item { font-size: 11px; font-weight: 600; color: #000; }
    .info-item span { font-weight: 800; }
    .tbl-wrap { width: 100%; overflow: hidden; }
    table { width: 100%; border-collapse: collapse; font-size: 10.5px; table-layout: fixed; border: 2px solid #333; }
    th, td { text-align: center; vertical-align: middle; padding: 7px 5px; word-wrap: break-word; }
    th { background: #003399; color: #fff; font-weight: 800; border: 1px solid #002266; }
    td { border: 1px solid #666; color: #111; font-weight: 600; }
    .totals-row { background: #d8d8d8; font-weight: 800; }
    .totals-row td { border-top: 2px solid #003399; padding: 9px 5px; color: #000; }
    .ftr {
      margin-top: auto;
      padding: 12px 8px 4px;
      border-top: 2px solid #333;
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      align-items: center;
      gap: 8px 20px;
      font-size: 0.8rem;
      color: #111;
      font-weight: 600;
      text-align: center;
    }
    .ftr-item { white-space: nowrap; }
    .ftr-sep { color: #444; user-select: none; }
    .ftr-dev { font-weight: 800; color: #000; }
    @media print {
      html, body { height: auto; min-height: 100%; color: #000 !important; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .wrap { min-height: 100vh; page-break-inside: avoid; }
      .ftr { position: fixed; bottom: 0; left: 0; right: 0; background: #fff; padding: 10px 12mm; }
      .main { padding-bottom: 48px; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="main">
    ${pageHeader}

    <div class="info-grid">
      <div class="info-item">اسم ${cfg.partyLabel}: <span>${partyName}</span></div>
      <div class="info-item">عدد الحركات: <span>${rows.length}</span></div>
      <div class="info-item">إجمالي المدين: <span style="color:#b00000;font-weight:900;">${fmtN(totals.totalDebit)}</span></div>
      <div class="info-item">إجمالي الدائن: <span style="color:#006400;font-weight:900;">${fmtN(totals.totalCredit)}</span></div>
    </div>

    <div class="tbl-wrap">
      <table>
        <thead>
          <tr>
            <th style="width:5%;background:#003399;color:#fff;font-weight:800;border:1px solid #002266;">تسلسل</th>
            <th style="width:11%;background:#003399;color:#fff;font-weight:800;border:1px solid #002266;">تاريخ التسجيل</th>
            <th style="width:16%;background:#003399;color:#fff;font-weight:800;border:1px solid #002266;">نوع الحركة</th>
            <th style="width:10%;background:#003399;color:#fff;font-weight:800;border:1px solid #002266;">رقم السند</th>
            <th style="width:22%;background:#003399;color:#fff;font-weight:800;border:1px solid #002266;">الملاحظة</th>
            <th style="width:13%;background:#003399;color:#fff;font-weight:800;border:1px solid #002266;">مدين</th>
            <th style="width:13%;background:#003399;color:#fff;font-weight:800;border:1px solid #002266;">دائن</th>
            <th style="width:15%;background:#003399;color:#fff;font-weight:800;border:1px solid #002266;">الرصيد</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
        <tfoot>
          <tr class="totals-row">
            <td colspan="5" style="padding:9px 5px;border:1px solid #666;color:#000;font-weight:900;">الإجماليات</td>
            <td style="padding:9px 5px;border:1px solid #666;color:#b00000;font-weight:900;font-family:Consolas,monospace;">${fmtN(totals.totalDebit)}</td>
            <td style="padding:9px 5px;border:1px solid #666;color:#006400;font-weight:900;font-family:Consolas,monospace;">${fmtN(totals.totalCredit)}</td>
            <td style="padding:9px 5px;border:1px solid #666;color:${totals.finalBalance >= 0 ? "#003399" : "#b00000"};font-weight:900;font-family:Consolas,monospace;">
              ${fmtN(totals.finalBalance)}
              <div style="font-size:9px;font-weight:700;margin-top:2px;color:#111;">
                ${totals.finalBalance >= 0
                  ? (isCustomer ? "(مدين لنا)" : "(ندين له)")
                  : (isCustomer ? "(دائن له)" : "(يدين لنا)")}
              </div>
            </td>
          </tr>
          ${isCustomer && totals.totalAllowance > 0 ? `
          <tr class="totals-row">
            <td colspan="4" style="padding:9px 5px;border:1px solid #666;color:#92400e;font-weight:900;">مجموع السماح</td>
            <td style="padding:9px 5px;border:1px solid #666;"></td>
            <td style="padding:9px 5px;border:1px solid #666;color:#d97706;font-weight:900;font-family:Consolas,monospace;">${fmtN(totals.totalAllowance)}</td>
            <td style="padding:9px 5px;border:1px solid #666;"></td>
          </tr>` : ""}
        </tfoot>
      </table>
    </div>
    </div>

    <footer class="ftr">
      ${[
        mobile ? `<span class="ftr-item">📞 ${escPrint(mobile)}</span>` : "",
        address ? `<span class="ftr-item">📍 ${escPrint(address)}</span>` : "",
        `<span class="ftr-item ftr-dev">${escPrint(PROGRAMMER_FOOTER)}</span>`,
      ].filter(Boolean).join('<span class="ftr-sep">|</span>')}
    </footer>
  </div>
</body>
</html>`;

  return html;
}

// ══════════════════════════════════════════════════════════
//  بناء HTML كشف الحساب — نسخة واتساب PDF (مضغوطة وواضحة)
// ══════════════════════════════════════════════════════════
/** تسمية + قيمة — يمنع انقلاب (:) والأرقام في PDF العربي */
const waPair = (label, value, valueStyle = "") =>
  `<span style="unicode-bidi:isolate;white-space:nowrap;">${label}&nbsp;<b dir="ltr" style="unicode-bidi:isolate;${valueStyle}">${value}</b></span>`;

const waBalanceLine = (amount, note) =>
  `<span style="display:block;direction:rtl;unicode-bidi:plaintext;text-align:center;">` +
  `<span dir="ltr" style="unicode-bidi:isolate;font-weight:900;">${amount}</span>` +
  `<span style="unicode-bidi:isolate;font-size:9px;font-weight:800;">&nbsp;${note}</span></span>`;

const blobToDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("فشل قراءة الشعار"));
    reader.readAsDataURL(blob);
  });

/** تحميل الشعار كـ data URL — ضروري لظهوره في PDF (html2canvas) */
async function loadLogoDataUrl(logoPath) {
  const url = companyLogoUrl(logoPath);
  if (!url) return null;
  if (String(url).startsWith("data:")) return url;
  try {
    const token = getToken();
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return url;
    const blob = await res.blob();
    const dataUrl = await blobToDataUrl(blob);
    return dataUrl || url;
  } catch {
    return url;
  }
}

function buildStatementWhatsAppHtml(rows, totals, partyName, dateFrom, dateTo, cfg, company = {}, logoUrl = null) {
  const isCustomer = !cfg.supplierBalance;
  const coName = company.CompanyInformation_Name || "اسم الشركة";
  const mobile = company.CompanyInformation_Mobile || "";
  const address = company.CompanyInformation_Adress || "";
  const balanceNote = totals.finalBalance >= 0
    ? (isCustomer ? "مدين لنا" : "ندين له")
    : (isCustomer ? "دائن له" : "يدين لنا");

  const pageHeader = statementPageHeaderHtml(coName, logoUrl, cfg, dateFrom, dateTo, { compact: true });

  const tdBase = "padding:6px 4px;text-align:center;vertical-align:middle;border:2px solid #000;color:#000;font-weight:700;font-size:10px;background:#fff;";
  const tableRows = rows.map((r) => `
    <tr style="background:${(r.regSeq || 0) % 2 === 0 ? "#ffffff" : "#e8e8e8"};">
      <td style="${tdBase}font-family:Consolas,monospace;">${r.regSeq || ""}</td>
      <td style="${tdBase}">${formatTxWhen(r)}</td>
      <td style="${tdBase}">${r.txType}${r.txSubType ? ` (${r.txSubType})` : ""}</td>
      <td style="${tdBase}font-family:Consolas,monospace;font-weight:800;">${r.txRef}</td>
      <td style="${tdBase}">${r.txNote || ""}</td>
      <td style="${tdBase}font-family:Consolas,monospace;color:#b00000;font-weight:900;">${cellDebit(r)  ? fmtC(cellDebit(r))  : ""}</td>
      <td style="${tdBase}font-family:Consolas,monospace;color:#006400;font-weight:900;">${cellCredit(r) ? fmtC(cellCredit(r)) : ""}</td>
      <td style="${tdBase}font-family:Consolas,monospace;color:${r.balance >= 0 ? "#003399" : "#b00000"};font-weight:900;">${fmtC(r.balance)}</td>
    </tr>`).join("");

  const thSt = "padding:7px 4px;background:#003399;color:#fff;font-weight:900;border:2px solid #000;font-size:10px;text-align:center;";
  const ftrParts = [
    mobile ? waPair("هاتف", escPrint(mobile), "color:#000;font-weight:800;") : "",
    address ? `<span style="unicode-bidi:isolate;color:#000;font-weight:800;">عنوان ${escPrint(address)}</span>` : "",
    `<span style="unicode-bidi:isolate;color:#000;font-weight:900;">${escPrint(PROGRAMMER_FOOTER)}</span>`,
  ].filter(Boolean);

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <title> </title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: "Segoe UI", Tahoma, Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html, body { background: #fff; color: #000; direction: rtl; font-size: 11px; }
  </style>
</head>
<body style="background:#fff;color:#000;padding:0;margin:0;">
  <div class="wrap" style="max-width:800px;margin:0 auto;padding:8px 10px;background:#fff;color:#000;">

    ${pageHeader}

    <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:6px 12px;border:2px solid #000;background:#e8e8e8;padding:7px 10px;margin-bottom:8px;font-size:10px;color:#000;font-weight:800;">
      ${waPair(cfg.partyLabel, escPrint(partyName))}
      ${waPair("الحركات", rows.length)}
      ${waPair("مدين", fmtN(totals.totalDebit), "color:#b00000;font-weight:900;")}
      ${waPair("دائن", fmtN(totals.totalCredit), "color:#006400;font-weight:900;")}
      ${waPair("الرصيد", fmtN(totals.finalBalance), `color:${totals.finalBalance >= 0 ? "#003399" : "#b00000"};font-weight:900;`)}
    </div>

    <table style="width:100%;border-collapse:collapse;border:3px solid #000;table-layout:fixed;background:#fff;">
      <thead>
        <tr>
          <th style="${thSt}width:5%;">تسلسل</th>
          <th style="${thSt}width:11%;">تاريخ التسجيل</th>
          <th style="${thSt}width:15%;">نوع الحركة</th>
          <th style="${thSt}width:9%;">رقم السند</th>
          <th style="${thSt}width:22%;">الملاحظة</th>
          <th style="${thSt}width:13%;">مدين</th>
          <th style="${thSt}width:13%;">دائن</th>
          <th style="${thSt}width:15%;">الرصيد</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
      <tfoot>
        <tr style="background:#d0d0d0;">
          <td colspan="5" style="padding:8px 4px;border:2px solid #000;color:#000;font-weight:900;font-size:10px;text-align:center;">الإجماليات</td>
          <td style="padding:8px 4px;border:2px solid #000;color:#b00000;font-weight:900;font-family:Consolas,monospace;font-size:10px;text-align:center;">${fmtN(totals.totalDebit)}</td>
          <td style="padding:8px 4px;border:2px solid #000;color:#006400;font-weight:900;font-family:Consolas,monospace;font-size:10px;text-align:center;">${fmtN(totals.totalCredit)}</td>
          <td style="padding:8px 4px;border:2px solid #000;color:#000;font-size:10px;text-align:center;">
            ${waBalanceLine(fmtN(totals.finalBalance), balanceNote)}
          </td>
        </tr>
      </tfoot>
    </table>

    <footer style="display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:8px 16px;border-top:3px solid #000;padding:8px 4px 2px;margin-top:10px;font-size:10px;background:#fff;">
      ${ftrParts.join('<span style="color:#000;font-weight:900;"> | </span>')}
    </footer>
  </div>
</body>
</html>`;
}

const waitFrameImages = (doc) =>
  Promise.all(
    [...doc.images].map(
      (img) =>
        img.complete
          ? Promise.resolve()
          : new Promise((resolve) => {
              img.onload = resolve;
              img.onerror = resolve;
            })
    )
  );

/** iframe مخفي بأبعاد A4 كاملة — يضمن ظهور المحتوى في الطباعة و PDF */
function mountStatementFrame(html) {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", " ");
  iframe.style.cssText =
    "position:fixed;left:-10000px;top:0;width:820px;height:1200px;border:0;visibility:hidden;background:#fff";
  document.body.appendChild(iframe);
  const win = iframe.contentWindow;
  const doc = win.document;
  doc.open();
  doc.write(html);
  doc.close();
  return { iframe, win, doc };
}

const waitFrameReady = (iframe, doc) =>
  new Promise((resolve) => {
    const done = () => setTimeout(resolve, 120);
    if (doc.readyState === "complete") done();
    else iframe.onload = done;
  });

// ══════════════════════════════════════════════════════════
//  دالة الطباعة — نافذة A4 منسّقة مع شعار
// ══════════════════════════════════════════════════════════
async function printStatement(rows, totals, partyName, dateFrom, dateTo, cfg, company = {}) {
  if (!rows.length) return alert("لا توجد بيانات للطباعة");
  const logoUrl = companyLogoUrl(company?.CompanyInformation_Logo);
  const html = buildStatementHtml(rows, totals, partyName, dateFrom, dateTo, cfg, company, logoUrl);
  const { iframe, win, doc } = mountStatementFrame(html);
  const cleanup = () => { try { document.body.removeChild(iframe); } catch { /* ignore */ } };

  await waitFrameReady(iframe, doc);
  await waitFrameImages(doc);
  await new Promise((r) => setTimeout(r, 120));
  try { doc.title = " "; } catch { /* ignore */ }
  win.focus();
  win.print();
  setTimeout(cleanup, 2000);
}

// ══════════════════════════════════════════════════════════
//  إنشاء ملف PDF من كشف الحساب
// ══════════════════════════════════════════════════════════
async function generateStatementPdfBlob(rows, totals, partyName, dateFrom, dateTo, cfg, company = {}, logoPath = null) {
  const logoDataUrl = await loadLogoDataUrl(logoPath);
  const html = buildStatementWhatsAppHtml(rows, totals, partyName, dateFrom, dateTo, cfg, company, logoDataUrl);
  const { iframe, doc } = mountStatementFrame(html);

  try {
    await waitFrameReady(iframe, doc);
    await waitFrameImages(doc);
    await new Promise((r) => setTimeout(r, 150));
    const target = doc.querySelector(".wrap") || doc.body;
    const html2pdf = await loadHtml2Pdf();
    return await html2pdf()
      .set({
        margin       : [8, 8, 8, 8],
        filename     : "statement.pdf",
        image        : { type: "jpeg", quality: 0.92 },
        // scale أقل = ملف أصغر — يمنع تعليق واتساب/انهيار السيرفر عند الإرسال
        html2canvas  : { scale: 1.5, useCORS: true, logging: false, backgroundColor: "#ffffff", letterRendering: true },
        jsPDF        : { unit: "mm", format: "a4", orientation: "portrait" },
        pagebreak    : { mode: ["avoid-all", "css", "legacy"] },
      })
      .from(target)
      .outputPdf("blob");
  } finally {
    try { document.body.removeChild(iframe); } catch { /* ignore */ }
  }
}

// ══════════════════════════════════════════════════════════
//  المكوّن الرئيسي
// ══════════════════════════════════════════════════════════
export default function AccountStatementPage({ type }) {
  const cfg = PARTY_CFG[type] || PARTY_CFG.customer;
  const isCustomer = !cfg.supplierBalance;
  const { fmtC } = useNumberLocale();
  const { company } = useCompany();

  // ── حالة الفلترة ─────────────────────────────────────────
  const [partyId,   setPartyId]   = useState("");
  const [cashBoxId, setCashBoxId] = useState("");
  const [cashBoxes, setCashBoxes] = useState([]);
  const [dateFrom,  setDateFrom]  = useState(yearStart);
  const [dateTo,    setDateTo]    = useState(today);
  const [parties,   setParties]   = useState([]);
  const [search,    setSearch]    = useState("");

  // ── حالة البيانات ─────────────────────────────────────────
  const [rows,      setRows]      = useState([]);
  const [totals,    setTotals]    = useState(null);
  const [partyInfo, setPartyInfo] = useState(null);
  const [loading,   setLoading]   = useState(false);
  const [fetched,   setFetched]   = useState(false);
  const [error,     setError]     = useState("");
  const [exporting, setExporting] = useState(false);
  const [sendingWa, setSendingWa] = useState(false);
  const [toast, setToast]       = useState(null);
  const [dateSortDir, setDateSortDir] = useState("asc");

  const abortRef = useRef(null);
  const toastTimerRef = useRef(null);
  const canWhatsApp = (type === "customer" || type === "supplier") && !!(partyInfo?.mobile || "").trim();

  const showToast = useCallback((kind, title, message, autoHideMs = 4200) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ kind, title, message });
    if (autoHideMs > 0) {
      toastTimerRef.current = setTimeout(() => setToast(null), autoHideMs);
    }
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  // ── تحميل قائمة الأطراف عند الدخول ─────────────────────
  useEffect(() => {
    api.get(cfg.listEndpoint)
      .then((r) => setParties(r.data || []))
      .catch(() => setParties([]));
    lookupService.getCashBoxes()
      .then((r) => setCashBoxes(r.data || []))
      .catch(() => setCashBoxes([]));
  }, [cfg.listEndpoint]);

  // ── جلب الكشف ────────────────────────────────────────────
  const fetchStatement = useCallback(async () => {
    if (!cashBoxId && !partyId) {
      setError("يرجى اختيار " + cfg.partyLabel + " أو صندوق");
      return;
    }
    setError(""); setLoading(true); setFetched(false); setRows([]); setTotals(null);

    try {
      const r = cashBoxId
        ? await api.get("/statements/cash-box", { params: { id_CashBox: cashBoxId, from: dateFrom, to: dateTo } })
        : await api.get(cfg.stmtEndpoint, { params: { [cfg.idKey]: partyId, from: dateFrom, to: dateTo } });
      if (r.success) {
        setRows(r.data || []);
        setTotals(r.totals);
        setPartyInfo(r.party);
      } else {
        setError(r.message || "خطأ في جلب البيانات");
      }
    } catch (e) {
      setError(e.message || "خطأ في الاتصال");
    } finally {
      setLoading(false);
      setFetched(true);
    }
  }, [partyId, cashBoxId, dateFrom, dateTo, cfg]);

  const displayRows = useMemo(
    () => sortStatementDisplayRows(rows, dateSortDir, cfg.supplierBalance),
    [rows, dateSortDir, cfg.supplierBalance]
  );

  const stmtPath = STMT_PATH[type] || STMT_PATH.customer;
  useRegisterWorkTab({
    id: `stmt-${type}-${cashBoxId || partyId}`,
    title: cashBoxId
      ? `صندوق: ${cashBoxes.find((b) => String(b.id_CashBox) === String(cashBoxId))?.CashBoxName || cashBoxId}`
      : `كشف ${partyInfo?.name || partyId}`,
    path: stmtPath,
    active: fetched && rows.length > 0 && !!(cashBoxId || partyId),
  });

  // ── قائمة الأطراف المصفاة ────────────────────────────────
  const filteredParties = parties.filter((p) =>
    !search || p.name.includes(search) || (p.mobile || "").includes(search)
  );

  // ── تصدير Excel ──────────────────────────────────────────
  const handleExcelExport = async () => {
    setExporting(true);
    await exportExcel(displayRows, totals, partyInfo?.name || "", dateFrom, dateTo, cfg.docTitle);
    setExporting(false);
  };

  // ── طباعة ────────────────────────────────────────────────
  const handlePrint = async () => {
    await printStatement(displayRows, totals, partyInfo?.name || "", dateFrom, dateTo, cfg, company);
  };

  // ── إرسال كشف الحساب نصاً عبر واتساب (مستقر — بدون PDF/Puppeteer) ─
  const handleSendWhatsApp = async () => {
    const phone = (partyInfo?.mobile || "").trim();
    if (!phone) {
      showToast("error", "لا يوجد رقم هاتف", `أضف رقم هاتف لهذا ${cfg.partyLabel} أولاً`);
      return;
    }
    if (!rows.length) {
      showToast("error", "لا توجد بيانات", "اعرض الكشف أولاً ثم أعد المحاولة");
      return;
    }

    const partyName = partyInfo?.name || "";
    const maxRows = 35;
    const lines = [
      `كشف حساب ${cfg.docTitle}: ${partyName}`,
      `الفترة: ${dateFrom} → ${dateTo}`,
      company?.CompanyInformation_Name ? `الشركة: ${company.CompanyInformation_Name}` : "",
      "",
      "الحركات:",
    ].filter((x) => x !== "");

    displayRows.slice(0, maxRows).forEach((r, i) => {
      const debit = cellDebit(r);
      const credit = cellCredit(r);
      lines.push(
        `${i + 1}) ${r.txDate || ""} | ${r.txType || ""} #${r.txRef || ""}` +
        ` | مدين ${debit ? fmtC(debit) : "0"}` +
        ` | دائن ${credit ? fmtC(credit) : "0"}` +
        ` | رصيد ${fmtC(r.balance ?? 0)}`
      );
    });
    if (rows.length > maxRows) {
      lines.push(`... و ${rows.length - maxRows} حركة أخرى`);
    }
    lines.push("");
    lines.push(`إجمالي المدين: ${fmtC(totals?.totalDebit ?? 0)}`);
    lines.push(`إجمالي الدائن: ${fmtC(totals?.totalCredit ?? 0)}`);
    lines.push(`الرصيد الختامي: ${fmtC(totals?.finalBalance ?? 0)}`);

    const message = lines.join("\n");

    setSendingWa(true);
    showToast("sending", "جاري الإرسال", `يتم إرسال كشف الحساب إلى ${partyName}...`, 0);

    try {
      const waStatus = await api.get("/whatsapp/status");
      if (!waStatus?.isConnected) {
        throw new Error("واتساب غير متصل — يرجى ربطه من إعدادات «ربط واتساب» أولاً");
      }

      await api.post(
        "/statements/send-whatsapp",
        { phone, message },
        { timeout: 45000 }
      );

      showToast(
        "success",
        "تم الإرسال بنجاح",
        `أُرسل كشف الحساب إلى ${partyName} (${phone})`
      );
    } catch (e) {
      showToast("error", "تعذّر الإرسال", e?.message || "فشل إرسال كشف الحساب");
    } finally {
      setSendingWa(false);
    }
  };

  // ── ألوان الرصيد ──────────────────────────────────────────
  const balanceColor = (b) =>
    b > 0 ? "#1d4ed8" : b < 0 ? "#dc2626" : "var(--text-secondary)";

  const partyLabel = cfg.partyLabel;

  return (
    <AppLayout
      title={cfg.pageTitle}
      actions={
        fetched && rows.length > 0 ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <ActionBtn onClick={handlePrint} color="#1d4ed8" icon="🖨">
              طباعة / PDF
            </ActionBtn>
            <ActionBtn onClick={handleExcelExport} color="#16a34a" icon="📊" disabled={exporting}>
              {exporting ? "جاري..." : "Excel تصدير"}
            </ActionBtn>
            {canWhatsApp && (
              <ActionBtn onClick={handleSendWhatsApp} color="#128C7E" icon="📲" disabled={sendingWa}>
                {sendingWa ? "جاري الإرسال..." : "إرسال واتساب"}
              </ActionBtn>
            )}
          </div>
        ) : null
      }
    >
      {toast && <StatementToast {...toast} onClose={() => setToast(null)} />}

      {/* ── بطاقة الفلاتر ──────────────────────────────────── */}
      <div style={{
        background: "var(--bg-card)", border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)", padding: "18px 20px", marginBottom: 20,
      }}>
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 140px 140px auto",
          gap: 12, alignItems: "flex-end",
        }}>

          {/* اختيار الطرف */}
          <div>
            <label style={labelSt}>{partyLabel}</label>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                type="text"
                placeholder={`بحث ${partyLabel}...`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ ...inputSt, width: 140, fontSize: ".8rem" }}
              />
              <select
                value={partyId}
                onChange={(e) => { setPartyId(e.target.value); setFetched(false); }}
                style={{ ...inputSt, flex: 1 }}
              >
                <option value="">— اختر {partyLabel} —</option>
                {filteredParties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.mobile ? ` — ${p.mobile}` : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label style={labelSt}>الصندوق</label>
            <select
              value={cashBoxId}
              onChange={(e) => { setCashBoxId(e.target.value); setFetched(false); }}
              style={{ ...inputSt, width: "100%" }}
            >
              <option value="">— بدون فلتر صندوق —</option>
              {cashBoxes.map((b) => (
                <option key={b.id_CashBox} value={b.id_CashBox}>{b.CashBoxName}</option>
              ))}
            </select>
          </div>

          {/* من تاريخ */}
          <div>
            <label style={labelSt}>من تاريخ</label>
            <input type="date" value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)} style={inputSt} />
          </div>

          {/* إلى تاريخ */}
          <div>
            <label style={labelSt}>إلى تاريخ</label>
            <input type="date" value={dateTo}
              onChange={(e) => setDateTo(e.target.value)} style={inputSt} />
          </div>

          {/* زر جلب */}
          <button
            onClick={fetchStatement}
            disabled={loading}
            style={{
              padding: "9px 22px", background: "var(--accent)", color: "#fff",
              border: "none", borderRadius: "var(--radius-md)", fontWeight: 700,
              fontSize: ".9rem", cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? .7 : 1, fontFamily: "var(--font-main)",
              whiteSpace: "nowrap",
            }}
          >
            {loading ? "جاري..." : "🔍 عرض الكشف"}
          </button>
        </div>

        {error && (
          <div style={{ marginTop: 12, color: "var(--danger)", fontSize: ".85rem", fontWeight: 600 }}>
            ⚠ {error}
          </div>
        )}
      </div>

      {/* ── بطاقة ملخص الطرف ───────────────────────────────── */}
      {partyInfo && totals && (
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
          gap: 12, marginBottom: 20,
        }}>
          <SummaryCard
            label={partyLabel} value={partyInfo.name}
            sub={partyInfo.mobile || partyInfo.location || ""}
            color="#6366f1" isText
          />
          <SummaryCard
            label="إجمالي المدين" value={fmtC(totals.totalDebit)}
            sub="الحركات المدينة" color="#ef4444"
          />
          <SummaryCard
            label="إجمالي الدائن" value={fmtC(totals.totalCredit)}
            sub="الحركات الدائنة" color="#10b981"
          />
          <SummaryCard
            label="الرصيد الختامي"
            value={fmtC(Math.abs(totals.finalBalance))}
            sub={totals.finalBalance >= 0
              ? (isCustomer ? "مدين لنا" : "ندين له")
              : (isCustomer ? "دائن له"  : "يدين لنا")}
            color={totals.finalBalance >= 0 ? "#1d4ed8" : "#dc2626"}
          />
        </div>
      )}

      {/* ── جدول الحركات ───────────────────────────────────── */}
      {loading && (
        <div style={{ textAlign: "center", padding: 60, color: "var(--text-secondary)" }}>
          <div className="spinner" style={{ width: 32, height: 32, margin: "0 auto 12px" }} />
          جاري تحميل الكشف...
        </div>
      )}

      {!loading && fetched && rows.length === 0 && (
        <div style={{
          textAlign: "center", padding: 60,
          background: "var(--bg-card)", border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)", color: "var(--text-secondary)",
        }}>
          <div style={{ fontSize: "2.5rem", marginBottom: 12 }}>📄</div>
          <p style={{ fontWeight: 600 }}>لا توجد حركات في هذه الفترة</p>
          <p style={{ fontSize: ".85rem", marginTop: 4 }}>جرّب تغيير نطاق التاريخ</p>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div style={{
          background: "var(--bg-card)", border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)", overflow: "hidden",
        }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".84rem" }}>
              <thead>
                <tr style={{ background: "var(--bg-surface)" }}>
                  {["تسلسل", "تاريخ التسجيل", "نوع الحركة", "رقم السند", "الملاحظة", "مدين", "دائن", "الرصيد"].map((h, i) => (
                    <th key={i} style={{
                      padding: "10px 12px", textAlign: i >= 5 ? "left" : "right",
                      fontWeight: 700, fontSize: ".72rem", color: "var(--text-secondary)",
                      textTransform: "uppercase", letterSpacing: ".04em",
                      borderBottom: "2px solid var(--border)", whiteSpace: "nowrap",
                    }}>
                      {i === 1 ? (
                        <button
                          type="button"
                          onClick={() => setDateSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                          title={dateSortDir === "asc" ? "الأقدم تسجيلاً أولاً — انقر للأحدث" : "الأحدث تسجيلاً أولاً — انقر للأقدم"}
                          style={{
                            display: "inline-flex", alignItems: "center", gap: 4,
                            background: "none", border: "none", padding: 0, margin: 0,
                            cursor: "pointer", font: "inherit", color: "inherit",
                            fontWeight: 700, letterSpacing: ".04em",
                          }}
                        >
                          {h}
                          <span style={{ fontSize: ".85rem", color: "var(--accent)", lineHeight: 1 }}>
                            {dateSortDir === "asc" ? "↑" : "↓"}
                          </span>
                        </button>
                      ) : h}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {displayRows.map((r, i) => {
                  const typeStyle = TYPE_LABELS[r.txType] || { color: "#64748b", bg: "transparent" };
                  return (
                    <tr key={i}
                      style={{ borderBottom: "1px solid var(--border-subtle)" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = ""; }}
                    >
                      {/* تسلسل */}
                      <td style={{ padding: "8px 12px", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: ".75rem", fontWeight: 700 }}>
                        {r.regSeq || i + 1}
                      </td>

                      {/* تاريخ التسجيل */}
                      <td style={{ padding: "8px 12px", fontFamily: "var(--font-mono)", fontWeight: 600, whiteSpace: "nowrap" }}>
                        {formatTxWhen(r)}
                      </td>

                      {/* نوع الحركة */}
                      <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>
                        <span style={{
                          display: "inline-block", padding: "2px 10px",
                          borderRadius: 99, fontSize: ".73rem", fontWeight: 700,
                          color: typeStyle.color, background: typeStyle.bg,
                          border: `1px solid ${typeStyle.color}40`,
                        }}>
                          {r.txType}
                        </span>
                        {r.txSubType && (
                          <span style={{ fontSize: ".7rem", color: "var(--text-muted)", marginRight: 6 }}>
                            ({r.txSubType})
                          </span>
                        )}
                      </td>

                      {/* رقم السند */}
                      <td style={{ padding: "8px 12px", fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--accent)", textAlign: "right" }}>
                        #{r.txRef}
                      </td>

                      {/* الملاحظة */}
                      <td style={{ padding: "8px 12px", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-secondary)", fontSize: ".8rem" }}>
                        {r.txNote || "—"}
                      </td>

                      {/* مدين */}
                      <td style={{ padding: "8px 12px", textAlign: "left", fontFamily: "var(--font-mono)", fontWeight: cellDebit(r) ? 700 : 400, color: cellDebit(r) ? "#ef4444" : "var(--text-muted)", fontStyle: isCashOnly(r) ? "italic" : "normal" }}>
                        {cellDebit(r) ? fmtC(cellDebit(r)) : "—"}
                      </td>

                      {/* دائن */}
                      <td style={{ padding: "8px 12px", textAlign: "left", fontFamily: "var(--font-mono)", fontWeight: cellCredit(r) ? 700 : 400, color: cellCredit(r) ? "#10b981" : "var(--text-muted)", fontStyle: isCashOnly(r) ? "italic" : "normal" }}>
                        {cellCredit(r) ? fmtC(cellCredit(r)) : "—"}
                      </td>

                      {/* الرصيد التراكمي */}
                      <td style={{ padding: "8px 12px", textAlign: "left", fontFamily: "var(--font-mono)", fontWeight: 800, fontSize: ".88rem", color: balanceColor(r.balance) }}>
                        {fmtC(r.balance)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>

              {/* صف الإجماليات */}
              {totals && (
                <tfoot>
                  <tr style={{ background: "var(--bg-surface)", borderTop: "2px solid var(--border)" }}>
                    <td colSpan={5} style={{ padding: "10px 12px", fontWeight: 700, color: "var(--text-secondary)", fontSize: ".82rem" }}>
                      الإجماليات — {rows.length} حركة
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "left", fontFamily: "var(--font-mono)", fontWeight: 900, color: "#ef4444", fontSize: ".9rem" }}>
                      {fmtC(totals.totalDebit)}
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "left", fontFamily: "var(--font-mono)", fontWeight: 900, color: "#10b981", fontSize: ".9rem" }}>
                      {fmtC(totals.totalCredit)}
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "left", fontFamily: "var(--font-mono)", fontWeight: 900, fontSize: "1rem", color: balanceColor(totals.finalBalance) }}>
                      {fmtC(totals.finalBalance)}
                      <span style={{ display: "block", fontSize: ".68rem", fontWeight: 500, color: "var(--text-muted)", marginTop: 1 }}>
                        {totals.finalBalance >= 0
                          ? (isCustomer ? "مدين لنا" : "ندين له")
                          : (isCustomer ? "دائن له"  : "يدين لنا")}
                      </span>
                    </td>
                  </tr>
                  {(isCustomer || cashBoxId) && Number(totals.totalAllowance || 0) > 0 && (
                    <tr style={{ background: "rgba(217,119,6,.08)", borderTop: "1px solid var(--border)" }}>
                      <td colSpan={5} style={{ padding: "10px 12px", fontWeight: 800, color: "#92400e", fontSize: ".82rem" }}>
                        مجموع السماح
                      </td>
                      <td style={{ padding: "10px 12px" }}>—</td>
                      <td style={{ padding: "10px 12px", textAlign: "left", fontFamily: "var(--font-mono)", fontWeight: 900, color: "#d97706", fontSize: ".9rem" }}>
                        {fmtC(totals.totalAllowance)}
                      </td>
                      <td style={{ padding: "10px 12px" }}>—</td>
                    </tr>
                  )}
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {/* ── حالة أولية — قبل أي بحث ─────────────────────────── */}
      {!loading && !fetched && (
        <div style={{
          textAlign: "center", padding: 60,
          background: "var(--bg-card)", border: "1px dashed var(--border)",
          borderRadius: "var(--radius-lg)", color: "var(--text-muted)",
        }}>
          <div style={{ fontSize: "3rem", marginBottom: 12 }}>
            {cfg.icon}
          </div>
          <p style={{ fontWeight: 600, fontSize: ".95rem" }}>
            اختر {partyLabel} ونطاق التاريخ ثم اضغط "عرض الكشف"
          </p>
          <p style={{ fontSize: ".82rem", marginTop: 6 }}>
            {cfg.emptyDesc}
          </p>
        </div>
      )}
    </AppLayout>
  );
}

// ══════════════════════════════════════════════════════════
//  مكوّنات مساعدة صغيرة
// ══════════════════════════════════════════════════════════

function SummaryCard({ label, value, sub, color, isText }) {
  return (
    <div style={{
      background: "var(--bg-card)", border: "1px solid var(--border)",
      borderRadius: "var(--radius-lg)", padding: "14px 16px",
      borderTop: `3px solid ${color}`,
    }}>
      <div style={{ fontSize: ".72rem", color: "var(--text-secondary)", fontWeight: 600, marginBottom: 6, textTransform: "uppercase", letterSpacing: ".04em" }}>
        {label}
      </div>
      <div style={{ fontSize: isText ? "1rem" : "1.2rem", fontWeight: 800, color, fontFamily: isText ? "inherit" : "var(--font-mono)", lineHeight: 1.2, wordBreak: "break-word" }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: ".72rem", color: "var(--text-muted)", marginTop: 4 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function ActionBtn({ children, onClick, color, icon, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "7px 14px", background: color, color: "#fff",
        border: "none", borderRadius: "var(--radius-md)",
        fontWeight: 700, fontSize: ".82rem", cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? .7 : 1, fontFamily: "var(--font-main)",
        transition: "opacity .15s",
      }}
    >
      <span>{icon}</span> {children}
    </button>
  );
}

const TOAST_CFG = {
  success: { icon: "✓", bg: "linear-gradient(135deg,#128C7E,#25D366)", border: "#1faa59" },
  error  : { icon: "!", bg: "linear-gradient(135deg,#b91c1c,#ef4444)", border: "#f87171" },
  sending: { icon: "↻", bg: "linear-gradient(135deg,#1d4ed8,#3b82f6)", border: "#60a5fa" },
};

function StatementToast({ kind, title, message, onClose }) {
  const t = TOAST_CFG[kind] || TOAST_CFG.success;
  return (
    <div
      role="status"
      style={{
        position: "fixed",
        bottom: 28,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 9999,
        minWidth: 300,
        maxWidth: "min(92vw, 440px)",
        padding: "14px 18px 14px 16px",
        background: t.bg,
        border: `1px solid ${t.border}`,
        borderRadius: 14,
        boxShadow: "0 12px 40px rgba(0,0,0,.35), 0 0 0 1px rgba(255,255,255,.08) inset",
        color: "#fff",
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        animation: "stmtToastIn .35s cubic-bezier(.22,1,.36,1)",
        fontFamily: "var(--font-main)",
      }}
    >
      <style>{`
        @keyframes stmtToastIn {
          from { opacity: 0; transform: translateX(-50%) translateY(16px) scale(.96); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
        }
        @keyframes stmtSpin { to { transform: rotate(360deg); } }
      `}</style>
      <div style={{
        width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
        background: "rgba(255,255,255,.2)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontWeight: 900, fontSize: kind === "sending" ? "1.1rem" : ".95rem",
        animation: kind === "sending" ? "stmtSpin 1s linear infinite" : "none",
      }}>
        {t.icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: ".92rem", marginBottom: 3 }}>{title}</div>
        <div style={{ fontSize: ".8rem", opacity: .95, lineHeight: 1.45 }}>{message}</div>
      </div>
      {kind !== "sending" && (
        <button
          type="button"
          onClick={onClose}
          aria-label="إغلاق"
          style={{
            background: "rgba(255,255,255,.15)", border: "none", color: "#fff",
            width: 26, height: 26, borderRadius: 8, cursor: "pointer",
            fontSize: ".85rem", flexShrink: 0,
          }}
        >✕</button>
      )}
    </div>
  );
}

// ── أنماط مشتركة ─────────────────────────────────────────
const inputSt = {
  background: "var(--bg-input)", border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)", color: "var(--text-primary)",
  padding: "8px 10px", fontSize: ".85rem", fontFamily: "var(--font-main)",
  outline: "none", width: "100%",
};

const labelSt = {
  display: "block", fontSize: ".72rem", fontWeight: 700,
  color: "var(--text-secondary)", marginBottom: 4,
  textTransform: "uppercase", letterSpacing: ".04em",
};
