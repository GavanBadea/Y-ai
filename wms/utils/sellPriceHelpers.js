/** آخر سعر مُعرَّف في خانات سعر البيع — الأحدث في أعلى رقم (5→1) */
function latestSlotPrice(row = {}) {
  for (const k of [5, 4, 3, 2, 1]) {
    const v = Number(row[`SellPrice${k}`] ?? 0);
    if (v > 0) return v;
  }
  return 0;
}

/** السعر الحالي للفواتير الجديدة = آخر خانة سعر بيع، وإلا سعر POS (LastSellPrice) */
function resolveDefaultSellPrice(row = {}) {
  const slot = latestSlotPrice(row);
  if (slot > 0) return slot;
  return Math.max(0, Number(row.LastSellPrice ?? 0) || 0);
}

module.exports = { latestSlotPrice, resolveDefaultSellPrice };
