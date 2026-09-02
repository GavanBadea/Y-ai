// طباعة فواتير المبيعات والمشتريات — قالب موحّد
import { r2, fmtC, fmtN, fmtDate } from "@/utils/numFormat";

const PROGRAMMER = "المبرمج Gavan 07504505340";

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const isDeferredPay = (name = "") => {
  const n = String(name).trim();
  return n === "آجل" || n === "اجل" || n.toLowerCase() === "deferred" || n.toLowerCase() === "credit";
};

const isCashPay = (name = "") => {
  const n = String(name).trim();
  return n === "نقد" || n === "نقدي" || n.toLowerCase() === "cash";
};

/** مجاميع الطباعة — قيمة الفاتورة كاملة (وليس المتبقي فقط) */
function sumPurchaseExtrasGross(h = {}) {
  return r2(
    +(h.Trans || 0) + +(h.Customs || 0) + +(h.Porter || 0) +
    +(h.SGS || 0) + +(h.ExportRelease || 0) + +(h.VehicleManifest || 0)
  );
}

function salesInvoiceWeightKg(lines = []) {
  return r2(
    lines.reduce((s, l) => {
      const w = +(l.WeightKg ?? 0);
      const qty = +(l.AmountOUT ?? l.qty ?? 0);
      const gift = +(l.gift_qty ?? l.gift ?? 0);
      return s + w * (qty + gift);
    }, 0)
  );
}

function buildPrintTotals(subtotal, discount, addition, afterDiscount, previousBalance, opts = {}) {
  const { paidAmount = 0, isDeferred = false, isCash = false, lcExtrasGross = 0 } = opts;
  const prev = r2(previousBalance || 0);
  const after = r2(afterDiscount ?? (+(subtotal || 0) - +(discount || 0) + +(addition || 0)));
  const paid = r2(isCash ? after : Math.min(Math.max(0, +paidAmount || 0), after));
  const remainDue = r2(Math.max(0, after - paid));
  return {
    subtotal: r2(subtotal || 0),
    discount: r2(discount || 0),
    addition: r2(addition || 0),
    lcExtrasGross: r2(lcExtrasGross || 0),
    afterDiscount: after,
    paidAmount: paid,
    remainDue,
    previousBalance: prev,
    finalBalance: isDeferred ? r2(prev + after - paid) : prev,
    isCash,
  };
}

function mapLine(l, i, kind) {
  const qty = +(kind === "purchase" ? l.AmountIN : l.AmountOUT) || 0;
  const gift = +(kind === "purchase" ? l.Gift_IN : l.gift_qty) || 0;
  const price = +(kind === "purchase" ? l.PriceIN : l.PriceOUT) || 0;
  const total =
    kind === "purchase"
      ? r2(qty * price)
      : l.LineTotal != null
        ? +l.LineTotal
        : r2(qty * price);
  return {
    seq: i + 1,
    name: l.MaterialName || "—",
    barcode: l.Barcode || "—",
    qty,
    gift,
    price,
    total,
    WeightKg: +(l.WeightKg ?? 0),
    lineWeight: r2((+(l.WeightKg ?? 0)) * (qty + gift)),
  };
}

function driverMetaRows(meta = {}) {
  const rows = [];
  if (meta.driverName)
    rows.push(`<div class="meta-item"><span class="ml">اسم السائق</span><span class="mv">${esc(meta.driverName)}</span></div>`);
  if (meta.driverMobile)
    rows.push(`<div class="meta-item"><span class="ml">رقم الهاتف</span><span class="mv">${esc(meta.driverMobile)}</span></div>`);
  if (meta.vehicleNumber)
    rows.push(`<div class="meta-item"><span class="ml">رقم المركبة</span><span class="mv accent">${esc(meta.vehicleNumber)}</span></div>`);
  return rows.join("");
}

