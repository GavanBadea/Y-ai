// ============================================================
//  controllers/party.controller.js
//
//  إدارة الأطراف التجارية:
//   • Zabon_tbl  — الزبائن   (مع التحقق من id_ZabonLocation)
//   • Amil_tbl   — الموردون
//
//  كل طرف يُرجع رصيده الحالي (ديون - مدفوعات) مع بياناته
// ============================================================
const db = require("../db");

// ══════════════════════════════════════════════════════════
//  ZABON — الزبائن
// ══════════════════════════════════════════════════════════

// ── GET ALL ──────────────────────────────────────────────
const getAllZabon = async (req, res) => {
  try {
    const { id_ZabonLocation, search } = req.query;

    let sql = `
      SELECT
        z.*,
        zl.Location_ZabonLocation,
        -- إجمالي الديون
        COALESCE((
          SELECT SUM(Amount_DionZabon)
          FROM DionZabon_tbl
          WHERE id_Zabon = z.id_Zabon
        ), 0) AS TotalDebt,
        -- إجمالي المقبوض
        COALESCE((
          SELECT SUM(Amount_CatchDoc)
          FROM CatchDoc_tbl
          WHERE id_Zabon = z.id_Zabon
        ), 0) AS TotalCollected,
        -- الرصيد الصافي (موجب = مديون لنا)
        COALESCE((
          SELECT SUM(Amount_DionZabon) FROM DionZabon_tbl WHERE id_Zabon = z.id_Zabon
        ), 0) -
        COALESCE((
          SELECT SUM(Amount_CatchDoc) FROM CatchDoc_tbl WHERE id_Zabon = z.id_Zabon
        ), 0) AS NetBalance
      FROM Zabon_tbl z
      LEFT JOIN Zabon_Location zl ON zl.id_ZabonLocation = z.id_ZabonLocation
      WHERE 1=1`;

    const params = [];
    if (id_ZabonLocation) {
      sql += " AND z.id_ZabonLocation = ?";
      params.push(id_ZabonLocation);
    }
    if (search) {
      sql += " AND (z.ZabonName LIKE ? OR z.Mobail LIKE ?)";
      params.push(`%${search}%`, `%${search}%`);
    }
    sql += " ORDER BY z.ZabonName";

    const rows = await db.query(sql, params);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── GET ONE ──────────────────────────────────────────────
const getOneZabon = async (req, res) => {
  try {
    const zabon = await db.queryOne(`
      SELECT
        z.*,
        zl.Location_ZabonLocation,
        COALESCE((SELECT SUM(Amount_DionZabon) FROM DionZabon_tbl  WHERE id_Zabon = z.id_Zabon), 0) AS TotalDebt,
        COALESCE((SELECT SUM(Amount_CatchDoc)  FROM CatchDoc_tbl   WHERE id_Zabon = z.id_Zabon), 0) AS TotalCollected,
        COALESCE((SELECT SUM(Amount_DionZabon) FROM DionZabon_tbl  WHERE id_Zabon = z.id_Zabon), 0) -
        COALESCE((SELECT SUM(Amount_CatchDoc)  FROM CatchDoc_tbl   WHERE id_Zabon = z.id_Zabon), 0) AS NetBalance
      FROM Zabon_tbl z
      LEFT JOIN Zabon_Location zl ON zl.id_ZabonLocation = z.id_ZabonLocation
      WHERE z.id_Zabon = ?`, [req.params.id]);

    if (!zabon)
      return res.status(404).json({ success: false, message: "الزبون غير موجود" });

    res.json({ success: true, data: zabon });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── CREATE ───────────────────────────────────────────────
const createZabon = async (req, res) => {
  const {
    ZabonName,
    Mobail,
    Adress,
    id_ZabonLocation = 0,
    "Credit Limit": CreditLimit = 0,
  } = req.body;

  // ── التحقق من الحقول الإلزامية ──────────────────────
  if (!ZabonName || !Mobail || !Adress)
    return res.status(400).json({
      success  : false,
      message  : "الحقول المطلوبة: ZabonName, Mobail, Adress",
      required : ["ZabonName", "Mobail", "Adress"],
    });

  // ── التحقق من وجود الموقع إذا أُرسل ─────────────────
  if (id_ZabonLocation && Number(id_ZabonLocation) !== 0) {
    const location = await db.queryOne(
      `SELECT id_ZabonLocation FROM Zabon_Location WHERE id_ZabonLocation = ?`,
      [id_ZabonLocation]
    );
    if (!location)
      return res.status(400).json({
        success : false,
        message : `الموقع id_ZabonLocation = ${id_ZabonLocation} غير موجود في جدول Zabon_Location`,
        hint    : "تحقق من /api/common/locations للحصول على القيم الصحيحة",
      });
  }

  try {
    const r = await db.run(
      `INSERT INTO Zabon_tbl (ZabonName, Mobail, Adress, id_ZabonLocation, "Credit Limit")
       VALUES (?, ?, ?, ?, ?)`,
      [ZabonName, Mobail, Adress, id_ZabonLocation, CreditLimit]
    );
    res.status(201).json({
      success : true,
      message : "تم إضافة الزبون بنجاح",
      id      : r.lastID,
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── UPDATE ───────────────────────────────────────────────
const updateZabon = async (req, res) => {
  const {
    ZabonName,
    Mobail,
    Adress,
    id_ZabonLocation,
    "Credit Limit": CreditLimit,
  } = req.body;

  // تحقق من الموقع إذا أُرسل
  if (id_ZabonLocation && Number(id_ZabonLocation) !== 0) {
    const location = await db.queryOne(
      `SELECT id_ZabonLocation FROM Zabon_Location WHERE id_ZabonLocation = ?`,
      [id_ZabonLocation]
    );
    if (!location)
      return res.status(400).json({
        success: false,
        message: `الموقع id_ZabonLocation = ${id_ZabonLocation} غير موجود`,
      });
  }

  try {
    const r = await db.run(
      `UPDATE Zabon_tbl
       SET ZabonName = ?, Mobail = ?, Adress = ?,
           id_ZabonLocation = ?, "Credit Limit" = ?
       WHERE id_Zabon = ?`,
      [ZabonName, Mobail, Adress, id_ZabonLocation, CreditLimit, req.params.id]
    );
    if (!r.changes)
      return res.status(404).json({ success: false, message: "الزبون غير موجود" });
    res.json({ success: true, message: "تم تعديل بيانات الزبون" });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── REMOVE ───────────────────────────────────────────────
const removeZabon = async (req, res) => {
  try {
    // تحقق من وجود فواتير أو ديون مرتبطة
    const [invoices, debts] = await Promise.all([
      db.queryOne(`SELECT COUNT(*) AS cnt FROM FOUT_tbl    WHERE id_Zabon = ?`, [req.params.id]),
      db.queryOne(`SELECT COUNT(*) AS cnt FROM DionZabon_tbl WHERE id_Zabon = ?`, [req.params.id]),
    ]);

    if (invoices.cnt > 0 || debts.cnt > 0)
      return res.status(409).json({
        success  : false,
        message  : "لا يمكن حذف الزبون لوجود فواتير أو ديون مرتبطة به",
        details  : { invoices: invoices.cnt, debts: debts.cnt },
      });

    const r = await db.run(`DELETE FROM Zabon_tbl WHERE id_Zabon = ?`, [req.params.id]);
    if (!r.changes)
      return res.status(404).json({ success: false, message: "الزبون غير موجود" });
    res.json({ success: true, message: "تم حذف الزبون" });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ══════════════════════════════════════════════════════════
//  AMIL — الموردون
// ══════════════════════════════════════════════════════════

// ── GET ALL ──────────────────────────────────────────────
const getAllAmil = async (req, res) => {
  try {
    const { search } = req.query;

    let sql = `
      SELECT
        a.*,
        COALESCE((SELECT SUM(Amount_DionAmil) FROM DionAmil_tbl WHERE id_Amil = a.id_Amil), 0) AS TotalDebt,
        COALESCE((SELECT SUM(Amount_PayDoc)   FROM PayDoc_tbl   WHERE id_Amil = a.id_Amil), 0) AS TotalPaid,
        COALESCE((SELECT SUM(Amount_DionAmil) FROM DionAmil_tbl WHERE id_Amil = a.id_Amil), 0) -
        COALESCE((SELECT SUM(Amount_PayDoc)   FROM PayDoc_tbl   WHERE id_Amil = a.id_Amil), 0) AS NetBalance
      FROM Amil_tbl a
      WHERE 1=1`;

    const params = [];
    if (search) {
      sql += " AND (a.AmilName LIKE ? OR a.Mobil LIKE ?)";
      params.push(`%${search}%`, `%${search}%`);
    }
    sql += " ORDER BY a.AmilName";

    const rows = await db.query(sql, params);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── GET ONE ──────────────────────────────────────────────
const getOneAmil = async (req, res) => {
  try {
    const amil = await db.queryOne(`
      SELECT
        a.*,
        COALESCE((SELECT SUM(Amount_DionAmil) FROM DionAmil_tbl WHERE id_Amil = a.id_Amil), 0) AS TotalDebt,
        COALESCE((SELECT SUM(Amount_PayDoc)   FROM PayDoc_tbl   WHERE id_Amil = a.id_Amil), 0) AS TotalPaid,
        COALESCE((SELECT SUM(Amount_DionAmil) FROM DionAmil_tbl WHERE id_Amil = a.id_Amil), 0) -
        COALESCE((SELECT SUM(Amount_PayDoc)   FROM PayDoc_tbl   WHERE id_Amil = a.id_Amil), 0) AS NetBalance
      FROM Amil_tbl a
      WHERE a.id_Amil = ?`, [req.params.id]);

    if (!amil)
      return res.status(404).json({ success: false, message: "المورد غير موجود" });
    res.json({ success: true, data: amil });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── CREATE ───────────────────────────────────────────────
const createAmil = async (req, res) => {
  const { AmilName, Mobil, Adress } = req.body;

  if (!Mobil || !Adress)
    return res.status(400).json({
      success  : false,
      message  : "الحقول المطلوبة: Mobil, Adress",
      required : ["Mobil", "Adress"],
    });

  try {
    const r = await db.run(
      `INSERT INTO Amil_tbl (AmilName, Mobil, Adress) VALUES (?, ?, ?)`,
      [AmilName || null, Mobil, Adress]
    );
    res.status(201).json({
      success : true,
      message : "تم إضافة المورد بنجاح",
      id      : r.lastID,
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── UPDATE ───────────────────────────────────────────────
const updateAmil = async (req, res) => {
  const { AmilName, Mobil, Adress } = req.body;
  try {
    const r = await db.run(
      `UPDATE Amil_tbl SET AmilName = ?, Mobil = ?, Adress = ? WHERE id_Amil = ?`,
      [AmilName, Mobil, Adress, req.params.id]
    );
    if (!r.changes)
      return res.status(404).json({ success: false, message: "المورد غير موجود" });
    res.json({ success: true, message: "تم تعديل بيانات المورد" });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── REMOVE ───────────────────────────────────────────────
const removeAmil = async (req, res) => {
  try {
    const [invoices, debts] = await Promise.all([
      db.queryOne(`SELECT COUNT(*) AS cnt FROM FIN_tbl      WHERE id_Amil = ?`, [req.params.id]),
      db.queryOne(`SELECT COUNT(*) AS cnt FROM DionAmil_tbl WHERE id_Amil = ?`, [req.params.id]),
    ]);

    if (invoices.cnt > 0 || debts.cnt > 0)
      return res.status(409).json({
        success : false,
        message : "لا يمكن حذف المورد لوجود فواتير أو ديون مرتبطة به",
        details : { invoices: invoices.cnt, debts: debts.cnt },
      });

    const r = await db.run(`DELETE FROM Amil_tbl WHERE id_Amil = ?`, [req.params.id]);
    if (!r.changes)
      return res.status(404).json({ success: false, message: "المورد غير موجود" });
    res.json({ success: true, message: "تم حذف المورد" });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

module.exports = {
  // الزبائن
  getAllZabon, getOneZabon, createZabon, updateZabon, removeZabon,
  // الموردون
  getAllAmil, getOneAmil, createAmil, updateAmil, removeAmil,
};
