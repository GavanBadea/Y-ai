// controllers/amil.controller.js  —  جدول العملاء (الموردين) Amil_tbl
const db = require("../db");

const getAll = async (_req, res) => {
  try {
    const rows = await db.query(`
      SELECT a.*,
        COALESCE((SELECT SUM(Amount_DionAmil) FROM DionAmil_tbl WHERE id_Amil = a.id_Amil), 0) AS TotalDebt,
        COALESCE((SELECT SUM(Amount_PayDoc)   FROM PayDoc_tbl   WHERE id_Amil = a.id_Amil), 0) AS TotalPaid
      FROM Amil_tbl a ORDER BY a.AmilName`);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const getOne = async (req, res) => {
  try {
    const row = await db.queryOne(`SELECT * FROM Amil_tbl WHERE id_Amil = ?`, [req.params.id]);
    if (!row) return res.status(404).json({ success: false, message: "المورد غير موجود" });
    res.json({ success: true, data: row });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const create = async (req, res) => {
  const { AmilName, Mobil, Adress } = req.body;
  if (!Mobil || !Adress) return res.status(400).json({ success: false, message: "الهاتف والعنوان مطلوبان" });
  try {
    const r = await db.run(`INSERT INTO Amil_tbl (AmilName,Mobil,Adress) VALUES (?,?,?)`, [AmilName, Mobil, Adress]);
    res.status(201).json({ success: true, message: "تم إضافة المورد", id: r.lastID });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const update = async (req, res) => {
  const { AmilName, Mobil, Adress } = req.body;
  try {
    const r = await db.run(`UPDATE Amil_tbl SET AmilName=?,Mobil=?,Adress=? WHERE id_Amil=?`, [AmilName, Mobil, Adress, req.params.id]);
    if (!r.changes) return res.status(404).json({ success: false, message: "المورد غير موجود" });
    res.json({ success: true, message: "تم التعديل" });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const remove = async (req, res) => {
  try {
    const r = await db.run(`DELETE FROM Amil_tbl WHERE id_Amil=?`, [req.params.id]);
    if (!r.changes) return res.status(404).json({ success: false, message: "المورد غير موجود" });
    res.json({ success: true, message: "تم الحذف" });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

module.exports = { getAll, getOne, create, update, remove };