const PRINT_PAGE_CSS = `
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body {
    height: 100%;
    font-family: "Segoe UI", Tahoma, Arial, sans-serif;
    font-size: 13px;
    color: #1a1f2e;
    margin: 0;
    padding: 0;
    background: #fff;
  }
  .wrap {
    max-width: 820px;
    margin: 0 auto;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    padding: 12mm 10mm 10mm;
  }
  .main { flex: 1 0 auto; }
  .hdr {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 28px;
    min-height: 118px;
    padding: 22px 20px 20px;
    border-bottom: 4px solid #b8860b;
    margin-bottom: 16px;
    background: linear-gradient(180deg, #fafbfc 0%, #fff 100%);
  }
  .hdr-co { flex: 1; text-align: right; }
  .hdr-co h1 {
    margin: 0 0 10px;
    font-size: 2.15rem;
    font-weight: 900;
    color: #0f172a;
    line-height: 1.2;
    letter-spacing: -0.02em;
  }
  .hdr-co .sub {
    font-size: 1.05rem;
    color: #475569;
    line-height: 1.65;
    font-weight: 600;
    max-width: 520px;
    margin-right: 0;
    margin-left: auto;
  }
  .inv-type {
    display: inline-block;
    margin-top: 14px;
    padding: 9px 26px;
    background: linear-gradient(135deg, #1a1a2e 0%, #2a3568 55%, #1a1a2e 100%);
    color: #f0bb2a;
    font-size: 1.12rem;
    font-weight: 800;
    border-radius: 10px;
    letter-spacing: 0.04em;
    border: 2px solid #b8860b;
    box-shadow: 0 2px 8px rgba(26, 26, 46, 0.12);
  }
  .inv-type.purchase { border-color: #2563eb; color: #dbeafe; background: linear-gradient(135deg, #1e3a5f, #1a1a2e); }
  .inv-type.sales { border-color: #b8860b; }
  .inv-type.report { border-color: #2563eb; color: #dbeafe; }
  .hdr-logo { flex-shrink: 0; text-align: left; padding-left: 8px; }
  .hdr-logo img { max-height: 96px; max-width: 160px; object-fit: contain; display: block; }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 24px;
    padding: 12px 14px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    margin-bottom: 16px;
  }
  .meta-item { min-width: 140px; }
  .ml { display: block; font-size: 0.68rem; font-weight: 700; color: #64748b; text-transform: uppercase; margin-bottom: 3px; }
  .mv { font-weight: 700; color: #0f172a; }
  .mv.accent { color: #b8860b; font-family: Consolas, monospace; }
  table.items {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 18px;
    font-size: 12px;
  }
  table.items th {
    background: #1a1a2e;
    color: #fff;
    padding: 10px 8px;
    font-weight: 700;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  table.items th, table.items td { border: 1px solid #cbd5e1; }
  table.items td { padding: 8px; vertical-align: middle; }
  table.items tr:nth-child(even) { background: #f1f5f9; }
  table.items .c { text-align: center; width: 36px; color: #64748b; font-weight: 600; }
  table.items .name { text-align: right; font-weight: 700; }
  table.items .bc { font-family: Consolas, monospace; font-size: 0.78rem; color: #475569; text-align: center; }
  table.items .n { text-align: left; font-family: Consolas, monospace; font-weight: 600; }
  table.items .total { color: #b8860b; font-weight: 800; }
  table.items tfoot td { background: #f0f4ff; font-weight: 800; border-top: 2px solid #1a1a2e; }
  table.items .weight { color: #800020; font-weight: 800; text-align: left; font-family: Consolas, monospace; }
  .bottom { display: flex; justify-content: flex-end; margin-bottom: 12px; }
  .totals {
    min-width: 300px;
    padding: 14px 18px;
    border: 1px dashed #c4a84d;
    border-radius: 12px;
    background: linear-gradient(145deg, rgba(250, 251, 252, 0.95) 0%, #fff 100%);
    box-shadow:
      0 0 0 1px rgba(184, 134, 11, 0.1),
      inset 0 1px 0 rgba(255, 255, 255, 0.95);
  }
  .tot-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 2px;
    border-bottom: 1px dotted #e2e8f0;
  }
  .tot-row:last-child:not(.tot-weight) {
    border-bottom: none;
    margin-top: 6px;
    padding-top: 12px;
    border-top: 2px solid #b8860b;
    font-weight: 900;
  }
  .tot-row.tot-final {
    border-bottom: none;
    margin-top: 6px;
    padding-top: 12px;
    border-top: 2px solid #b8860b;
    font-weight: 900;
  }
  .tot-row.tot-weight {
    border-bottom: none;
    margin-top: 4px;
    padding-top: 10px;
    border-top: 1px solid #800020;
  }
  .tot-row.tot-weight .tot-l,
  .tot-row.tot-weight .tot-v {
    color: #800020;
    font-weight: 900;
  }
  .tot-l { font-size: 0.9rem; color: #334155; }
  .tot-v { font-family: Consolas, monospace; font-weight: 800; color: #0f172a; }
  .ftr {
    margin-top: auto;
    padding: 12px 8px 4px;
    border-top: 2px solid #b8860b;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: 8px 20px;
    font-size: 0.8rem;
    color: #475569;
    text-align: center;
  }
  .ftr-item { white-space: nowrap; }
  .ftr-sep { color: #cbd5e1; user-select: none; }
  .ftr-dev { font-weight: 700; color: #1a1a2e; }
  .report-sub { font-size: 0.95rem; color: #475569; margin: 0 0 14px; }
  @media print {
    html, body { height: auto; min-height: 100%; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .wrap { min-height: 100vh; page-break-inside: avoid; }
    .ftr { position: fixed; bottom: 0; left: 0; right: 0; background: #fff; padding: 10px 12mm; }
    .main { padding-bottom: 88px; }
  }
`;

