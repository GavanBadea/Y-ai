// controllers/zabon.controller.js  —  جدول الزبائن Zabon_tbl
const db = require("../db");

const getAll = async (req, res) => {
  try {
    const { id_ZabonLocation } = req.query;
    let sql = `
      SELECT z.*, zl.Location_ZabonLocation,
        COALESCE((SELECT SUM(Amount_DionZabon) FROM DionZabon_tbl WHERE id_Zabon=z.id_Zabon),0) AS TotalDebt,
        COALESCE((SELECT SUM(Amount_CatchDoc)  FROM CatchDoc_tbl   WHERE id_Zabon=z.id_Zabon),0) AS TotalCollected
      FROM Zabon_tbl z
      LEFT JOIN Zabon_Location zl ON zl.id_ZabonLocation = z.id_ZabonLocation
      WHERE 1=1`;
    const p = [];
    if (id_ZabonLocation) { sql += " AND z.id_ZabonLocation=?"; p.push(id_ZabonLocation); }
    sql += " ORDER BY z.ZabonName";
    const rows = await db.query(sql, p);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const getOne = async (req, res) => {
  try {
    const row = await db.queryOne(
      `SELECT z.*,zl.Location_ZabonLocation FROM Zabon_tbl z
       LEFT JOIN Zabon_Location zl ON zl.id_ZabonLocation=z.id_ZabonLocation
       WHERE z.id_Zabon=?`, [req.params.id]);
    if (!row) return res.status(404).json({ success: false, message: "الزبون غير موجود" });
    res.json({ success: true, data: row });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const create = async (req, res) => {
  const { ZabonName, Mobail, Adress, id_ZabonLocation = 0, "Credit Limit": CreditLimit = 0 } = req.body;
  if (!Mobail || !Adress) return res.status(400).json({ success: false, message: "الهاتف والعنوان مطلوبان" });
  try {
    const r = await db.run(
      `INSERT INTO Zabon_tbl (ZabonName,Mobail,Adress,id_ZabonLocation,"Credit Limit") VALUES (?,?,?,?,?)`,
      [ZabonName, Mobail, Adress, id_ZabonLocation, CreditLimit]);
    res.status(201).json({ success: true, message: "تم إضافة الزبون", id: r.lastID });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const update = async (req, res) => {
  const { ZabonName, Mobail, Adress, id_ZabonLocation, "Credit Limit": CreditLimit } = req.body;
  try {
    const r = await db.run(
      `UPDATE Zabon_tbl SET ZabonName=?,Mobail=?,Adress=?,id_ZabonLocation=?,"Credit Limit"=? WHERE id_Zabon=?`,
      [ZabonName, Mobail, Adress, id_ZabonLocation, CreditLimit, req.params.id]);
    if (!r.changes) return res.status(404).json({ success: false, message: "الزبون غير موجود" });
    res.json({ success: true, message: "تم التعديل" });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const remove = async (req, res) => {
  try {
    const r = await db.run(`DELETE FROM Zabon_tbl WHERE id_Zabon=?`, [req.params.id]);
    if (!r.changes) return res.status(404).json({ success: false, message: "الزبون غير موجود" });
    res.json({ success: true, message: "تم الحذف" });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

module.exports = { getAll, getOne, create, update, remove };
