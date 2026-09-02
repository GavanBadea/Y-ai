// ============================================================
//  purchaseLineCost.js
//  تكلفة سطر المشتريات: (كمية × سعر + حصة LC − حصة خصم) ÷ (كمية + هدية)
// ============================================================

const r2 = (n) => Math.round((+n || 0) * 100) / 100;
const r3 = (n) => Math.round((+n || 0) * 1000) / 1000;

/** حصة LC/الخصم لسطر واحد */
function purchaseLineShare(lineValue, linesTotal, netExtras) {
  const lv = +lineValue || 0;
  const lt = +linesTotal || 0;
  return lt > 0 ? (lv / lt) * (+netExtras || 0) : 0;
}

/**
 * @returns {object}
 *   totalLineCost     — إجمالي تكلفة السطر (للـ WAC والمخزون الكامل)
 *   landedCostPerUnit — معدل سعر القطعة مع الهدية
 *   lineStockValue    — قيمة المخزون المعروضة (معدل × الكمية المدفوعة)
 */
function calcPurchaseLineCost(amt, prc, gift = 0, linesTotal = 0, netExtras = 0) {
  const qty   = +amt || 0;
  const price = +prc || 0;
  const g     = +gift || 0;
  const lineValue     = qty * price;
  const lcShare       = purchaseLineShare(lineValue, linesTotal, netExtras);
  const totalLineCost = lineValue + lcShare;
  const totalUnits    = qty + g;
  const landedCostPerUnit = totalUnits > 0 ? totalLineCost / totalUnits : price;
  return {
    lineValue,
    lcShare,
    totalLineCost,
    totalUnits,
    landedCostPerUnit,
    inventoryValue : totalLineCost,
    lineStockValue : landedCostPerUnit * qty,
  };
}

/** تطبيق Landed Cost على أسطر فاتورة مشتريات */
function applyLandedCostToLines(lines, netExtras) {
  const linesTotal = lines.reduce((s, l) => s + (+l.AmountIN) * (+l.PriceIN), 0);
  return lines.map((line) => {
    const cost = calcPurchaseLineCost(
      line.AmountIN,
      line.PriceIN,
      line.Gift_IN || 0,
      linesTotal,
      netExtras
    );
    return {
      ...line,
      LandedCostShare   : r3(cost.lcShare),
      LandedCostPerUnit : r3(cost.landedCostPerUnit),
      InventoryValue    : cost.totalLineCost,
      LineTotal         : r2(cost.lineStockValue),
    };
  });
}

/** قيمة المخزون لسطر من جداول FIN + DetailsIN (لإعادة حساب WAC) */
function lineInventoryValue(p, linesTotal) {
  const lineValue = (+p.AmountIN) * (+p.PriceIN);
  const lcTotal =
    (+p.Trans || 0) + (+p.Customs || 0) + (+p.Porter || 0) +
    (+p.SGS || 0) + (+p.ExportRelease || 0) + (+p.VehicleManifest || 0);
  const ratio = linesTotal > 0 ? lineValue / linesTotal : 0;
  return lineValue + ratio * lcTotal - ratio * (+p.Dis_FIN || 0);
}

const PURCHASE_LC_SUM_SQL = `(
  COALESCE(f.Trans,0)+COALESCE(f.Customs,0)+COALESCE(f.Porter,0)
  +COALESCE(f.SGS,0)+COALESCE(f.ExportRelease,0)+COALESCE(f.VehicleManifest,0)
)`;

/** تعبير SQL: إجمالي تكلفة السطر (بدون مضاعفة الهدية × السعر) */
const PURCHASE_TOTAL_LINE_COST_SQL = `
  (
    d.AmountIN * d.PriceIN
    + CASE WHEN invLt.linesTotal > 0
        THEN (d.AmountIN * d.PriceIN * 1.0 / invLt.linesTotal) * ${PURCHASE_LC_SUM_SQL}
        ELSE 0 END
    - CASE WHEN invLt.linesTotal > 0
        THEN (d.AmountIN * d.PriceIN * 1.0 / invLt.linesTotal) * COALESCE(f.Dis_FIN, 0)
        ELSE 0 END
  )`;

/** قيمة المخزون المعروضة = التكلفة الكلية × الكمية ÷ (كمية + هدية) */
const PURCHASE_LINE_STOCK_VALUE_SQL = `
  ROUND(
    ${PURCHASE_TOTAL_LINE_COST_SQL}
    * d.AmountIN * 1.0
    / NULLIF(d.AmountIN + COALESCE(d.Gift_IN, 0), 0)
  , 0)`;

const PURCHASE_INV_LINES_SUBQUERY = `
  (
    SELECT id_NoFIN, SUM(AmountIN * PriceIN) AS linesTotal
    FROM DetailsIN_tbl GROUP BY id_NoFIN
  ) invLt ON invLt.id_NoFIN = f.id_NoFIN`;

/** إجمالي فاتورة المشتريات (أسطر + مصاريف LC − خصم) — alias الجدول f */
function purchaseInvoiceGrandTotalSql(alias = "f") {
  const a = alias;
  return `(
    COALESCE((
      SELECT SUM(d.AmountIN * d.PriceIN)
      FROM DetailsIN_tbl d WHERE d.id_NoFIN = ${a}.id_NoFIN
    ), 0)
    + (${PURCHASE_LC_SUM_SQL.replace(/\bf\./g, `${a}.`)} - COALESCE(${a}.Dis_FIN, 0))
  )`;
}

module.exports = {
  r2,
  r3,
  calcPurchaseLineCost,
  applyLandedCostToLines,
  lineInventoryValue,
  PURCHASE_LC_SUM_SQL,
  PURCHASE_TOTAL_LINE_COST_SQL,
  PURCHASE_LINE_STOCK_VALUE_SQL,
  PURCHASE_INV_LINES_SUBQUERY,
  purchaseInvoiceGrandTotalSql,
};