/** بناء HTML كامل للطباعة */
export function buildInvoicePrintHtml(payload) {
  const {
    kind = "sales",
    company = {},
    logoUrl = null,
    meta = {},
    lines = [],
    totals = {},
  } = payload;

  const coName = company.CompanyInformation_Name || "اسم الشركة";
  const isReturn = String(kind).startsWith("return-");
  const typeTitle =
    kind === "purchase" ? "فاتورة مشتريات"
    : kind === "return-purchase" ? "مرتجع مشتريات"
    : kind === "return-sales" ? "مرتجع مبيعات"
    : "فاتورة مبيعات";
  const invTypeClass =
    kind === "purchase" || kind === "return-purchase" ? "purchase" : "sales";
  const docNoLabel = isReturn ? "رقم السند" : "رقم الفاتورة";
  const mobile = company.CompanyInformation_Mobile || "";
  const address = company.CompanyInformation_Adress || "";
  const infoExtra = [company.CompanyInformation_Info1, company.CompanyInformation_Info2]
    .filter(Boolean)
    .join("  |  ");

  const lineRows = lines.map((l, i) =>
    typeof l.qty === "number" && l.name != null ? l : mapLine(l, i, kind)
  );
  const totalQty = lineRows.reduce((s, l) => s + (+l.qty || 0), 0);
  const isSalesPrint = kind === "sales";
  const totalWeightKg = r2(
    totals.totalWeightKg != null && totals.totalWeightKg !== ""
      ? +totals.totalWeightKg
      : lineRows.reduce((s, l) => s + (+l.lineWeight || 0), 0)
  );

  const rows = lineRows
    .map(
      (l) => isSalesPrint
        ? `
    <tr>
      <td class="c">${l.seq}</td>
      <td class="name">${esc(l.name)}</td>
      <td class="bc">${esc(l.barcode)}</td>
      <td class="n">${fmtN(l.qty)}</td>
      <td class="n">${fmtN(l.gift)}</td>
      <td class="n weight">${fmtN(+(l.lineWeight ?? ((+l.WeightKg || 0) * ((+l.qty || 0) + (+l.gift || 0)))))}</td>
      <td class="n">${fmtC(l.price)}</td>
      <td class="n total">${fmtC(l.total)}</td>
    </tr>`
        : `
    <tr>
      <td class="c">${l.seq}</td>
      <td class="name">${esc(l.name)}</td>
      <td class="bc">${esc(l.barcode)}</td>
      <td class="n">${fmtN(l.qty)}</td>
      <td class="n">${fmtN(l.gift)}</td>
      <td class="n">${fmtC(l.price)}</td>
      <td class="n total">${fmtC(l.total)}</td>
    </tr>`
    )
    .join("");

  const totEntries = isReturn
    ? [["إجمالي المرتجع", totals.afterDiscount ?? totals.subtotal]]
    : [
    ["مجموع الفاتورة", totals.subtotal],
    kind === "purchase" && totals.lcExtrasGross > 0 ? ["مصاريف LC", totals.lcExtrasGross] : null,
    totals.discount > 0 ? ["الخصم", totals.discount] : null,
    kind !== "purchase" && totals.addition > 0 ? ["الإضافة", totals.addition] : null,
    ["مجموع بعد الخصم", totals.afterDiscount],
    kind === "purchase" && (totals.isCash || totals.paidAmount > 0)
      ? ["المدفوع من الفاتورة", totals.paidAmount]
      : kind !== "purchase"
        ? ["المبلغ المدفوع", totals.paidAmount ?? 0]
        : null,
    ["الحساب السابق", totals.previousBalance],
    ["الحساب النهائي", totals.finalBalance],
  ].filter(Boolean);

  const totRows = totEntries
    .map(
      ([label, val]) => `
    <div class="tot-row${label === "الحساب النهائي" ? " tot-final" : ""}">
      <span class="tot-l">${label}</span>
      <span class="tot-v">${fmtC(Math.abs(+val || 0))}</span>
    </div>`
    )
    .join("");

  const salesWeightRow =
    isSalesPrint
      ? `
    <div class="tot-row tot-weight">
      <span class="tot-l">مجموع الوزن</span>
      <span class="tot-v">${fmtN(totalWeightKg)} كغم</span>
    </div>`
      : "";

  const mandobRow =
    kind === "sales" && meta.mandobName
      ? `<div class="meta-item"><span class="ml">المندوب</span><span class="mv">${esc(meta.mandobName)}</span></div>`
      : "";

  const partyLabel = meta.partyLabel || (kind === "purchase" || kind === "return-purchase" ? "المورد" : "الزبون");

  const payTypeRow = meta.payTypeName
    ? `<div class="meta-item"><span class="ml">طريقة الدفع</span><span class="mv">${esc(meta.payTypeName)}</span></div>`
    : "";

  const noteRow = isReturn && meta.note
    ? `<div class="meta-item"><span class="ml">ملاحظة</span><span class="mv">${esc(meta.note)}</span></div>`
    : "";

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8"/>
<title> </title>
<style>${PRINT_PAGE_CSS}</style>
</head>
<body>
<div class="wrap">
  <header class="hdr">
    <div class="hdr-co">
      <h1>${esc(coName)}</h1>
      ${infoExtra ? `<div class="sub">${esc(infoExtra)}</div>` : ""}
      <div class="inv-type ${invTypeClass}">${esc(typeTitle)}</div>
    </div>
    <div class="hdr-logo">${logoUrl ? `<img src="${esc(logoUrl)}" alt=""/>` : ""}</div>
  </header>

  <div class="main">
  <section class="meta">
    <div class="meta-item"><span class="ml">${esc(docNoLabel)}</span><span class="mv accent">#${esc(meta.invoiceNo)}</span></div>
    <div class="meta-item"><span class="ml">التاريخ</span><span class="mv">${esc(fmtDate(meta.date))}</span></div>
    ${payTypeRow}
    ${mandobRow}
    ${noteRow}
    <div class="meta-item"><span class="ml">${esc(partyLabel)}</span><span class="mv">${esc(meta.partyName)}</span></div>
    ${driverMetaRows(meta)}
  </section>

  <table class="items">
    <thead>
      <tr>
        <th>ت</th>
        <th>اسم المادة</th>
        <th>الباركود</th>
        <th>العدد</th>
        <th>الهدايا</th>
        ${isSalesPrint ? "<th>الوزن (كغم)</th>" : ""}
        <th>السعر</th>
        <th>السعر الكلي</th>
      </tr>
    </thead>
    <tbody>${rows || `<tr><td colspan="${isSalesPrint ? 8 : 7}" style="text-align:center;padding:20px;color:#94a3b8">لا توجد أصناف</td></tr>`}</tbody>
    ${lineRows.length ? `<tfoot><tr>
      <td colspan="3" style="text-align:right;font-weight:700">مجموع الكمية</td>
      <td class="n">${fmtN(totalQty)}</td>
      ${isSalesPrint
        ? `<td></td><td class="n weight">${fmtN(totalWeightKg)}</td><td colspan="2"></td>`
        : `<td colspan="3"></td>`}
    </tr></tfoot>` : ""}
  </table>

  <div class="bottom">
    <div class="totals">${totRows}${salesWeightRow}</div>
  </div>
  </div>

  <footer class="ftr">
    ${[
      mobile ? `<span class="ftr-item">📞 ${esc(mobile)}</span>` : "",
      address ? `<span class="ftr-item">📍 ${esc(address)}</span>` : "",
      `<span class="ftr-item ftr-dev">${esc(PROGRAMMER)}</span>`,
    ]
      .filter(Boolean)
      .join('<span class="ftr-sep">|</span>')}
  </footer>
</div>
</body>
</html>`;
}

/** طباعة تقرير عام — نفس هوامش الفواتير */
export function buildReportPrintHtml({ title, subtitle = "", company = {}, tableHtml = "" }) {
  const coName = company.CompanyInformation_Name || "اسم الشركة";
  const mobile = company.CompanyInformation_Mobile || "";
  const address = company.CompanyInformation_Adress || "";

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8"/>
<title> </title>
<style>${PRINT_PAGE_CSS}</style>
</head>
<body>
<div class="wrap">
  <header class="hdr">
    <div class="hdr-co">
      <h1>${esc(coName)}</h1>
      <div class="inv-type report">${esc(title)}</div>
    </div>
  </header>
  <div class="main">
    ${subtitle ? `<p class="report-sub">${esc(subtitle)}</p>` : ""}
    ${tableHtml}
  </div>
  <footer class="ftr">
    ${[
      mobile ? `<span class="ftr-item">📞 ${esc(mobile)}</span>` : "",
      address ? `<span class="ftr-item">📍 ${esc(address)}</span>` : "",
      `<span class="ftr-item ftr-dev">${esc(PROGRAMMER)}</span>`,
    ]
      .filter(Boolean)
      .join('<span class="ftr-sep">|</span>')}
  </footer>
</div>
</body>
</html>`;
}

