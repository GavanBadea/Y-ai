// controllers/payType.controller.js  —  جدول نوعية الدفع PayType_Tbl
const db = require("../db");

const getAll = async (_req, res) => {
  try {
    const rows = await db.query(`SELECT * FROM PayType_Tbl`);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const getOne = async (req, res) => {
  try {
    const row = await db.queryOne(`SELECT * FROM PayType_Tbl WHERE id_PayType=?`, [req.params.id]);
    if (!row) return res.status(404).json({ success: false, message: "نوع الدفع غير موجود" });
    res.json({ success: true, data: row });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const create = async (req, res) => {
  const { PayTypeName } = req.body;
  if (!PayTypeName) return res.status(400).json({ success: false, message: "الاسم مطلوب" });
  try {
    const r = await db.run(`INSERT INTO PayType_Tbl (PayTypeName) VALUES (?)`, [PayTypeName]);
    res.status(201).json({ success: true, message: "تم الإضافة", id: r.lastID });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const update = async (req, res) => {
  const { PayTypeName } = req.body;
  try {
    const r = await db.run(`UPDATE PayType_Tbl SET PayTypeName=? WHERE id_PayType=?`, [PayTypeName, req.params.id]);
    if (!r.changes) return res.status(404).json({ success: false, message: "نوع الدفع غير موجود" });
    res.json({ success: true, message: "تم التعديل" });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const remove = async (req, res) => {
  try {
    const r = await db.run(`DELETE FROM PayType_Tbl WHERE id_PayType=?`, [req.params.id]);
    if (!r.changes) return res.status(404).json({ success: false, message: "نوع الدفع غير موجود" });
    res.json({ success: true, message: "تم الحذف" });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

module.exports = { getAll, getOne, create, update, remove };
