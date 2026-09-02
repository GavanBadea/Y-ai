// ============================================================
//  src/utils/numFormat.js
//  دوال تنسيق الأرقام المشتركة — تقرأ من locale المركزي
//  ✅ آمن للاستخدام على مستوى الموديول وداخل المكوّنات
// ============================================================

const _store = {
  locale: (() => {
    try { return localStorage.getItem("wms_num_locale") || "en-US"; }
    catch { return "en-US"; }
  })(),
  currency: (() => {
    try { return localStorage.getItem("wms_currency_symbol") || "د.ع"; }
    catch { return "د.ع"; }
  })(),
};

/** يُستدعى من NumberLocaleContext عند التبديل */
export const setNumLocale = (l) => {
  _store.locale = l;
  try {
    window.dispatchEvent(new CustomEvent("wms-num-locale-change", { detail: l }));
  } catch { /* ignore */ }
};
export const getNumLocale = () => _store.locale;

export const setCurrencySymbol = (sym) => {
  _store.currency = sym === "$" ? "$" : "د.ع";
  try { localStorage.setItem("wms_currency_symbol", _store.currency); } catch {}
  window.dispatchEvent(new CustomEvent("wms-currency-change", { detail: _store.currency }));
};
export const getCurrencySymbol = () => _store.currency;

export const r2   = (n=0) => Math.round((+n||0)*100)/100;
export const fmtN = (n=0) => r2(n).toLocaleString(_store.locale);
/** مبلغ مع رمز العملة الحالي فقط — بدون تكرار */
export const fmtC = (n=0) => `${fmtN(n)} ${_store.currency}`;
export const fmt  = fmtN;
export const currencyLabel = () => _store.currency;
export const amountLabel   = (base = "المبلغ") => `${base} (${_store.currency})`;

/** تنسيق التاريخ dd/mm/yyyy — يقبل yyyy-mm-dd أو نص ISO */
export function fmtDate(d) {
  if (d == null || d === "") return "—";
  const s = String(d).trim();
  if (!s) return "—";
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  const dt = new Date(s);
  if (!Number.isNaN(dt.getTime())) {
    const dd = String(dt.getDate()).padStart(2, "0");
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    return `${dd}/${mm}/${dt.getFullYear()}`;
  }
  return s;
}

/** تاريخ + وقت اختياري بنفس صيغة اليوم */
export function fmtDateTime(d) {
  if (d == null || d === "") return "—";
  const s = String(d).trim().replace("T", " ");
  if (s.includes(" ")) {
    const [datePart, timePart] = s.split(" ");
    const t = (timePart || "").slice(0, 8);
    return t ? `${fmtDate(datePart)} ${t}` : fmtDate(datePart);
  }
  return fmtDate(d);
}