function openPrintHtml(html) {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", " ");
  iframe.style.cssText =
    "position:fixed;left:-10000px;top:0;width:1px;height:1px;border:0;visibility:hidden";
  document.body.appendChild(iframe);

  const win = iframe.contentWindow;
  const doc = win.document;
  doc.open();
  doc.write(html);
  doc.close();

  const cleanup = () => {
    try {
      document.body.removeChild(iframe);
    } catch {
      /* ignore */
    }
  };

  const doPrint = () => {
    try {
      doc.title = " ";
    } catch {
      /* ignore */
    }
    win.focus();
    win.print();
    setTimeout(cleanup, 2000);
  };

  if (doc.readyState === "complete") {
    setTimeout(doPrint, 80);
  } else {
    iframe.onload = () => setTimeout(doPrint, 80);
  }
}

export function openInvoicePrint(payload) {
  openPrintHtml(buildInvoicePrintHtml(payload));
}

export function openReportPrint({ title, subtitle, company, tableHtml }) {
  openPrintHtml(buildReportPrintHtml({ title, subtitle, company, tableHtml }));
}

export function purchasePayloadFromForm({
  company,
  logoUrl,
  hdr,
  validLines,
  suppliers,
  payTypes,
  supplierBal,
  linesTotal,
  grandTotal,
  invoiceNo,
  paidAmount = 0,
}) {
  const payTypeName =
    payTypes.find((p) => String(p.id_PayType) === String(hdr.id_PayType_FIN))?.PayTypeName || "—";
  const partyName = suppliers.find((s) => String(s.id_Amil) === String(hdr.id_Amil))?.AmilName || "—";
  const prevBal = supplierBal?.netBalance ?? 0;
  const discount = +(hdr.Dis_FIN || 0);
  const deferred = isDeferredPay(payTypeName);
  const cash = isCashPay(payTypeName);
  const paid = cash ? r2(grandTotal) : r2(Math.min(Math.max(0, +paidAmount || 0), grandTotal));
  const lcExtrasGross = sumPurchaseExtrasGross(hdr);

  return {
    kind: "purchase",
    company,
    logoUrl,
    meta: {
      invoiceNo: invoiceNo || "مسودة",
      date: hdr.Date_FIN,
      payTypeName,
      partyName,
      partyLabel: "المورد",
      driverName: hdr.DriverName || "",
      driverMobile: hdr.DriverMobile || "",
      vehicleNumber: hdr.VehicleNumber || "",
    },
    lines: validLines.map((l, i) => mapLine(l, i, "purchase")),
    totals: buildPrintTotals(linesTotal, discount, 0, grandTotal, prevBal, {
      paidAmount: paid,
      isDeferred: deferred,
      isCash: cash,
      lcExtrasGross,
    }),
  };
}

