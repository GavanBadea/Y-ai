// ============================================================
//  utils/recalcMaterialWAC.js
//  إعادة حساب Cost Price من فواتير الشراء (LC + هدايا − خصم)
// ============================================================
const db = require("../db");
const { lineInventoryValue } = require("./purchaseLineCost");

async function recalcMaterialWAC(materialId) {
  const purchases = await db.query(
    `SELECT d.AmountIN, d.PriceIN, COALESCE(d.Gift_IN, 0) AS Gift_IN,
            d.id_NoFIN,
            f.Trans, f.Customs, f.Porter, f.SGS, f.ExportRelease, f.VehicleManifest,
            COALESCE(f.Dis_FIN, 0) AS Dis_FIN,
            f.Date_FIN
     FROM DetailsIN_tbl d
     JOIN FIN_tbl f ON f.id_NoFIN = d.id_NoFIN
     WHERE d.id_Material_NoM = ?
     ORDER BY f.Date_FIN ASC, f.id_NoFIN ASC`,
    [materialId]
  );

  const stock = await db.queryOne(
    `SELECT COALESCE(QuantityOnHand, 0) AS q FROM Stock_tbl WHERE id_Material_NoM = ?`,
    [materialId]
  );
  const stockQty = stock?.q || 0;

  if (stockQty <= 0) {
    await db.run(`UPDATE Materials_tbl SET "Cost Price" = 0 WHERE id_Material_NoM = ?`, [materialId]);
    return 0;
  }

  if (!purchases.length) return null;

  const linesTotalCache = {};
  let runQty = 0;
  let runCost = 0;

  for (const p of purchases) {
    if (linesTotalCache[p.id_NoFIN] === undefined) {
      const row = await db.queryOne(
        `SELECT COALESCE(SUM(AmountIN * PriceIN), 0) AS t FROM DetailsIN_tbl WHERE id_NoFIN = ?`,
        [p.id_NoFIN]
      );
      linesTotalCache[p.id_NoFIN] = row?.t || 0;
    }
    const invVal = lineInventoryValue(p, linesTotalCache[p.id_NoFIN]);
    const addQty = (+p.AmountIN) + (+p.Gift_IN || 0);
    const newQty = runQty + addQty;
    runCost = newQty > 0 ? (runQty * runCost + invVal) / newQty : runCost;
    runQty = newQty;
  }

  await db.run(
    `UPDATE Materials_tbl SET "Cost Price" = ? WHERE id_Material_NoM = ?`,
    [runCost, materialId]
  );
  return runCost;
}

async function recalcAllMaterialsWAC() {
  const rows = await db.query(
    `SELECT DISTINCT id_Material_NoM FROM Stock_tbl WHERE COALESCE(QuantityOnHand, 0) > 0`
  );
  for (const r of rows) {
    await recalcMaterialWAC(r.id_Material_NoM);
  }
}

let _recalcPromise = null;
/** إعادة حساب WAC مرة واحدة حتى لو تعددت الطلبات المتزامنة */
async function ensureWACRecalc() {
  if (!_recalcPromise) {
    _recalcPromise = recalcAllMaterialsWAC()
      .catch((e) => console.error("WAC recalc:", e.message))
      .finally(() => { _recalcPromise = null; });
  }
  return _recalcPromise;
}

module.exports = { recalcMaterialWAC, recalcAllMaterialsWAC, ensureWACRecalc, lineInventoryValue };
