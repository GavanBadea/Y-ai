// عرض 0 كحقل فارغ مع placeholder — للكتابة المباشرة
export function numFieldValue(n) {
  if (n === "" || n === null || n === undefined) return "";
  if (n === 0 || n === "0") return "";
  return n;
}

export function numFieldNum(v, fallback = 0) {
  if (v === "" || v === null || v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** آخر خانة سعر بيع مُعرَّفة (5→1) — سجل الأسعار التاريخي */
export function pickLatestSlotPrice(row = {}) {
  for (const k of ["SellPrice5", "SellPrice4", "SellPrice3", "SellPrice2", "SellPrice1"]) {
    const v = Number(row[k]);
    if (v > 0) return v;
  }
  const last = Number(row.LastSellPrice ?? 0);
  return last > 0 ? last : "";
}

/** سعر البيع في الفاتورة الجديدة = آخر خانة مُعرَّفة في البطاقة (5→1) */
export function pickInvoiceSellPrice(row = {}) {
  const def = Number(row.DefaultPrice ?? row.ActiveSellPrice ?? 0);
  if (def > 0) return def;
  return pickLatestSlotPrice(row);
}

/** @deprecated استخدم pickInvoiceSellPrice */
export function pickMasterSellPrice(row = {}) {
  return pickInvoiceSellPrice(row);
}

/** سعر الشراء المُعرَّف يدوياً في بطاقة المادة */
export function pickMasterCostPrice(row = {}) {
  const v = Number(row.MasterCostPrice ?? row.masterCostPrice ?? 0);
  return v > 0 ? v : "";
}