export function purchasePayloadFromDetail(data, company, logoUrl) {
  const prevBal = data.previousBalance ?? 0;
  const grand = data.GrandTotal || 0;
  const deferred = isDeferredPay(data.PayTypeName);
  const cash = isCashPay(data.PayTypeName);
  const paid = cash ? grand : +(data.paidAmount || 0);
  const lcExtrasGross = r2(
    data.TotalExtras ??
      sumPurchaseExtrasGross(data)
  );
  const totals = buildPrintTotals(data.LinesTotal || 0, data.Dis_FIN || 0, 0, grand, prevBal, {
    paidAmount: paid,
    isDeferred: deferred,
    isCash: cash,
    lcExtrasGross,
  });
  if (data.finalBalance != null) {
    totals.finalBalance = r2(data.finalBalance);
  }
  if (data.previousBalance != null) {
    totals.previousBalance = r2(data.previousBalance);
  }

  return {
    kind: "purchase",
    company,
    logoUrl,
    meta: {
      invoiceNo: data.id_NoFIN,
      date: data.Date_FIN,
      payTypeName: data.PayTypeName || "—",
      partyName: data.AmilName || "—",
      partyLabel: "المورد",
      driverName: data.DriverName || "",
      driverMobile: data.DriverMobile || "",
      vehicleNumber: data.VehicleNumber || "",
    },
    lines: (data.lines || []).map((l, i) => mapLine(l, i, "purchase")),
    totals,
  };
}

