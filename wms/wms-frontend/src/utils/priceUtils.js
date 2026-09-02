// ============================================================
//  src/utils/priceUtils.js
//  مركز تقريب الأسعار وتنسيق الأرقام
//  ✅ يُستخدم في كل الفواتير والمرتجعات
// ============================================================

/**
 * تقريب رقم لأقرب عدد صحيح
 * @param {number} n - الرقم المراد تقريبه
 * @returns {number}
 */
export const roundPrice = (n) => Math.round(+n || 0);

/**
 * تقريب لخانتين عشريتين (للكميات والنسب)
 * @param {number} n
 * @returns {number}
 */
export const round2 = (n) => Math.round((+n || 0) * 100) / 100;

/**
 * تنسيق رقم للعرض بأرقام إنجليزية
 * @param {number} n
 * @returns {string}
 */
export const fmtN = (n) => round2(n).toLocaleString("en-US");

/**
 * تنسيق سعر للعرض بالدينار العراقي
 * @param {number} n
 * @returns {string}
 */
export const fmtC = (n) => `${roundPrice(n).toLocaleString("en-US")} د.ع`;

/**
 * التحقق من أن الرقم صحيح (بدون كسور)
 * @param {number} n
 * @returns {boolean}
 */
export const isWholeNumber = (n) => Number.isInteger(+n);

/**
 * تنظيف السعر قبل الحفظ في قاعدة البيانات
 * يُقرِّب للعدد الصحيح إذا كان الكسر أقل من 50 فلساً
 * @param {number} price
 * @returns {number}
 */
export const cleanPrice = (price) => {
  const n = +price || 0;
  const rounded = Math.round(n);
  // إذا كان الفرق أقل من 1% → قرِّب لعدد صحيح
  if (Math.abs(n - rounded) / Math.max(rounded, 1) < 0.01) return rounded;
  return round2(n);
};

/**
 * حساب إجمالي سطر فاتورة مع تقريب
 * @param {number} qty
 * @param {number} price
 * @returns {number}
 */
export const lineTotal = (qty, price) => roundPrice(round2(+qty || 0) * roundPrice(+price || 0));

/**
 * حساب إجمالي فاتورة كاملة مع خصم
 * @param {Array} lines - [{qty, price}]
 * @param {number} discount
 * @returns {number}
 */
export const invoiceTotal = (lines, discount = 0) => {
  const sub = lines.reduce((s, l) => s + lineTotal(l.qty || l.AmountOUT || 0, l.price || l.PriceOUT || 0), 0);
  return roundPrice(sub - roundPrice(+discount || 0));
};
