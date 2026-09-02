// controllers/priceHistory.controller.js  —  جدول تاريخ الأسعار PriceHistory_tbl
const db = require("../db");

const getByMaterial = async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT ph.*, u.UserName AS ChangedBy, m.MaterialName
       FROM PriceHistory_tbl ph
       LEFT JOIN Users_tbl u ON u.id_User=ph.ChangedByUser
       LEFT JOIN Materials_tbl m ON m.id_Material_NoM=ph.id_Material_NoM
       WHERE ph.id_Material_NoM=?
       ORDER BY ph.EffectiveDate DESC, ph.EffectiveTime DESC`,
      [req.params.materialId]);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const getAll = async (req, res) => {
  try {
    const { isCurrentPrice } = req.query;
    let sql = `
      SELECT ph.*, m.MaterialName, u.UserName AS ChangedBy
      FROM PriceHistory_tbl ph
      JOIN Materials_tbl m ON m.id_Material_NoM=ph.id_Material_NoM
      LEFT JOIN Users_tbl u ON u.id_User=ph.ChangedByUser
      WHERE 1=1`;
    const p = [];
    if (isCurrentPrice !== undefined) { sql += " AND ph.IsCurrentPrice=?"; p.push(isCurrentPrice); }
    sql += " ORDER BY ph.EffectiveDate DESC LIMIT 500";
    const rows = await db.query(sql, p);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const create = async (req, res) => {
  const { id_Material_NoM, SellPrice, CostPrice, ChangeNotes } = req.body;
  if (!id_Material_NoM || SellPrice === undefined)
    return res.status(400).json({ success: false, message: "المادة وسعر البيع مطلوبان" });
  try {
    // ألغِ تفعيل الأسعار السابقة
    await db.run(
      `UPDATE PriceHistory_tbl SET IsCurrentPrice=0 WHERE id_Material_NoM=?`,
      [id_Material_NoM]);

    const r = await db.run(
      `INSERT INTO PriceHistory_tbl (id_Material_NoM,SellPrice,CostPrice,IsCurrentPrice,ChangedByUser,ChangeNotes)
       VALUES (?,?,?,1,?,?)`,
      [id_Material_NoM, SellPrice, CostPrice, req.user?.id_User || null, ChangeNotes]);

    // حدّث LastSellPrice في جدول الأسعار الرئيسي
    await db.run(
      `UPDATE SellPrice_tbl SET LastSellPrice=? WHERE id_Material_NoM=?`,
      [SellPrice, id_Material_NoM]);

    res.status(201).json({ success: true, message: "تم تسجيل السعر الجديد", id: r.lastID });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

module.exports = { getAll, getByMaterial, create };