export function salesPayloadFromForm({
  company,
  logoUrl,
  hdr,
  validLines,
  customers,
  payTypes,
  mandobs,
  prevBal,
  linesTotal,
  grandTotal,
  invoiceNo,
  paidAmount = 0,
  totalWeightKg,
}) {
  const payTypeName =
    payTypes.find((p) => String(p.id_PayType) === String(hdr.id_PayType_FOUT))?.PayTypeName || "—";
  const partyName =
    customers.find((c) => String(c.id_Zabon) === String(hdr.id_Zabon))?.ZabonName || "—";
  const mandobName =
    mandobs.find((m) => String(m.id_Mandob) === String(hdr.id_Mandob))?.MandobName || "";
  const discount = +(hdr.Dis_FOUT || 0);
  const addition = +(hdr.Add_FOUT || 0);
  const prev =
    typeof prevBal === "number"
      ? prevBal
      : prevBal?.netBalance ?? prevBal ?? 0;
  const paid = r2(Math.min(Math.max(0, +paidAmount || 0), grandTotal));

  return {
    kind: "sales",
    company,
    logoUrl,
    meta: {
      invoiceNo: invoiceNo || "مسودة",
      date: hdr.Date_FOUT,
      payTypeName,
      partyName,
      partyLabel: "الزبون",
      mandobName,
      driverName: hdr.DriverName || "",
      driverMobile: hdr.DriverMobile || "",
      vehicleNumber: hdr.VehicleNumber || "",
    },
    lines: validLines.map((l, i) => mapLine(l, i, "sales")),
    totals: {
      ...buildPrintTotals(linesTotal, discount, addition, grandTotal, prev, {
        paidAmount: paid,
        isDeferred: isDeferredPay(payTypeName),
      }),
      totalWeightKg: totalWeightKg != null ? r2(+totalWeightKg) : salesInvoiceWeightKg(validLines),
    },
  };
}

