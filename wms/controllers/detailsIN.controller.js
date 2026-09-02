// controllers/detailsIN.controller.js  —  جدول تفاصيل المشتريات DetailsIN_tbl
const db = require("../db");

const getByInvoice = async (req, res) => {
  try {
    const rows = await db.query(`
      SELECT d.*, m.MaterialName, m.Band, m."Cost Price"
      FROM DetailsIN_tbl d
      LEFT JOIN Materials_tbl m ON m.id_Material_NoM = d.id_Material_NoM
      WHERE d.id_NoFIN=?`, [req.params.invoiceId]);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// إضافة سطر منفرد لفاتورة موجودة (مع تحديث المخزون)
const addLine = async (req, res) => {
  const { id_NoFIN, id_Material_NoM, AmountIN = 1, PriceIN = 0, ExpairDate = null, Gift_IN = 0 } = req.body;
  if (!id_NoFIN || !id_Material_NoM)
    return res.status(400).json({ success: false, message: "رقم الفاتورة والمادة مطلوبان" });
  try {
    await db.run(
      `INSERT INTO DetailsIN_tbl (id_NoFIN,id_Material_NoM,AmountIN,PriceIN,ExpairDate,Gift_IN)
       VALUES (?,?,?,?,?,?)`,
      [id_NoFIN, id_Material_NoM, AmountIN, PriceIN, ExpairDate, Gift_IN]);

    const totalIn = AmountIN + (Gift_IN || 0);
    await db.run(
      `INSERT INTO Stock_tbl (id_Material_NoM,QuantityIN,QuantityOnHand,LastUpdateDate)
       VALUES (?,?,?,datetime('now'))
       ON CONFLICT(id_Material_NoM) DO UPDATE SET
         QuantityIN=QuantityIN+excluded.QuantityIN,
         QuantityOnHand=QuantityOnHand+excluded.QuantityIN,
         LastUpdateDate=excluded.LastUpdateDate`,
      [id_Material_NoM, totalIn, totalIn]);

    res.status(201).json({ success: true, message: "تم إضافة السطر وتحديث المخزون" });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const removeLine = async (req, res) => {
  try {
    // جلب الكمية أولاً
    const line = await db.queryOne(
      `SELECT * FROM DetailsIN_tbl WHERE id_NoFIN=? AND id_Material_NoM=?`,
      [req.params.invoiceId, req.params.materialId]);
    if (!line) return res.status(404).json({ success: false, message: "السطر غير موجود" });

    await db.run(
      `DELETE FROM DetailsIN_tbl WHERE id_NoFIN=? AND id_Material_NoM=?`,
      [req.params.invoiceId, req.params.materialId]);

    const totalIn = (line.AmountIN || 0) + (line.Gift_IN || 0);
    await db.run(
      `UPDATE Stock_tbl SET
         QuantityIN=MAX(0,QuantityIN-?),
         QuantityOnHand=MAX(0,QuantityOnHand-?),
         LastUpdateDate=datetime('now')
       WHERE id_Material_NoM=?`,
      [totalIn, totalIn, line.id_Material_NoM]);

    res.json({ success: true, message: "تم حذف السطر وتحديث المخزون" });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

module.exports = { getByInvoice, addLine, removeLine };
