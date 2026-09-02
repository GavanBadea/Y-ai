// controllers/auditLog.controller.js  —  جدول سجل التغييرات AuditLog_tbl
const db = require("../db");

/** ملخص أسطر الفاتورة: اسم المادة والكمية */
function formatLinesSummary(lines, kind = "out") {
  if (!lines?.length) return "";
  return lines
    .map((l) => {
      const name = l.MaterialName || `مادة #${l.id_Material_NoM}`;
      const qty =
        kind === "in"
          ? (+(l.AmountIN || 0) + +(l.Gift_IN || 0))
          : (+(l.AmountOUT || 0) + +(l.gift_qty || 0));
      const unit = l.Band ? ` ${l.Band}` : "";
      return `${name}: ${qty}${unit}`;
    })
    .join(" | ");
}

/** إلغاء قيود الدين المرتبطة بفاتورة (حتى لو نوع الدفع نقدي أو تغيّر الملاحظة) */
async function removeInvoiceDebtLinks(kind, partyId, invoiceId) {
  const isCust = kind === "customer";
  const table = isCust ? "DionZabon_tbl" : "DionAmil_tbl";
  const partyCol = isCust ? "id_Zabon" : "id_Amil";
  const noteCol = isCust ? "Note_DionZabon" : "Note_DionAmil";
  const prefix = isCust ? "فاتورة مبيعات رقم" : "فاتورة مشتريات رقم";
  const id = String(invoiceId);
  const exact = `${prefix} ${id}`;
  const r = await db.run(
    `DELETE FROM ${table}
     WHERE ${partyCol}=?
       AND (
         ${noteCol}=?
         OR ${noteCol} LIKE ?
         OR ${noteCol} LIKE ?
         OR ${noteCol} LIKE ?
       )`,
    [
      partyId,
      exact,
      `${exact}%`,
      `%${prefix}%${id}%`,
      `%تعديل فاتورة%#${id}%`,
    ]
  );
  return r.changes || 0;
}

function parseMaterialsFromNotes(notes = "") {
  const text = String(notes || "");
  const chunk = text.includes("مواد:")
    ? text.split("مواد:")[1]
    : text.includes(" | ")
      ? text
      : "";
  if (!chunk) return [];
  return chunk
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((part) => {
      const m = part.match(/^(.+?):\s*([\d.]+)\s*(.*)$/);
      if (!m) return { name: part, qty: "", unit: "" };
      return { name: m[1].trim(), qty: m[2], unit: (m[3] || "").trim() };
    });
}

const getAll = async (req, res) => {
  try {
    const {
      id_User,
      TableName,
      from,
      to,
      q,
      action,
      limit = 200,
    } = req.query;
    let sql = `
      SELECT
        id_AuditLog,
        id_User,
        UserName,
        TableName,
        RecordID,
        COALESCE(NULLIF(TRIM(FieldName), ''), Action) AS FieldName,
        OldValue,
        NewValue,
        Notes,
        COALESCE(ChangeDate, date(Timestamp), date('now')) AS ChangeDate,
        COALESCE(ChangeTime, time(Timestamp), time('now')) AS ChangeTime
      FROM AuditLog_tbl
      WHERE 1=1`;
    const p = [];
    if (id_User)   { sql += " AND id_User=?";     p.push(id_User); }
    if (TableName) { sql += " AND TableName=?";   p.push(TableName); }
    if (from)      { sql += " AND COALESCE(ChangeDate, date(Timestamp))>=?"; p.push(from); }
    if (to)        { sql += " AND COALESCE(ChangeDate, date(Timestamp))<=?"; p.push(to); }
    if (action === "CREATE") {
      sql += " AND (FieldName LIKE 'CREATE%' OR Notes LIKE '%إنشاء%' OR Notes LIKE '%CREATE%')";
    } else if (action === "DELETE") {
      sql += " AND (FieldName LIKE 'DELETE%' OR Notes LIKE '%حذف%' OR Notes LIKE '%DELETE%')";
    } else if (action === "UPDATE") {
      sql += ` AND FieldName NOT LIKE 'CREATE%' AND FieldName NOT LIKE 'DELETE%'
               AND (OldValue IS NOT NULL AND OldValue != '' OR NewValue IS NOT NULL AND NewValue != '')`;
    }
    if (q && String(q).trim()) {
      const term = `%${String(q).trim()}%`;
      sql += ` AND (
        UserName LIKE ? OR TableName LIKE ? OR FieldName LIKE ? OR
        OldValue LIKE ? OR NewValue LIKE ? OR Notes LIKE ? OR
        CAST(RecordID AS TEXT) LIKE ?
      )`;
      p.push(term, term, term, term, term, term, term);
    }
    sql += " ORDER BY ChangeDate DESC, ChangeTime DESC LIMIT ?";
    p.push(Math.min(Number(limit) || 200, 500));
    const rows = await db.query(sql, p);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const getTables = async (_req, res) => {
  try {
    const rows = await db.query(
      `SELECT DISTINCT TableName FROM AuditLog_tbl WHERE TableName IS NOT NULL AND TableName != '' ORDER BY TableName`
    );
    res.json({ success: true, data: rows.map((r) => r.TableName) });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const getUsers = async (_req, res) => {
  try {
    const rows = await db.query(
      `SELECT DISTINCT id_User, UserName FROM AuditLog_tbl WHERE id_User IS NOT NULL ORDER BY UserName`
    );
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const getOne = async (req, res) => {
  try {
    const row = await db.queryOne(
      `SELECT
        id_AuditLog, id_User, UserName, TableName, RecordID,
        COALESCE(NULLIF(TRIM(FieldName), ''), Action) AS FieldName,
        OldValue, NewValue, Notes,
        COALESCE(ChangeDate, date(Timestamp), date('now')) AS ChangeDate,
        COALESCE(ChangeTime, time(Timestamp), time('now')) AS ChangeTime
       FROM AuditLog_tbl WHERE id_AuditLog=?`,
      [req.params.id]
    );
    if (!row) return res.status(404).json({ success: false, message: "السجل غير موجود" });
    res.json({
      success: true,
      data: { ...row, materials: parseMaterialsFromNotes(row.Notes) },
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// يُستدعى برمجياً من Controllers الأخرى (ليس من المستخدم مباشرة)
const log = async (user, TableName, RecordID, FieldName, OldValue, NewValue, Notes = "") => {
  try {
    await db.run(
      `INSERT INTO AuditLog_tbl
         (id_User, UserName, TableName, RecordID, FieldName, Action, OldValue, NewValue, Notes, ChangeDate, ChangeTime)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, date('now'), time('now'))`,
      [
        user?.id_User ?? 0,
        user?.UserName || "System",
        TableName,
        RecordID ?? 0,
        FieldName || "",
        FieldName || "",
        String(OldValue ?? ""),
        String(NewValue ?? ""),
        Notes || "",
      ]
    );
  } catch (e) {
    console.error("[AuditLog] فشل التسجيل:", e.message);
  }
};

module.exports = {
  getAll,
  getOne,
  getTables,
  getUsers,
  log,
  formatLinesSummary,
  removeInvoiceDebtLinks,
};