export function salesPayloadFromDetail(data, company, logoUrl) {
  const prevBal = data.previousBalance ?? 0;
  const grand = data.GrandTotal || 0;
  const deferred = isDeferredPay(data.PayTypeName);
  const paid = +(data.paidAmount || 0);
  const totals = buildPrintTotals(
    data.LinesTotal || 0,
    data.Dis_FOUT || 0,
    data.Add_FOUT || 0,
    grand,
    prevBal,
    { paidAmount: paid, isDeferred: deferred }
  );
  if (deferred && data.finalBalance != null) {
    totals.finalBalance = r2(data.finalBalance);
  }
  const printLines = (data.lines || []).map((l) => ({
    ...l,
    AmountOUT: l.AmountOUT ?? l.qty,
    gift_qty: l.gift_qty ?? l.gift,
    MaterialName: l.MaterialName || l.name,
    Barcode: l.Barcode || l.barcode,
    PriceOUT: l.PriceOUT ?? l.price,
    WeightKg: +(l.WeightKg ?? l.weightKg ?? 0),
  }));
  totals.totalWeightKg = salesInvoiceWeightKg(printLines);

  return {
    kind: "sales",
    company,
    logoUrl,
    meta: {
      invoiceNo: data.id_NoFOUT,
      date: data.Date_FOUT,
      payTypeName: data.PayTypeName || "—",
      partyName: data.ZabonName || "—",
      partyLabel: "الزبون",
      mandobName: data.MandobName || "",
      driverName: data.DriverName || "",
      driverMobile: data.DriverMobile || "",
      vehicleNumber: data.VehicleNumber || "",
    },
    lines: printLines.map((l, i) => mapLine(l, i, "sales")),
    totals,
  };
}

function mapReturnLine(l, i) {
  const qty = +(l.AmountReturn || l.AmountOUT || 0);
  const price = +(l.PriceReturn || l.PriceOUT || 0);
  const total = l.LineTotal != null ? +l.LineTotal : r2(qty * price);
  return {
    seq: i + 1,
    name: l.MaterialName || "—",
    barcode: l.Barcode || "—",
    qty,
    gift: 0,
    price,
    total,
  };
}

export function returnPayloadFromDetail(data, company, logoUrl) {
  const isSupplier = data.ReturnType === "SUPPLIER";
  const grand = r2(data.TotalValue || 0);
  const lines = (data.lines || []).map(mapReturnLine);

  return {
    kind: isSupplier ? "return-purchase" : "return-sales",
    company,
    logoUrl,
    meta: {
      invoiceNo: data.id_NoFRetern,
      date: data.Date_FRetern,
      partyName: data.PartyName || "—",
      partyLabel: isSupplier ? "المورد" : "الزبون",
      note: data.Note_FRetern || "",
      driverName: data.DriverName_R || "",
      driverMobile: data.DriverMobile_R || "",
      vehicleNumber: data.VehicleNumber_R || "",
    },
    lines,
    totals: buildPrintTotals(grand, 0, 0, grand, 0, {}),
  };
}
