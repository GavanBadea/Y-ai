// ============================================================
//  controllers/finEdit.controller.js
//  تعديل فاتورة المشتريات — منفصل عن fin.controller.js
//
//  ✅ يعكس المخزون القديم ويطبق الجديد
//  ✅ يحدث ديون المورد بالفارق
//  ✅ يحدث Cost Price إذا تغيّر السعر
//  ✅ كل شيء داخل Transaction
// ============================================================
const db = require("../db");
const auditLog = require("./auditLog.controller");
const { removeInvoiceDebtLinks } = auditLog;
const { addWarehouseQty, subtractWarehouseQty } = require("../utils/warehouseStock");
const { recalcMaterialWAC } = require("../utils/recalcMaterialWAC");
const { applyLandedCostToLines } = require("../utils/purchaseLineCost");

const r2    = (n) => Math.round((+n || 0) * 100) / 100;
const rPric = (n) => Math.round(+n || 0);

const calcLandedCost = applyLandedCostToLines;

function wacFromInventoryValue(oldQty, oldCost, newQty, inventoryValue) {
  const oq = +oldQty || 0;
  const oc = +oldCost || 0;
  const nq = +newQty || 0;
  const iv = +inventoryValue || 0;
  const totalQty = oq + nq;
  if (totalQty === 0) return nq > 0 ? iv / nq : 0;
  return (oq * oc + iv) / totalQty;
}

function weightedAvgCost(oldQty, oldCost, newQty, newCost) {
  const totalQty = oldQty + newQty;
  if (totalQty === 0) return newCost;
  return (oldQty * oldCost + newQty * newCost) / totalQty;
}

function isDeferredPayType(name = "") {
  const n = String(name).trim();
  return n === "آجل" || n === "اجل" || n.toLowerCase() === "deferred" || n.toLowerCase() === "credit";
}

