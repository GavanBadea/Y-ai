// ============================================================
//  controllers/accountStatement.controller.js
//  كشف حسابات الزبائن والموردين — وحدة مستقلة تماماً
//
//  نقطتا الدخول:
//   GET /api/statements/customer?id_Zabon=&from=&to=
//   GET /api/statements/supplier?id_Amil=&from=&to=
//   GET /api/statements/customers-list   — قائمة الزبائن
//   GET /api/statements/suppliers-list   — قائمة الموردين
//
//  منطق UNION ALL:
//   الزبون : فواتير بيع | مرتجعات مبيعات | ديون سابقة | سندات قبض
//   المورد : فواتير شراء | مرتجعات مشتريات | ديون سابقة | سندات دفع
//
//  الرصيد التراكمي يُحسب في JavaScript بعد الاستعلام
// ============================================================
const db = require("../db");
const { DEFERRED_PAY_SQL, SALE_INVOICE_AMT, PURCHASE_INVOICE_AMT } = require("../utils/statementPayType");
const {
  expandCashStatementRows,
  linkInvoicePaymentRows,
  sortStatementRows,
} = require("../utils/statementCashRows");
const { sendWhatsApp } = require("./whatsapp.controller");

const r2 = (n) => Math.round((+n || 0) * 100) / 100;

/** وقت الحركة من سجل التدقيق أو منتصف الليل كاحتياط */
const TX_DT = (table, idCol, dateCol) =>
  `COALESCE(
    (SELECT al.ChangeDate || ' ' || al.ChangeTime
     FROM AuditLog_tbl al
     WHERE al.TableName = '${table}' AND al.RecordID = ${idCol}
     ORDER BY al.id_AuditLog ASC LIMIT 1),
    ${dateCol} || ' 00:00:00'
  )`;

/** ترتيب الإدخال: فواتير آجلة = id قيد الديون المرتبط | ديون سابقة = id_Dion | احتياط = سجل التدقيق */
const CUST_INV_SEQ = `COALESCE(
  (SELECT MIN(al.id_AuditLog) FROM AuditLog_tbl al
   WHERE al.TableName = 'FOUT_tbl' AND al.RecordID = f.id_NoFOUT),
  (SELECT MIN(d.id_DionZabon) FROM DionZabon_tbl d
   WHERE d.id_Zabon = f.id_Zabon AND d.Note_DionZabon = 'فاتورة مبيعات رقم ' || f.id_NoFOUT),
  f.id_NoFOUT
)`;
const SUP_INV_SEQ = `COALESCE(
  (SELECT MIN(al.id_AuditLog) FROM AuditLog_tbl al
   WHERE al.TableName = 'FIN_tbl' AND al.RecordID = f.id_NoFIN),
  (SELECT MIN(d.id_DionAmil) FROM DionAmil_tbl d
   WHERE d.id_Amil = f.id_Amil AND d.Note_DionAmil = 'فاتورة مشتريات رقم ' || f.id_NoFIN),
  f.id_NoFIN
)`;

function attachTxSeqForCash(expanded, raw, role) {
  const invType = role === "supplier" ? "فاتورة شراء" : "فاتورة بيع";
  const byRef = new Map();
  for (const r of raw) {
    if (r.txType === invType && r.txSeq != null) byRef.set(String(r.txRef), Number(r.txSeq));
  }
  return expanded.map((r) => {
    const seq = byRef.get(String(r.txRef));
    return seq != null ? { ...r, txSeq: seq } : r;
  });
}

// ── حل نطاق التاريخ مع قيم افتراضية ────────────────────────
function resolveDates(from, to) {
  const today = new Date().toISOString().split("T")[0];
  return {
    dateFrom : from || "2000-01-01",
    dateTo   : to   || today,
  };
}

// ══════════════════════════════════════════════════════════
//  قوائم الأطراف — للـ Dropdown في الواجهة الأمامية
// ══════════════════════════════════════════════════════════

