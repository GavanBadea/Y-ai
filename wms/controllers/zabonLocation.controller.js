// controllers/zabonLocation.controller.js  —  جدول مواقع الزبائن Zabon_Location
const db = require("../db");

const getAll = async (_req, res) => {
  try {
    const rows = await db.query(`SELECT * FROM Zabon_Location ORDER BY Location_ZabonLocation`);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const getOne = async (req, res) => {
  try {
    const row = await db.queryOne(`SELECT * FROM Zabon_Location WHERE id_ZabonLocation=?`, [req.params.id]);
    if (!row) return res.status(404).json({ success: false, message: "الموقع غير موجود" });
    res.json({ success: true, data: row });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const create = async (req, res) => {
  const { Location_ZabonLocation } = req.body;
  if (!Location_ZabonLocation) return res.status(400).json({ success: false, message: "اسم الموقع مطلوب" });
  try {
    const r = await db.run(`INSERT INTO Zabon_Location (Location_ZabonLocation) VALUES (?)`, [Location_ZabonLocation]);
    res.status(201).json({ success: true, message: "تم إضافة الموقع", id: r.lastID });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const update = async (req, res) => {
  const { Location_ZabonLocation } = req.body;
  try {
    const r = await db.run(`UPDATE Zabon_Location SET Location_ZabonLocation=? WHERE id_ZabonLocation=?`, [Location_ZabonLocation, req.params.id]);
    if (!r.changes) return res.status(404).json({ success: false, message: "الموقع غير موجود" });
    res.json({ success: true, message: "تم التعديل" });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const remove = async (req, res) => {
  try {
    const r = await db.run(`DELETE FROM Zabon_Location WHERE id_ZabonLocation=?`, [req.params.id]);
    if (!r.changes) return res.status(404).json({ success: false, message: "الموقع غير موجود" });
    res.json({ success: true, message: "تم الحذف" });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

module.exports = { getAll, getOne, create, update, remove };