// ── GET /api/invoices-in/:id/edit-data ───────────────────
const getEditData = async (req, res) => {
  try {
    const header = await db.queryOne(
      `SELECT f.*,
              a.AmilName,
              pt.PayTypeName
       FROM FIN_tbl f
       LEFT JOIN Amil_tbl a ON a.id_Amil = f.id_Amil
       LEFT JOIN PayType_Tbl pt ON pt.id_PayType = f.id_PayType_FIN
       WHERE f.id_NoFIN = ?`,
      [req.params.id]
    );
    if (!header)
      return res.status(404).json({ success: false, message: "الفاتورة غير موجودة" });

    const lines = await db.query(
      `SELECT d.*,
              m.MaterialName, m.Band, m.Barcode,
              m."Cost Price"                    AS CurrentCostPrice,
              COALESCE(s.QuantityOnHand, 0)     AS CurrentStock
       FROM DetailsIN_tbl d
       LEFT JOIN Materials_tbl m ON m.id_Material_NoM = d.id_Material_NoM
       LEFT JOIN Stock_tbl     s ON s.id_Material_NoM = d.id_Material_NoM
       WHERE d.id_NoFIN = ?
       ORDER BY d.id_DetailsIN`,
      [req.params.id]
    );

    const paidRow = await db.queryOne(
      `SELECT COALESCE(SUM(Amount_PayDoc), 0) AS paidAmount
       FROM PayDoc_tbl
       WHERE Note_PayDoc = ?`,
      [`دفعة على فاتورة مشتريات #${req.params.id}`]
    );

    res.json({ success: true, data: { header: { ...header, paidAmount: paidRow?.paidAmount || 0 }, lines } });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── PUT /api/invoices-in/:id ──────────────────────────────
const update = async (req, res) => {
  const invoiceId = req.params.id;
  const {
    Dis_FIN = 0,
    Trans = 0,
    Customs = 0,
    Porter = 0,
    SGS = 0,
    ExportRelease = 0,
    VehicleManifest = 0,
    GeneralTax = 0,
    Date_FIN,
    id_PayType_FIN,
    id_Amil,
    id_Warehouse,
    DriverName,
    DriverMobile,
    VehicleNumber,
    PaidAmount,
    lines = [],
  } = req.body;

  if (!lines.length)
    return res.status(400).json({ success: false, message: "يجب إدخال مادة واحدة على الأقل" });

  try {
    // ── قراءة الفاتورة الحالية ────────────────────────────
    const header = await db.queryOne(
      `SELECT f.*, pt.PayTypeName
       FROM FIN_tbl f
       LEFT JOIN PayType_Tbl pt ON pt.id_PayType = f.id_PayType_FIN
       WHERE f.id_NoFIN = ?`,
      [invoiceId]
    );
    if (!header)
      return res.status(404).json({ success: false, message: "الفاتورة غير موجودة" });

    const oldLines = await db.query(
      `SELECT * FROM DetailsIN_tbl WHERE id_NoFIN = ?`, [invoiceId]
    );

    // ── حسابات الفارق ─────────────────────────────────────
    const oldTotal = r2(
      oldLines.reduce((s, l) => s + l.AmountIN * l.PriceIN, 0)
      + (header.Trans || 0) + (header.Customs || 0) + (header.Porter || 0)
      + (header.SGS || 0) + (header.ExportRelease || 0) + (header.VehicleManifest || 0)
      - (header.Dis_FIN || 0)
    );
    const newTotal = r2(
      lines.reduce((s, l) => s + (+l.AmountIN) * (+l.PriceIN), 0)
      + (+Trans) + (+Customs) + (+Porter) + (+SGS) + (+ExportRelease) + (+VehicleManifest) - (+Dis_FIN)
    );
    const diff     = r2(newTotal - oldTotal);

    const oldWhId = header.id_Warehouse ? Number(header.id_Warehouse) : null;
    const newWhId   = id_Warehouse != null && id_Warehouse !== ""
      ? Number(id_Warehouse)
      : oldWhId;

    await db.run("BEGIN TRANSACTION");

    try {
      // ── الخطوة 1: عكس المخزون القديم ────────────────────
      for (const ol of oldLines) {
        const oldQty = (+ol.AmountIN || 0) + (+ol.Gift_IN || 0);
        await db.run(
          `UPDATE Stock_tbl SET
             QuantityIN     = MAX(0, QuantityIN - ?),
             QuantityOnHand = QuantityOnHand - ?,
             LastUpdateDate = datetime('now')
           WHERE id_Material_NoM = ?`,
          [oldQty, oldQty, ol.id_Material_NoM]
        );
        if (oldWhId) {
          await subtractWarehouseQty(ol.id_Material_NoM, oldWhId, oldQty, true);
        }
      }

      // ── الخطوة 2: حذف الأسطر القديمة ────────────────────
      await db.run(`DELETE FROM DetailsIN_tbl WHERE id_NoFIN = ?`, [invoiceId]);

      // ── الخطوة 3: إدراج الجديدة + تحديث المخزون + Cost Price (LC)
      const netExtras = (+Trans) + (+Customs) + (+Porter) + (+SGS) + (+ExportRelease) + (+VehicleManifest) - (+Dis_FIN);
      const prepared = lines.map((l) => ({
        id_Material_NoM: l.id_Material_NoM,
        AmountIN: +l.AmountIN,
        PriceIN: +l.PriceIN,
        Gift_IN: +l.Gift_IN || 0,
        ExpairDate: l.ExpairDate,
      }));
      const linesWithLC = calcLandedCost(prepared, netExtras);

      for (const line of linesWithLC) {
        const { id_Material_NoM, AmountIN, PriceIN, Gift_IN, ExpairDate, LandedCostPerUnit } = line;
        const qty   = r2(+AmountIN);
        const gift  = r2(+Gift_IN || 0);
        const price = rPric(+PriceIN);
        const exp   = ExpairDate ? String(ExpairDate).split("T")[0] : null;
        const totalQtyIn = qty + gift;

        await db.run(
          `INSERT INTO DetailsIN_tbl (id_NoFIN, id_Material_NoM, AmountIN, PriceIN, ExpairDate, Gift_IN)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [invoiceId, id_Material_NoM, qty, price, exp, gift]
        );

        const mat = await db.queryOne(
          `SELECT "Cost Price" AS CostPrice FROM Materials_tbl WHERE id_Material_NoM = ?`,
          [id_Material_NoM]
        );
        const stock = await db.queryOne(
          `SELECT COALESCE(QuantityOnHand, 0) AS qty FROM Stock_tbl WHERE id_Material_NoM = ?`,
          [id_Material_NoM]
        );
        const wac = wacFromInventoryValue(
          stock?.qty || 0, mat?.CostPrice || 0, totalQtyIn, line.InventoryValue
        );

        await db.run(
          `UPDATE Materials_tbl SET "Cost Price" = ? WHERE id_Material_NoM = ?`,
          [wac, id_Material_NoM]
        );

        await db.run(
          `INSERT INTO Stock_tbl (id_Material_NoM, QuantityIN, QuantityOnHand, LastUpdateDate)
           VALUES (?, ?, ?, datetime('now'))
           ON CONFLICT(id_Material_NoM) DO UPDATE SET
             QuantityIN     = QuantityIN + excluded.QuantityIN,
             QuantityOnHand = QuantityOnHand + excluded.QuantityIN,
             LastUpdateDate = datetime('now')`,
          [id_Material_NoM, totalQtyIn, totalQtyIn]
        );

        if (newWhId) {
          await addWarehouseQty(id_Material_NoM, newWhId, totalQtyIn);
        }
      }

      for (const line of linesWithLC) {
        await recalcMaterialWAC(line.id_Material_NoM);
      }

      // ── الخطوة 4: تحديث رأس الفاتورة ────────────────────
      await db.run(
        `UPDATE FIN_tbl SET
           Dis_FIN=?,
           Trans=?,
           Customs=?,
           Porter=?,
           SGS=?,
           ExportRelease=?,
           VehicleManifest=?,
           GeneralTax=?,
           Date_FIN=?,
           id_PayType_FIN=?,
           id_Amil=?,
           id_Warehouse=?,
           DriverName=?,
           DriverMobile=?,
           VehicleNumber=?
         WHERE id_NoFIN=?`,
        [
          r2(+Dis_FIN), r2(+Trans), r2(+Customs), r2(+Porter),
          r2(+SGS), r2(+ExportRelease), r2(+VehicleManifest), r2(+GeneralTax || 0),
          Date_FIN ? String(Date_FIN).split("T")[0] : header.Date_FIN,
          id_PayType_FIN ?? header.id_PayType_FIN,
          id_Amil ?? header.id_Amil,
          id_Warehouse ?? header.id_Warehouse,
          DriverName ?? header.DriverName ?? "",
          DriverMobile ?? header.DriverMobile ?? "",
          VehicleNumber ?? header.VehicleNumber ?? "",
          invoiceId,
        ]
      );

      // ── الخطوة 5: تحديث دين الفاتورة الآجلة + المبلغ المدفوع ─────
      const payTypeRow = await db.queryOne(
        `SELECT PayTypeName FROM PayType_Tbl WHERE id_PayType = ?`,
        [id_PayType_FIN || header.id_PayType_FIN]
      );
      const payTypeName = payTypeRow?.PayTypeName || header.PayTypeName;
      const amilId      = id_Amil || header.id_Amil;
      const invDate     = Date_FIN ? String(Date_FIN).split("T")[0] : header.Date_FIN;
      const debtNote    = `فاتورة مشتريات رقم ${invoiceId}`;
      const payNote     = `دفعة على فاتورة مشتريات #${invoiceId}`;
      const wasDeferred = isDeferredPayType(header.PayTypeName);
      const isDeferred  = isDeferredPayType(payTypeName);

      if (wasDeferred && !isDeferred && amilId) {
        await removeInvoiceDebtLinks("supplier", amilId, invoiceId);
      }

      if (isDeferred && amilId) {
        const mainDebt = await db.queryOne(
          `SELECT id_DionAmil FROM DionAmil_tbl
           WHERE id_Amil = ? AND Note_DionAmil = ?`,
          [amilId, debtNote]
        );
        if (mainDebt) {
          await db.run(
            `UPDATE DionAmil_tbl SET
               Amount_DionAmil = ?,
               Date_DionAmil   = COALESCE(?, Date_DionAmil)
             WHERE id_DionAmil = ?`,
            [newTotal, invDate || null, mainDebt.id_DionAmil]
          );
        } else {
          await db.run(
            `INSERT INTO DionAmil_tbl (Amount_DionAmil, Date_DionAmil, Note_DionAmil, id_Amil)
             VALUES (?, ?, ?, ?)`,
            [newTotal, invDate, debtNote, amilId]
          );
        }
      }

      const existingPay = await db.queryOne(
        `SELECT id_PayDoc, Amount_PayDoc, id_Amil FROM PayDoc_tbl
         WHERE Note_PayDoc = ?`,
        [payNote]
      );

      if (existingPay) {
        await db.run(
          `DELETE FROM DionAmil_tbl
           WHERE id_Amil = ? AND Note_DionAmil LIKE ?`,
          [amilId, `تسوية سند دفع رقم ${existingPay.id_PayDoc}%`]
        );
        await db.run(`DELETE FROM PayDoc_tbl WHERE id_PayDoc = ?`, [existingPay.id_PayDoc]);
      }

      const newPaid = Math.max(0, Number(PaidAmount) || 0);
      if (isDeferred && amilId && newPaid > 0) {
        const capped = Math.min(newPaid, newTotal);
        const payRes = await db.run(
          `INSERT INTO PayDoc_tbl (Amount_PayDoc, Date_PayDoc, Note_PayDoc, id_Amil)
           VALUES (?, ?, ?, ?)`,
          [capped, invDate, payNote, amilId]
        );
        await db.run(
          `INSERT INTO DionAmil_tbl (Amount_DionAmil, Date_DionAmil, Note_DionAmil, id_Amil)
           VALUES (?, ?, ?, ?)`,
          [-capped, invDate, `تسوية سند دفع رقم ${payRes.lastID}`, amilId]
        );
      }

      await db.run("COMMIT");

      res.json({
        success  : true,
        message  : `✅ تم تعديل فاتورة الشراء #${invoiceId}`,
        oldTotal, newTotal, diff,
      });

    } catch (txErr) {
      await db.run("ROLLBACK");
      throw txErr;
    }

  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

module.exports = { getEditData, update };
