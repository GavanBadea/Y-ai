// ============================================================
//  controllers/foutEdit.controller.js
//  تعديل فاتورة المبيعات — منفصل عن fout.controller.js الأصلي
//
//  ✅ يعكس المخزون القديم ويطبق الجديد
//  ✅ يحدث الدين بالفارق فقط
//  ✅ كل شيء داخل Transaction
// ============================================================
const db = require("../db");
const auditLog = require("./auditLog.controller");
const { removeInvoiceDebtLinks } = auditLog;

const r2 = (n) => Math.round((+n || 0) * 100) / 100;

function isDeferredPayType(name = "") {
  const n = String(name).trim();
  return n === "آجل" || n === "اجل" || n.toLowerCase() === "deferred" || n.toLowerCase() === "credit";
}

// ── GET /api/invoices-out/:id/edit-data ──────────────────
// يرجع رأس الفاتورة + أسطرها جاهزة للتعديل
const getEditData = async (req, res) => {
  try {
    const header = await db.queryOne(
      `SELECT f.*, pt.PayTypeName,
              z.ZabonName
       FROM FOUT_tbl f
       LEFT JOIN PayType_Tbl pt ON pt.id_PayType = f.id_PayType_FOUT
       LEFT JOIN Zabon_tbl   z  ON z.id_Zabon    = f.id_Zabon
       WHERE f.id_NoFOUT = ?`,
      [req.params.id]
    );
    if (!header)
      return res.status(404).json({ success: false, message: "الفاتورة غير موجودة" });

    const lines = await db.query(
      `SELECT d.*,
              m.MaterialName, m.Band, m.Barcode,
              COALESCE(m.WeightKg, 0)           AS WeightKg,
              COALESCE(s.QuantityOnHand, 0)     AS CurrentStock,
              COALESCE(sp.LastSellPrice, 0)      AS LastSellPrice,
              COALESCE(sp.SellPrice1,    0)      AS SellPrice1,
              COALESCE(sp.SellPrice2,    0)      AS SellPrice2
       FROM DetailsOUT_tbl d
       LEFT JOIN Materials_tbl  m  ON m.id_Material_NoM  = d.id_Material_NoM
       LEFT JOIN Stock_tbl      s  ON s.id_Material_NoM  = d.id_Material_NoM
       LEFT JOIN SellPrice_tbl  sp ON sp.id_Material_NoM = d.id_Material_NoM
       WHERE d.id_NoFOUT = ?
       ORDER BY d.id_DetailsOUT`,
      [req.params.id]
    );

    const paidRow = await db.queryOne(
      `SELECT COALESCE(SUM(Amount_CatchDoc), 0) AS paidAmount
       FROM CatchDoc_tbl
       WHERE Note_CatchDoc = ?`,
      [`دفعة على فاتورة مبيعات #${req.params.id}`]
    );

    res.json({ success: true, data: { header: { ...header, paidAmount: paidRow?.paidAmount || 0 }, lines } });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── PUT /api/invoices-out/:id ─────────────────────────────
// تعديل فاتورة: الأسطر + المخزون + الدين
const update = async (req, res) => {
  const invoiceId = req.params.id;
  const {
    Dis_FOUT = 0,
    Add_FOUT = 0,
    Note_FOUT,
    Date_FOUT,
    id_PayType_FOUT,
    id_Zabon,
    id_Mandob,
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
       FROM FOUT_tbl f
       LEFT JOIN PayType_Tbl pt ON pt.id_PayType = f.id_PayType_FOUT
       WHERE f.id_NoFOUT = ?`,
      [invoiceId]
    );
    if (!header)
      return res.status(404).json({ success: false, message: "الفاتورة غير موجودة" });

    // الأسطر القديمة
    const oldLines = await db.query(
      `SELECT * FROM DetailsOUT_tbl WHERE id_NoFOUT = ?`,
      [invoiceId]
    );

    // ── حساب المبالغ ──────────────────────────────────────
    const oldTotal = r2(oldLines.reduce((s, l) => s + l.AmountOUT * l.PriceOUT, 0) - header.Dis_FOUT + (header.Add_FOUT || 0));
    const newTotal = r2(lines.reduce((s, l) => s + (+l.AmountOUT) * (+l.PriceOUT), 0) - (+Dis_FOUT) + (+Add_FOUT || 0));
    const diff     = r2(newTotal - oldTotal);  // موجب = دين إضافي، سالب = تخفيض

    await db.run("BEGIN TRANSACTION");

    try {
      // ── الخطوة 1: عكس المخزون القديم ────────────────────
      for (const ol of oldLines) {
        const restoreQty = r2((+ol.AmountOUT || 0) + (+ol.gift_qty || 0));
        await db.run(
          `UPDATE Stock_tbl SET
             QuantityOUT    = MAX(0, QuantityOUT - ?),
             QuantityOnHand = QuantityOnHand + ?,
             LastUpdateDate = datetime('now')
           WHERE id_Material_NoM = ?`,
          [restoreQty, restoreQty, ol.id_Material_NoM]
        );
      }

      // ── الخطوة 2: حذف الأسطر القديمة ────────────────────
      await db.run(`DELETE FROM DetailsOUT_tbl WHERE id_NoFOUT = ?`, [invoiceId]);

      // ── الخطوة 3: إدراج الأسطر الجديدة + تحديث المخزون ──
      for (const line of lines) {
        const { id_Material_NoM, AmountOUT, PriceOUT, gift_qty = 0 } = line;
        const qty   = r2(+AmountOUT);
        const gift  = r2(Math.max(0, +gift_qty || 0));
        const price = r2(+PriceOUT);
        const totalDeduct = r2(qty + gift);

        await db.run(
          `INSERT INTO DetailsOUT_tbl
             (id_NoFOUT, id_Material_NoM, AmountOUT, PriceOUT, AmountStayInStorage, gift_qty)
           VALUES (?, ?, ?, ?, 0, ?)`,
          [invoiceId, id_Material_NoM, qty, price, gift]
        );

        // تحديث المخزون بالكمية الجديدة + الهدية
        await db.run(
          `INSERT INTO Stock_tbl (id_Material_NoM, QuantityOUT, QuantityOnHand, LastUpdateDate)
           VALUES (?, ?, -?, datetime('now'))
           ON CONFLICT(id_Material_NoM) DO UPDATE SET
             QuantityOUT    = QuantityOUT    + excluded.QuantityOUT,
             QuantityOnHand = QuantityOnHand - excluded.QuantityOUT,
             LastUpdateDate = datetime('now')`,
          [id_Material_NoM, totalDeduct, totalDeduct]
        );
      }

      // ── الخطوة 4: تحديث رأس الفاتورة ────────────────────
      await db.run(
        `UPDATE FOUT_tbl SET
           Dis_FOUT   = ?,
           Add_FOUT   = ?,
           Note_FOUT  = ?,
           Date_FOUT  = ?,
           id_PayType_FOUT = ?,
           id_Zabon   = ?,
           id_Mandob  = ?,
           DriverName = ?,
           DriverMobile = ?,
           VehicleNumber = ?
         WHERE id_NoFOUT = ?`,
        [
          r2(+Dis_FOUT), r2(+Add_FOUT || 0), Note_FOUT ?? header.Note_FOUT ?? "",
          Date_FOUT ? String(Date_FOUT).split("T")[0] : header.Date_FOUT,
          id_PayType_FOUT ?? header.id_PayType_FOUT,
          id_Zabon ?? header.id_Zabon,
          id_Mandob ?? header.id_Mandob,
          DriverName ?? header.DriverName ?? "",
          DriverMobile ?? header.DriverMobile ?? "",
          VehicleNumber ?? header.VehicleNumber ?? "",
          invoiceId,
        ]
      );

      // ── الخطوة 5: تحديث دين الفاتورة الآجلة + المبلغ المدفوع ─────
      const payTypeRow = await db.queryOne(
        `SELECT PayTypeName FROM PayType_Tbl WHERE id_PayType = ?`,
        [id_PayType_FOUT || header.id_PayType_FOUT]
      );
      const payTypeName = payTypeRow?.PayTypeName || header.PayTypeName;
      const zabonId     = id_Zabon || header.id_Zabon;
      const invDate       = Date_FOUT ? String(Date_FOUT).split("T")[0] : header.Date_FOUT;
      const debtNote      = `فاتورة مبيعات رقم ${invoiceId}`;
      const payNote       = `دفعة على فاتورة مبيعات #${invoiceId}`;
      const wasDeferred   = isDeferredPayType(header.PayTypeName);
      const isDeferred    = isDeferredPayType(payTypeName);

      if (wasDeferred && !isDeferred && zabonId) {
        await removeInvoiceDebtLinks("customer", zabonId, invoiceId);
      }

      if (isDeferred && zabonId) {
        const mainDebt = await db.queryOne(
          `SELECT id_DionZabon FROM DionZabon_tbl
           WHERE id_Zabon = ? AND Note_DionZabon = ?`,
          [zabonId, debtNote]
        );
        if (mainDebt) {
          await db.run(
            `UPDATE DionZabon_tbl SET
               Amount_DionZabon = ?,
               Date_DionZabon   = ?
             WHERE id_DionZabon = ?`,
            [newTotal, invDate, mainDebt.id_DionZabon]
          );
        } else {
          await db.run(
            `INSERT INTO DionZabon_tbl (Amount_DionZabon, Date_DionZabon, Note_DionZabon, id_Zabon)
             VALUES (?, ?, ?, ?)`,
            [newTotal, invDate, debtNote, zabonId]
          );
        }
      }

      const existingPay = await db.queryOne(
        `SELECT id_CatchDoc, id_Zabon FROM CatchDoc_tbl
         WHERE Note_CatchDoc = ?`,
        [payNote]
      );

      if (existingPay) {
        await db.run(
          `DELETE FROM DionZabon_tbl
           WHERE id_Zabon = ? AND Note_DionZabon LIKE ?`,
          [zabonId, `تسوية سند قبض رقم ${existingPay.id_CatchDoc}%`]
        );
        await db.run(`DELETE FROM CatchDoc_tbl WHERE id_CatchDoc = ?`, [existingPay.id_CatchDoc]);
      }

      const newPaid = Math.max(0, Number(PaidAmount) || 0);
      if (isDeferred && zabonId && newPaid > 0) {
        const capped = Math.min(newPaid, newTotal);
        const catchRes = await db.run(
          `INSERT INTO CatchDoc_tbl (Amount_CatchDoc, Date_CatchDoc, Note_CatchDoc, id_Zabon)
           VALUES (?, ?, ?, ?)`,
          [capped, invDate, payNote, zabonId]
        );
        await db.run(
          `INSERT INTO DionZabon_tbl (Amount_DionZabon, Date_DionZabon, Note_DionZabon, id_Zabon)
           VALUES (?, ?, ?, ?)`,
          [-capped, invDate, `تسوية سند قبض رقم ${catchRes.lastID}`, zabonId]
        );
      }

      await db.run("COMMIT");

      res.json({
        success  : true,
        message  : `✅ تم تعديل الفاتورة #${invoiceId} بنجاح`,
        oldTotal,
        newTotal,
        diff,
      });

    } catch (txErr) {
      await db.run("ROLLBACK");
      throw txErr;
    }

  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

module.exports = { getEditData, update };
