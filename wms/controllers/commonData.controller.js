// ============================================================
//  controllers/commonData.controller.js
//
//  CRUD موحّد لجداول البيانات المرجعية (Lookup Tables):
//    • Zabon_Location   — أماكن الزبائن
//    • Mandob_tbl       — المندوبون
//    • PayType_Tbl      — طرق الدفع
//    • Catiguary_tbl    — أصناف المواد
//    • Type_tbl         — أنواع المواد
//
//  بدلاً من تكرار نفس الكود 5 مرات، نستخدم factory function
//  تُنتج مجموعة handlers جاهزة لكل جدول.
// ============================================================
const db = require("../db");

// ──────────────────────────────────────────────────────────
//  crudFactory — تُنتج { getAll, getOne, create, update, remove }
//
//  @param table   اسم الجدول في SQLite
//  @param pk      اسم عمود المفتاح الأساسي
//  @param fields  مصفوفة أسماء الحقول القابلة للكتابة
//  @param label   اسم العنصر بالعربي (للرسائل)
// ──────────────────────────────────────────────────────────
function crudFactory(table, pk, fields, label) {

  // ── GET ALL ──────────────────────────────────────────────
  const getAll = async (_req, res) => {
    try {
      const rows = await db.query(`SELECT * FROM "${table}" ORDER BY ${pk}`);
      res.json({ success: true, count: rows.length, data: rows });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  };

  // ── GET ONE ──────────────────────────────────────────────
  const getOne = async (req, res) => {
    try {
      const row = await db.queryOne(
        `SELECT * FROM "${table}" WHERE ${pk} = ?`, [req.params.id]
      );
      if (!row)
        return res.status(404).json({ success: false, message: `${label} غير موجود` });
      res.json({ success: true, data: row });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  };

  // ── CREATE ───────────────────────────────────────────────
  const create = async (req, res) => {
    // تحقق من وجود الحقل الأول على الأقل (الاسم)
    const firstField = fields[0];
    if (!req.body[firstField])
      return res.status(400).json({
        success : false,
        message : `حقل "${firstField}" مطلوب`,
      });

    const cols   = fields.filter((f) => req.body[f] !== undefined);
    const values = cols.map((f) => req.body[f]);

    try {
      const r = await db.run(
        `INSERT INTO "${table}" (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
        values
      );
      res.status(201).json({ success: true, message: `تم إضافة ${label}`, id: r.lastID });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  };

  // ── UPDATE ───────────────────────────────────────────────
  const update = async (req, res) => {
    const cols   = fields.filter((f) => req.body[f] !== undefined);
    const values = cols.map((f) => req.body[f]);

    if (!cols.length)
      return res.status(400).json({ success: false, message: "لم يُرسَل أي حقل للتعديل" });

    values.push(req.params.id);
    try {
      const r = await db.run(
        `UPDATE "${table}" SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE ${pk} = ?`,
        values
      );
      if (!r.changes)
        return res.status(404).json({ success: false, message: `${label} غير موجود` });
      res.json({ success: true, message: `تم تعديل ${label}` });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  };

  // ── REMOVE ───────────────────────────────────────────────
  const remove = async (req, res) => {
    try {
      const r = await db.run(
        `DELETE FROM "${table}" WHERE ${pk} = ?`, [req.params.id]
      );
      if (!r.changes)
        return res.status(404).json({ success: false, message: `${label} غير موجود` });
      res.json({ success: true, message: `تم حذف ${label}` });
    } catch (e) {
      // خطأ FOREIGN KEY — يعني العنصر مستخدم في جداول أخرى
      if (e.message?.includes("FOREIGN KEY"))
        return res.status(409).json({
          success : false,
          message : `لا يمكن حذف ${label} لأنه مرتبط ببيانات أخرى في النظام`,
        });
      res.status(500).json({ success: false, message: e.message });
    }
  };

  return { getAll, getOne, create, update, remove };
}

// ══════════════════════════════════════════════════════════
//  إنشاء الـ handlers لكل جدول
// ══════════════════════════════════════════════════════════

/** أماكن الزبائن */
const zabonLocation = crudFactory(
  "Zabon_Location",
  "id_ZabonLocation",
  ["Location_ZabonLocation"],
  "موقع الزبون"
);

/** المندوبون */
const mandob = crudFactory(
  "Mandob_tbl",
  "id_Mandob",
  ["MandobName", "Mobile"],
  "المندوب"
);

/** طرق الدفع */
const payType = crudFactory(
  "PayType_Tbl",
  "id_PayType",
  ["PayTypeName"],
  "طريقة الدفع"
);

/** أصناف المواد */
const catiguary = crudFactory(
  "Catiguary_tbl",
  "id_Catiguary",
  ["CatiguaryName"],
  "الصنف"
);

/** أنواع المواد */
const type = crudFactory(
  "Type_tbl",
  "id_Type",
  ["TypeName"],
  "النوع"
);

/** الصناديق النقدية */
const cashBox = crudFactory(
  "CashBox_tbl",
  "id_CashBox",
  ["CashBoxName"],
  "الصندوق"
);

module.exports = { zabonLocation, mandob, payType, catiguary, type, cashBox };