const getCustomersList = async (_req, res) => {
  try {
    const rows = await db.query(
      `SELECT id_Zabon AS id, ZabonName AS name, Mobail AS mobile
       FROM Zabon_tbl ORDER BY ZabonName`,
      []
    );
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const getSuppliersList = async (_req, res) => {
  try {
    const rows = await db.query(
      `SELECT id_Amil AS id, AmilName AS name, Mobil AS mobile
       FROM Amil_tbl ORDER BY AmilName`,
      []
    );
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const getMandobsList = async (_req, res) => {
  try {
    const rows = await db.query(
      `SELECT id_Mandob AS id, MandobName AS name,
              COALESCE(Mobile, '') AS mobile
       FROM Mandob_tbl ORDER BY MandobName`,
      []
    );
    res.json({ success: true, data: rows });
  } catch (e) {
    try {
      const rows = await db.query(
        `SELECT id_Mandob AS id, MandobName AS name, '' AS mobile
         FROM Mandob_tbl ORDER BY MandobName`,
        []
      );
      res.json({ success: true, data: rows });
    } catch (e2) { res.status(500).json({ success: false, message: e2.message }); }
  }
};

// ══════════════════════════════════════════════════════════
//  كشف حساب الزبون
//  UNION ALL:
//   1. فواتير بيع     → مدين  (الزبون يدين لنا)
//   2. مرتجع مبيعات  → دائن  (يقلل ما يدين)
//   3. ديون سابقة    → مدين  (ديون قبل النظام، غير مرتبطة بفواتير)
//   4. سندات قبض     → دائن  (الزبون دفع)
//  الرصيد التراكمي = Σ(مدين) − Σ(دائن)  — موجب = يديننا
// ══════════════════════════════════════════════════════════
const getCustomerStatement = async (req, res) => {
  const { id_Zabon, from, to } = req.query;
  if (!id_Zabon)
    return res.status(400).json({ success: false, message: "id_Zabon مطلوب" });

  const { dateFrom, dateTo } = resolveDates(from, to);

  try {
    // معلومات الزبون
    const party = await db.queryOne(
      `SELECT z.ZabonName AS name, z.Mobail AS mobile,
              zl.Location_ZabonLocation AS location
       FROM Zabon_tbl z
       LEFT JOIN Zabon_Location zl ON zl.id_ZabonLocation = z.id_ZabonLocation
       WHERE z.id_Zabon = ?`,
      [id_Zabon]
    );
    if (!party)
      return res.status(404).json({ success: false, message: "الزبون غير موجود" });

    const sql = `
      -- ① فواتير المبيعات — آجل: مدين للرصيد | نقدي: عرض فقط في دائن
      SELECT
        f.Date_FOUT                                                  AS txDate,
        ${TX_DT("FOUT_tbl", "f.id_NoFOUT", "f.Date_FOUT")}           AS txDateTime,
        'فاتورة بيع'                                                 AS txType,
        pt.PayTypeName                                               AS txSubType,
        f.id_NoFOUT                                                  AS txRef,
        ${CUST_INV_SEQ}                                              AS txSeq,
        ${SALE_INVOICE_AMT}                                          AS invoiceAmount,
        CASE WHEN ${DEFERRED_PAY_SQL} THEN ${SALE_INVOICE_AMT} ELSE 0 END AS debit,
        0                                                            AS credit,
        CASE WHEN NOT ${DEFERRED_PAY_SQL} THEN ${SALE_INVOICE_AMT} ELSE 0 END AS displayDebit,
        CASE WHEN NOT ${DEFERRED_PAY_SQL} THEN ${SALE_INVOICE_AMT} ELSE 0 END AS displayCredit,
        COALESCE(f.Note_FOUT, '')                                    AS txNote
      FROM FOUT_tbl f
      LEFT JOIN PayType_Tbl pt ON pt.id_PayType = f.id_PayType_FOUT
      WHERE f.id_Zabon = ? AND f.Date_FOUT BETWEEN ? AND ?

      UNION ALL

      -- ② مرتجعات المبيعات (دائن — يقلل ما يدين الزبون)
      SELECT
        r.Date_FRetern                                               AS txDate,
        ${TX_DT("FRetern_tbl", "r.id_NoFRetern", "r.Date_FRetern")} AS txDateTime,
        'مرتجع مبيعات'                                              AS txType,
        ''                                                           AS txSubType,
        r.id_NoFRetern                                               AS txRef,
        COALESCE(
          (SELECT MIN(al.id_AuditLog) FROM AuditLog_tbl al
           WHERE al.TableName = 'FRetern_tbl' AND al.RecordID = r.id_NoFRetern),
          r.id_NoFRetern
        )                                                            AS txSeq,
        0                                                            AS invoiceAmount,
        0                                                            AS debit,
        ROUND(COALESCE((
          SELECT SUM(d.AmountOUT * d.PriceOUT)
          FROM DetailsRetern_tbl d WHERE d.id_NoFRetern = r.id_NoFRetern
        ), 0), 0)                                                    AS credit,
        0                                                            AS displayDebit,
        0                                                            AS displayCredit,
        ''                                                           AS txNote
      FROM FRetern_tbl r
      WHERE r.id_Party = ? AND r.ReturnType = 'CUSTOMER'
        AND r.Date_FRetern BETWEEN ? AND ?

      UNION ALL

      -- ③ ديون سابقة (مدين — ديون يدوية غير مرتبطة بفواتير)
      SELECT
        dz.Date_DionZabon                                            AS txDate,
        ${TX_DT("DionZabon_tbl", "dz.id_DionZabon", "dz.Date_DionZabon")} AS txDateTime,
        'دين سابق'                                                   AS txType,
        ''                                                           AS txSubType,
        dz.id_DionZabon                                              AS txRef,
        dz.id_DionZabon                                              AS txSeq,
        0                                                            AS invoiceAmount,
        dz.Amount_DionZabon                                          AS debit,
        0                                                            AS credit,
        0                                                            AS displayDebit,
        0                                                            AS displayCredit,
        COALESCE(dz.Note_DionZabon, '')                              AS txNote
      FROM DionZabon_tbl dz
      WHERE dz.id_Zabon = ?
        AND dz.Note_DionZabon NOT LIKE 'فاتورة مبيعات رقم%'
        AND dz.Note_DionZabon NOT LIKE 'مرتجع مبيعات رقم%'
        AND dz.Note_DionZabon NOT LIKE 'تسوية سند قبض رقم%'
        AND dz.Note_DionZabon NOT LIKE 'سماح سند قبض رقم%'
        AND dz.Date_DionZabon BETWEEN ? AND ?

      UNION ALL

      -- ④ سندات القبض (دائن — الزبون دفع)
      SELECT
        c.Date_CatchDoc                                              AS txDate,
        ${TX_DT("CatchDoc_tbl", "c.id_CatchDoc", "c.Date_CatchDoc")} AS txDateTime,
        'سند قبض'                                                    AS txType,
        ''                                                           AS txSubType,
        c.id_CatchDoc                                                AS txRef,
        c.id_CatchDoc                                                AS txSeq,
        0                                                            AS invoiceAmount,
        0                                                            AS debit,
        c.Amount_CatchDoc                                            AS credit,
        0                                                            AS displayDebit,
        0                                                            AS displayCredit,
        COALESCE(c.Note_CatchDoc, '')                                AS txNote
      FROM CatchDoc_tbl c
      WHERE c.id_Zabon = ? AND c.Date_CatchDoc BETWEEN ? AND ?

      UNION ALL

      -- ⑤ سماح سندات القبض (دائن — تخفيض دين بدون نقد)
      SELECT
        c.Date_CatchDoc                                              AS txDate,
        ${TX_DT("CatchDoc_tbl", "c.id_CatchDoc", "c.Date_CatchDoc")} AS txDateTime,
        'سماح'                                                       AS txType,
        'سند قبض'                                                    AS txSubType,
        c.id_CatchDoc                                                AS txRef,
        c.id_CatchDoc                                                AS txSeq,
        0                                                            AS invoiceAmount,
        0                                                            AS debit,
        COALESCE(c.AllowanceAmount, 0)                               AS credit,
        0                                                            AS displayDebit,
        0                                                            AS displayCredit,
        'سماح — سند قبض رقم ' || c.id_CatchDoc                       AS txNote
      FROM CatchDoc_tbl c
      WHERE c.id_Zabon = ? AND c.Date_CatchDoc BETWEEN ? AND ?
        AND COALESCE(c.AllowanceAmount, 0) > 0

      ORDER BY txDate ASC, txRef ASC
    `;

    const params = [
      id_Zabon, dateFrom, dateTo,   // ①
      id_Zabon, dateFrom, dateTo,   // ②
      id_Zabon, dateFrom, dateTo,   // ③
      id_Zabon, dateFrom, dateTo,   // ④
      id_Zabon, dateFrom, dateTo,   // ⑤
    ];

    const raw = await db.query(sql, params);
    const expanded = expandCashStatementRows(raw, "customer");
    const rows = sortStatementRows(
      linkInvoicePaymentRows(
        attachTxSeqForCash(expanded, raw, "customer"),
        "customer"
      )
    );

    // حساب الرصيد التراكمي
    let balance = 0;
    const data = rows.map((r) => {
      balance = r2(balance + r.debit - r.credit);
      return {
        ...r,
        debit: r2(r.debit),
        credit: r2(r.credit),
        displayDebit: r2(r.displayDebit || 0),
        displayCredit: r2(r.displayCredit || 0),
        invoiceAmount: r2(r.invoiceAmount || 0),
        balance,
      };
    });

    const totalDebit  = r2(data.reduce((s, r) => s + r.debit,  0));
    const totalCredit = r2(data.reduce((s, r) => s + r.credit, 0));
    const totalAllowance = r2(
      data.filter((r) => r.txType === "سماح").reduce((s, r) => s + r.credit, 0)
    );

    res.json({
      success    : true,
      party      : { ...party, id: id_Zabon },
      dateFrom,
      dateTo,
      data,
      totals     : {
        totalDebit,
        totalCredit,
        totalAllowance,
        finalBalance: r2(totalDebit - totalCredit),
      },
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ══════════════════════════════════════════════════════════
//  كشف حساب المورد
//  UNION ALL:
//   1. فواتير شراء       → دائن  (نحن ندين للمورد)
//   2. مرتجعات مشتريات  → مدين  (يقلل ما ندين)
//   3. ديون سابقة        → دائن  (ديون يدوية قبل النظام)
//   4. سندات دفع         → مدين  (نحن دفعنا)
//  الرصيد التراكمي = Σ(دائن) − Σ(مدين)  — موجب = ندين للمورد
// ══════════════════════════════════════════════════════════
const getSupplierStatement = async (req, res) => {
  const { id_Amil, from, to } = req.query;
  if (!id_Amil)
    return res.status(400).json({ success: false, message: "id_Amil مطلوب" });

  const { dateFrom, dateTo } = resolveDates(from, to);

  try {
    const party = await db.queryOne(
      `SELECT AmilName AS name, Mobil AS mobile FROM Amil_tbl WHERE id_Amil = ?`,
      [id_Amil]
    );
    if (!party)
      return res.status(404).json({ success: false, message: "المورد غير موجود" });

    const sql = `
      -- ① فواتير الشراء — آجل: دائن للرصيد | نقدي: عرض فقط في مدين
      SELECT
        f.Date_FIN                                                   AS txDate,
        ${TX_DT("FIN_tbl", "f.id_NoFIN", "f.Date_FIN")}             AS txDateTime,
        'فاتورة شراء'                                               AS txType,
        pt.PayTypeName                                               AS txSubType,
        f.id_NoFIN                                                   AS txRef,
        ${SUP_INV_SEQ}                                               AS txSeq,
        ${PURCHASE_INVOICE_AMT}                                      AS invoiceAmount,
        0                                                            AS debit,
        CASE WHEN ${DEFERRED_PAY_SQL} THEN ${PURCHASE_INVOICE_AMT} ELSE 0 END AS credit,
        CASE WHEN NOT ${DEFERRED_PAY_SQL} THEN ${PURCHASE_INVOICE_AMT} ELSE 0 END AS displayDebit,
        0                                                            AS displayCredit,
        ''                                                           AS txNote
      FROM FIN_tbl f
      LEFT JOIN PayType_Tbl pt ON pt.id_PayType = f.id_PayType_FIN
      WHERE f.id_Amil = ? AND f.Date_FIN BETWEEN ? AND ?

      UNION ALL

      -- ② مرتجعات المشتريات (مدين — يقلل ما ندين للمورد)
      SELECT
        r.Date_FRetern                                               AS txDate,
        ${TX_DT("FRetern_tbl", "r.id_NoFRetern", "r.Date_FRetern")} AS txDateTime,
        'مرتجع مشتريات'                                             AS txType,
        ''                                                           AS txSubType,
        r.id_NoFRetern                                               AS txRef,
        COALESCE(
          (SELECT MIN(al.id_AuditLog) FROM AuditLog_tbl al
           WHERE al.TableName = 'FRetern_tbl' AND al.RecordID = r.id_NoFRetern),
          r.id_NoFRetern
        )                                                            AS txSeq,
        0                                                            AS invoiceAmount,
        ROUND(COALESCE((
          SELECT SUM(d.AmountOUT * d.PriceOUT)
          FROM DetailsRetern_tbl d WHERE d.id_NoFRetern = r.id_NoFRetern
        ), 0), 0)                                                    AS debit,
        0                                                            AS credit,
        0                                                            AS displayDebit,
        0                                                            AS displayCredit,
        ''                                                           AS txNote
      FROM FRetern_tbl r
      WHERE r.id_Party = ? AND r.ReturnType = 'SUPPLIER'
        AND r.Date_FRetern BETWEEN ? AND ?

      UNION ALL

      -- ③ ديون سابقة للمورد (دائن — ديون يدوية قبل النظام)
      SELECT
        da.Date_DionAmil                                             AS txDate,
        ${TX_DT("DionAmil_tbl", "da.id_DionAmil", "da.Date_DionAmil")} AS txDateTime,
        'دين سابق'                                                   AS txType,
        ''                                                           AS txSubType,
        da.id_DionAmil                                               AS txRef,
        da.id_DionAmil                                               AS txSeq,
        0                                                            AS invoiceAmount,
        0                                                            AS debit,
        da.Amount_DionAmil                                           AS credit,
        0                                                            AS displayDebit,
        0                                                            AS displayCredit,
        COALESCE(da.Note_DionAmil, '')                               AS txNote
      FROM DionAmil_tbl da
      WHERE da.id_Amil = ?
        AND da.Note_DionAmil NOT LIKE 'فاتورة مشتريات رقم%'
        AND da.Note_DionAmil NOT LIKE 'مرتجع مشتريات رقم%'
        AND da.Note_DionAmil NOT LIKE 'تسوية سند دفع رقم%'
        AND da.Date_DionAmil BETWEEN ? AND ?

      UNION ALL

      -- ④ سندات الدفع (مدين — نحن دفعنا للمورد)
      SELECT
        p.Date_PayDoc                                                AS txDate,
        ${TX_DT("PayDoc_tbl", "p.id_PayDoc", "p.Date_PayDoc")}       AS txDateTime,
        'سند دفع'                                                    AS txType,
        ''                                                           AS txSubType,
        p.id_PayDoc                                                  AS txRef,
        p.id_PayDoc                                                  AS txSeq,
        0                                                            AS invoiceAmount,
        p.Amount_PayDoc                                              AS debit,
        0                                                            AS credit,
        0                                                            AS displayDebit,
        0                                                            AS displayCredit,
        COALESCE(p.Note_PayDoc, '')                                  AS txNote
      FROM PayDoc_tbl p
      WHERE p.id_Amil = ? AND p.Date_PayDoc BETWEEN ? AND ?

      ORDER BY txDate ASC, txRef ASC
    `;

    const params = [
      id_Amil, dateFrom, dateTo,   // ①
      id_Amil, dateFrom, dateTo,   // ②
      id_Amil, dateFrom, dateTo,   // ③
      id_Amil, dateFrom, dateTo,   // ④
    ];

    const raw = await db.query(sql, params);
    const expanded = expandCashStatementRows(raw, "supplier");
    const rows = sortStatementRows(
      linkInvoicePaymentRows(
        attachTxSeqForCash(expanded, raw, "supplier"),
        "supplier"
      )
    );

    // حساب الرصيد التراكمي — موجب = ندين للمورد
    let balance = 0;
    const data = rows.map((r) => {
      balance = r2(balance + r.credit - r.debit);
      return {
        ...r,
        debit: r2(r.debit),
        credit: r2(r.credit),
        displayDebit: r2(r.displayDebit || 0),
        displayCredit: r2(r.displayCredit || 0),
        invoiceAmount: r2(r.invoiceAmount || 0),
        balance,
      };
    });

    const totalDebit  = r2(data.reduce((s, r) => s + r.debit,  0));
    const totalCredit = r2(data.reduce((s, r) => s + r.credit, 0));

    res.json({
      success    : true,
      party      : { ...party, id: id_Amil },
      dateFrom,
      dateTo,
      data,
      totals     : { totalDebit, totalCredit, finalBalance: r2(totalCredit - totalDebit) },
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ══════════════════════════════════════════════════════════
//  كشف حساب المندوب
//  UNION ALL:
//   1. فواتير بيع للمندوب     → مدين (مثل الزبون)
//   2. مرتجعات مبيعات مرتبطة بفواتيره → دائن
//   3. سندات قبض لزبائن المندوب → دائن
// ══════════════════════════════════════════════════════════
const getMandobStatement = async (req, res) => {
  const { id_Mandob, from, to } = req.query;
  if (!id_Mandob)
    return res.status(400).json({ success: false, message: "id_Mandob مطلوب" });

  const { dateFrom, dateTo } = resolveDates(from, to);

  try {
    let party;
    try {
      party = await db.queryOne(
        `SELECT MandobName AS name, COALESCE(Mobile, '') AS mobile
         FROM Mandob_tbl WHERE id_Mandob = ?`,
        [id_Mandob]
      );
    } catch {
      party = await db.queryOne(
        `SELECT MandobName AS name, '' AS mobile FROM Mandob_tbl WHERE id_Mandob = ?`,
        [id_Mandob]
      );
    }
    if (!party)
      return res.status(404).json({ success: false, message: "المندوب غير موجود" });

    const sql = `
      -- ① فواتير المبيعات للمندوب
      SELECT
        f.Date_FOUT                                                  AS txDate,
        ${TX_DT("FOUT_tbl", "f.id_NoFOUT", "f.Date_FOUT")}           AS txDateTime,
        'فاتورة بيع'                                                 AS txType,
        pt.PayTypeName                                               AS txSubType,
        f.id_NoFOUT                                                  AS txRef,
        CASE WHEN ${DEFERRED_PAY_SQL} THEN ${SALE_INVOICE_AMT} ELSE 0 END AS debit,
        0                                                            AS credit,
        CASE WHEN NOT ${DEFERRED_PAY_SQL} THEN ${SALE_INVOICE_AMT} ELSE 0 END AS displayDebit,
        CASE WHEN NOT ${DEFERRED_PAY_SQL} THEN ${SALE_INVOICE_AMT} ELSE 0 END AS displayCredit,
        TRIM(COALESCE(f.Note_FOUT, '') ||
          CASE WHEN z.ZabonName IS NOT NULL THEN ' | زبون: ' || z.ZabonName ELSE '' END) AS txNote
      FROM FOUT_tbl f
      LEFT JOIN PayType_Tbl pt ON pt.id_PayType = f.id_PayType_FOUT
      LEFT JOIN Zabon_tbl z ON z.id_Zabon = f.id_Zabon
      WHERE f.id_Mandob = ? AND f.Date_FOUT BETWEEN ? AND ?

      UNION ALL

      -- ② مرتجعات مبيعات مرتبطة بفواتير المندوب
      SELECT
        r.Date_FRetern                                               AS txDate,
        ${TX_DT("FRetern_tbl", "r.id_NoFRetern", "r.Date_FRetern")} AS txDateTime,
        'مرتجع مبيعات'                                              AS txType,
        ''                                                           AS txSubType,
        r.id_NoFRetern                                               AS txRef,
        0                                                            AS debit,
        ROUND(COALESCE((
          SELECT SUM(d.AmountOUT * d.PriceOUT)
          FROM DetailsRetern_tbl d WHERE d.id_NoFRetern = r.id_NoFRetern
        ), 0), 0)                                                    AS credit,
        0                                                            AS displayDebit,
        0                                                            AS displayCredit,
        CASE WHEN z.ZabonName IS NOT NULL THEN 'زبون: ' || z.ZabonName ELSE '' END AS txNote
      FROM FRetern_tbl r
      LEFT JOIN Zabon_tbl z ON z.id_Zabon = r.id_Party
      WHERE r.ReturnType = 'CUSTOMER'
        AND r.id_Party IN (
          SELECT DISTINCT f.id_Zabon FROM FOUT_tbl f
          WHERE f.id_Mandob = ? AND f.id_Zabon IS NOT NULL
        )
        AND r.Date_FRetern BETWEEN ? AND ?

      UNION ALL

      -- ③ سندات قبض لزبائن المندوب
      SELECT
        c.Date_CatchDoc                                              AS txDate,
        ${TX_DT("CatchDoc_tbl", "c.id_CatchDoc", "c.Date_CatchDoc")} AS txDateTime,
        'سند قبض'                                                    AS txType,
        ''                                                           AS txSubType,
        c.id_CatchDoc                                                AS txRef,
        0                                                            AS debit,
        c.Amount_CatchDoc                                            AS credit,
        0                                                            AS displayDebit,
        0                                                            AS displayCredit,
        TRIM(COALESCE(c.Note_CatchDoc, '') ||
          CASE WHEN z.ZabonName IS NOT NULL THEN ' | زبون: ' || z.ZabonName ELSE '' END) AS txNote
      FROM CatchDoc_tbl c
      LEFT JOIN Zabon_tbl z ON z.id_Zabon = c.id_Zabon
      WHERE c.id_Zabon IN (
          SELECT DISTINCT f.id_Zabon FROM FOUT_tbl f
          WHERE f.id_Mandob = ? AND f.id_Zabon IS NOT NULL
        )
        AND c.Date_CatchDoc BETWEEN ? AND ?

      ORDER BY txDate ASC, txRef ASC
    `;

    const params = [
      id_Mandob, dateFrom, dateTo,   // ①
      id_Mandob, dateFrom, dateTo,   // ②
      id_Mandob, dateFrom, dateTo,   // ③
    ];

    const rows = sortStatementRows(
      expandCashStatementRows(await db.query(sql, params), "customer")
    );

    let balance = 0;
    const data = rows.map((r) => {
      balance = r2(balance + r.debit - r.credit);
      return {
        ...r,
        debit: r2(r.debit),
        credit: r2(r.credit),
        displayDebit: r2(r.displayDebit || 0),
        displayCredit: r2(r.displayCredit || 0),
        invoiceAmount: r2(r.invoiceAmount || 0),
        balance,
      };
    });

    const totalDebit  = r2(data.reduce((s, r) => s + r.debit,  0));
    const totalCredit = r2(data.reduce((s, r) => s + r.credit, 0));

    res.json({
      success    : true,
      party      : { ...party, id: id_Mandob },
      dateFrom,
      dateTo,
      data,
      totals     : { totalDebit, totalCredit, finalBalance: r2(totalDebit - totalCredit) },
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ══════════════════════════════════════════════════════════
//  إرسال كشف الحساب PDF عبر واتساب (زبون / مورد)
//  POST body: { phone, pdfBase64, filename?, caption? }
// ══════════════════════════════════════════════════════════
const sendStatementWhatsApp = async (req, res) => {
  const { phone, message, caption } = req.body;

  if (!phone) {
    return res.status(400).json({ success: false, message: "رقم الهاتف مطلوب" });
  }

  // نص فقط — إرسال PDF عبر Puppeteer كان يعلّق الطلب ويُسقط السيرفر على أجهزة العملاء
  const text = String(message || caption || "").trim();
  if (!text) {
    return res.status(400).json({ success: false, message: "نص كشف الحساب مطلوب" });
  }

  try {
    const result = await sendWhatsApp(phone, text);
    if (!res.headersSent) res.json({ success: true, ...result });
  } catch (e) {
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: e.message || "فشل إرسال واتساب" });
    }
  }
};

// ══════════════════════════════════════════════════════════
//  كشف حركة صندوق — قبض (داخل) ودفع (خارج)
//  GET /api/statements/cash-box?id_CashBox=&from=&to=
// ══════════════════════════════════════════════════════════
const getCashBoxStatement = async (req, res) => {
  const { id_CashBox, from, to } = req.query;
  if (!id_CashBox)
    return res.status(400).json({ success: false, message: "id_CashBox مطلوب" });

  const dateFrom = from || `${new Date().getFullYear()}-01-01`;
  const dateTo   = to   || new Date().toISOString().split("T")[0];

  try {
    const box = await db.queryOne(
      `SELECT id_CashBox, CashBoxName FROM CashBox_tbl WHERE id_CashBox = ?`,
      [id_CashBox]
    );
    if (!box)
      return res.status(404).json({ success: false, message: "الصندوق غير موجود" });

    const rows = await db.query(`
      SELECT
        c.Date_CatchDoc                                              AS txDate,
        'سند قبض'                                                    AS txType,
        c.id_CatchDoc                                                AS txRef,
        COALESCE(z.ZabonName, '')                                    AS party,
        0                                                            AS debit,
        c.Amount_CatchDoc                                            AS credit,
        COALESCE(c.Note_CatchDoc, '')                                AS txNote,
        0                                                            AS displayDebit,
        0                                                            AS displayCredit
      FROM CatchDoc_tbl c
      LEFT JOIN Zabon_tbl z ON z.id_Zabon = c.id_Zabon
      WHERE c.id_CashBox = ? AND c.Date_CatchDoc BETWEEN ? AND ?

      UNION ALL

      SELECT
        c.Date_CatchDoc,
        'سماح',
        c.id_CatchDoc,
        COALESCE(z.ZabonName, ''),
        0,
        0,
        'سماح — سند قبض #' || c.id_CatchDoc,
        0,
        COALESCE(c.AllowanceAmount, 0)
      FROM CatchDoc_tbl c
      LEFT JOIN Zabon_tbl z ON z.id_Zabon = c.id_Zabon
      WHERE c.id_CashBox = ? AND c.Date_CatchDoc BETWEEN ? AND ?
        AND COALESCE(c.AllowanceAmount, 0) > 0

      UNION ALL

      SELECT
        p.Date_PayDoc,
        'سند دفع',
        p.id_PayDoc,
        COALESCE(a.AmilName, ''),
        p.Amount_PayDoc,
        0,
        COALESCE(p.Note_PayDoc, ''),
        0,
        0
      FROM PayDoc_tbl p
      LEFT JOIN Amil_tbl a ON a.id_Amil = p.id_Amil
      WHERE p.id_CashBox = ? AND p.Date_PayDoc BETWEEN ? AND ?

      ORDER BY txDate ASC, txRef ASC
    `, [
      id_CashBox, dateFrom, dateTo,
      id_CashBox, dateFrom, dateTo,
      id_CashBox, dateFrom, dateTo,
    ]);

    let balance = 0;
    const data = rows.map((r) => {
      balance = r2(balance + (+r.credit || 0) - (+r.debit || 0));
      return { ...r, balance };
    });

    const totalCredit = r2(data.reduce((s, r) => s + (+r.credit || 0), 0));
    const totalDebit  = r2(data.reduce((s, r) => s + (+r.debit || 0), 0));
    const totalAllowance = r2(
      data.filter((r) => r.txType === "سماح").reduce((s, r) => s + (+r.displayCredit || 0), 0)
    );

    res.json({
      success: true,
      party: { id: box.id_CashBox, name: box.CashBoxName },
      dateFrom,
      dateTo,
      data,
      totals: {
        totalDebit,
        totalCredit,
        totalAllowance,
        finalBalance: balance,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

module.exports = {
  getCustomersList,
  getSuppliersList,
  getMandobsList,
  getCustomerStatement,
  getSupplierStatement,
  getMandobStatement,
  getCashBoxStatement,
  sendStatementWhatsApp,
};
