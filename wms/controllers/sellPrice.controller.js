// controllers/sellPrice.controller.js  —  جدول تغير أسعار البيع SellPrice_tbl
const db = require("../db");

const getAll = async (_req, res) => {
  try {
    const rows = await db.query(`
      SELECT sp.*, m.MaterialName, m.Band, m."Cost Price"
      FROM SellPrice_tbl sp
      JOIN Materials_tbl m ON m.id_Material_NoM = sp.id_Material_NoM
      ORDER BY m.MaterialName`);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const getOne = async (req, res) => {
  try {
    const row = await db.queryOne(
      `SELECT sp.*, m.MaterialName FROM SellPrice_tbl sp
       JOIN Materials_tbl m ON m.id_Material_NoM=sp.id_Material_NoM
       WHERE sp.id_Material_NoM=?`, [req.params.materialId]);
    if (!row) return res.status(404).json({ success: false, message: "لا توجد أسعار لهذه المادة" });
    res.json({ success: true, data: row });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const update = async (req, res) => {
  const { SellPrice1, SellPrice2, SellPrice3, SellPrice4, SellPrice5 } = req.body;
  try {
    const r = await db.run(
      `UPDATE SellPrice_tbl
       SET SellPrice1=?,SellPrice2=?,SellPrice3=?,SellPrice4=?,SellPrice5=?,LastSellPrice=?
       WHERE id_Material_NoM=?`,
      [SellPrice1, SellPrice2, SellPrice3, SellPrice4, SellPrice5, SellPrice1, req.params.materialId]);
    if (!r.changes) return res.status(404).json({ success: false, message: "السجل غير موجود" });

    // حفظ في سجل التاريخ
    await db.run(
      `INSERT INTO PriceHistory_tbl (id_Material_NoM,SellPrice,IsCurrentPrice,ChangedByUser)
       VALUES (?,?,1,?)`,
      [req.params.materialId, SellPrice1, req.user?.id_User || null]);

    // إلغاء تفعيل الأسعار القديمة في التاريخ
    await db.run(
      `UPDATE PriceHistory_tbl SET IsCurrentPrice=0
       WHERE id_Material_NoM=? AND id_PriceHistory < (SELECT MAX(id_PriceHistory) FROM PriceHistory_tbl WHERE id_Material_NoM=?)`,
      [req.params.materialId, req.params.materialId]);

    res.json({ success: true, message: "تم تحديث الأسعار" });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

module.exports = { getAll, getOne, update };
