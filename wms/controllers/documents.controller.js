// ============================================================
//  controllers/documents.controller.js
//  نظام سندات القبض والدفع + محرك الطباعة
//
//  ┌──────────────────────────────────────────────────────┐
//  │  CatchDoc  (سند قبض من زبون)                        │
//  │   • يُسجَّل في CatchDoc_tbl                         │
//  │   • يُدرج قيد سالب في DionZabon_tbl (خصم الدين)    │
//  │   • printData: إشعار دائن (Credit Note)              │
//  ├──────────────────────────────────────────────────────┤
//  │  PayDoc    (سند دفع لمورد)                           │
//  │   • يُسجَّل في PayDoc_tbl                           │
//  │   • يُدرج قيد سالب في DionAmil_tbl (خصم ديننا)    │
//  │   • printData: إشعار مدين (Debit Note)               │
//  └──────────────────────────────────────────────────────┘
//
//  كل سند يرجع كائن printData كامل يحتوي:
//   • معلومات الشركة (CompanyInformation_tbl)
//   • تفاصيل السند + المبلغ نصاً (كتابةً)
//   • رصيد الطرف قبل وبعد السند
//   • حقول التوقيعات
// ============================================================
const db = require("../db");
const { DEFERRED_PAY_SQL, SALE_INVOICE_AMT, PURCHASE_INVOICE_AMT } = require("../utils/statementPayType");

const r2 = (n) => Math.round((+n || 0) * 100) / 100;

// ──────────────────────────────────────────────────────────
//  helper — AuditLog
// ──────────────────────────────────────────────────────────
async function audit(user, table, recordId, field, oldVal, newVal, notes = "") {
  try {
    await db.run(
      `INSERT INTO AuditLog_tbl
         (id_User, UserName, TableName, RecordID, FieldName, OldValue, NewValue, Notes, ChangeDate, ChangeTime)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, date('now'), time('now'))`,
      [user?.id_User || 0, user?.UserName || "System",
       table, recordId, field,
       String(oldVal ?? ""), String(newVal ?? ""), notes]
    );
  } catch { /* لا نوقف العملية */ }
}

// ──────────────────────────────────────────────────────────
//  helper — تحويل الرقم إلى كلمات (عربي)
// ──────────────────────────────────────────────────────────
function numberToArabicWords(num) {
  const ones  = ["", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة",
                 "عشرة", "أحد عشر", "اثنا عشر", "ثلاثة عشر", "أربعة عشر", "خمسة عشر",
                 "ستة عشر", "سبعة عشر", "ثمانية عشر", "تسعة عشر"];
  const tens  = ["", "", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];
  const scale = ["", "ألف", "مليون", "مليار"];

  if (num === 0) return "صفر";
  if (num < 0)   return "سالب " + numberToArabicWords(-num);

  const integer = Math.floor(num);
  const decimal = Math.round((num - integer) * 100);

  function convert(n) {
    if (n === 0) return "";
    if (n < 20)  return ones[n];
    if (n < 100) {
      const t = Math.floor(n / 10), o = n % 10;
      return o > 0 ? ones[o] + " و" + tens[t] : tens[t];
    }
    const h = Math.floor(n / 100), r = n % 100;
    const hundreds = h === 1 ? "مئة" : h === 2 ? "مئتان" : ones[h] + " مئة";
    return r > 0 ? hundreds + " و" + convert(r) : hundreds;
  }

  let result = "";
  let n = integer;
  const parts = [];
  for (let i = 0; n > 0; i++) {
    const chunk = n % 1000;
    if (chunk !== 0) {
      const word = convert(chunk);
      parts.unshift(i === 0 ? word : word + " " + scale[i]);
    }
    n = Math.floor(n / 1000);
  }
  result = parts.join(" و");
  if (decimal > 0) result += ` و${convert(decimal)} فلساً`;
  return result + " فقط لا غير";
}

// ──────────────────────────────────────────────────────────
//  helper — معلومات الشركة (تُجلب مرة واحدة لكل طلب)
// ──────────────────────────────────────────────────────────
async function getCompanyInfo() {
  const co = await db.queryOne(`SELECT * FROM CompanyInformation_tbl LIMIT 1`);
  return co || {
    CompanyInformation_Name   : "اسم الشركة",
    CompanyInformation_Mobile : "",
    CompanyInformation_Info1  : "",
    CompanyInformation_Info2  : "",
    CompanyInformation_Adress : "",
  };
}

// ──────────────────────────────────────────────────────────
//  helper — رصيد الزبون
//  إجمالي الديون (بدون تسويات السندات) − المقبوض − السماح
//  يشمل المدفوع من الفواتير الآجلة (دفعة على فاتورة...)
// ──────────────────────────────────────────────────────────
async function getZabonBalance(id_Zabon) {
  const [debtRow, catchRow, allowanceRow] = await Promise.all([
    db.queryOne(
      `SELECT COALESCE(SUM(Amount_DionZabon), 0) AS t
       FROM DionZabon_tbl
       WHERE id_Zabon = ?
         AND Note_DionZabon NOT LIKE 'تسوية سند قبض رقم%'
         AND Note_DionZabon NOT LIKE 'سماح سند قبض رقم%'`,
      [id_Zabon]
    ),
    db.queryOne(
      `SELECT COALESCE(SUM(Amount_CatchDoc), 0) AS t
       FROM CatchDoc_tbl WHERE id_Zabon = ?`,
      [id_Zabon]
    ),
    db.queryOne(
      `SELECT COALESCE(SUM(AllowanceAmount), 0) AS t
       FROM CatchDoc_tbl WHERE id_Zabon = ?`,
      [id_Zabon]
    ),
  ]);
  const totalDebt      = r2(debtRow?.t || 0);
  const totalCollected = r2(catchRow?.t || 0);
  const totalAllowance = r2(allowanceRow?.t || 0);
  return {
    totalDebt,
    totalCollected,
    totalAllowance,
    netBalance: r2(totalDebt - totalCollected - totalAllowance),
  };
}

// ──────────────────────────────────────────────────────────
//  helper — رصيد المورد
//  إجمالي الديون (بدون تسويات السندات) − المدفوع
//  يشمل المدفوع من فواتير المشتريات الآجلة (دفعة على فاتورة...)
// ──────────────────────────────────────────────────────────
async function getAmilBalance(id_Amil) {
  const [debtRow, payRow] = await Promise.all([
    db.queryOne(
      `SELECT COALESCE(SUM(Amount_DionAmil), 0) AS t
       FROM DionAmil_tbl
       WHERE id_Amil = ?
         AND Note_DionAmil NOT LIKE 'تسوية سند دفع رقم%'`,
      [id_Amil]
    ),
    db.queryOne(
      `SELECT COALESCE(SUM(Amount_PayDoc), 0) AS t
       FROM PayDoc_tbl WHERE id_Amil = ?`,
      [id_Amil]
    ),
  ]);
  const totalDebt = r2(debtRow?.t || 0);
  const totalPaid = r2(payRow?.t || 0);
  return { totalDebt, totalPaid, netBalance: r2(totalDebt - totalPaid) };
}

// ──────────────────────────────────────────────────────────
//  helper — بناء كائن printData
// ──────────────────────────────────────────────────────────
function buildPrintData({
  docType,       // "RECEIPT" | "PAYMENT"
  docNumber,     // رقم السند
  docDate,       // التاريخ
  amount,        // المبلغ
  notes,         // الملاحظات
  partyName,     // اسم الزبون أو المورد
  partyType,     // "زبون" | "مورد"
  balanceBefore, // الرصيد قبل
  balanceAfter,  // الرصيد بعد
  company,       // معلومات الشركة
}) {
  return {
    // ── معلومات الشركة ─────────────────────────────────
    company: {
      name    : company.CompanyInformation_Name,
      mobile  : company.CompanyInformation_Mobile,
      address : company.CompanyInformation_Adress,
      info1   : company.CompanyInformation_Info1,
      info2   : company.CompanyInformation_Info2,
    },

    // ── بيانات السند ───────────────────────────────────
    document: {
      type        : docType,
      typeLabel   : docType === "RECEIPT" ? "سند قبض" : "سند دفع",
      noteType    : docType === "RECEIPT" ? "إشعار دائن (Credit Note)" : "إشعار مدين (Debit Note)",
      number      : docNumber,
      date        : docDate,
      partyType,
      partyName,
      amount,
      amountInWords: numberToArabicWords(amount),
      notes,
    },

    // ── الرصيد ─────────────────────────────────────────
    balance: {
      before : Math.round(balanceBefore * 100) / 100,
      payment: Math.round(amount        * 100) / 100,
      after  : Math.round(balanceAfter  * 100) / 100,
      label  : balanceAfter > 0
        ? `متبقي على ${partyType}: ${Math.round(balanceAfter * 100) / 100}`
        : balanceAfter < 0
          ? `رصيد دائن: ${Math.round(Math.abs(balanceAfter) * 100) / 100}`
          : "تم تسوية الحساب بالكامل ✓",
    },

    // ── حقول التوقيع ───────────────────────────────────
    signatures: {
      receiver   : { label: "المستلم",   value: "" },
      accountant : { label: "المحاسب",   value: "" },
      manager    : { label: "المدير",    value: "" },
      party      : { label: partyType,   value: "" },
    },

    // ── معلومات الطباعة ─────────────────────────────────
    printMeta: {
      generatedAt : new Date().toISOString(),
      printedBy   : "",   // تُملأ من الواجهة
    },
  };
}

// ══════════════════════════════════════════════════════════
//  ══════════════  CATCH DOC — سندات القبض  ══════════════
// ══════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────────
//  CATCH: GET ALL
//  ?id_Zabon= &from= &to= &page= &limit=
// ──────────────────────────────────────────────────────────
const getAllCatch = async (req, res) => {
  try {
    const { id_Zabon, from, to, page = 1, limit = 50 } = req.query;
    let sql = `
      SELECT
        c.*,
        z.ZabonName,
        zl.Location_ZabonLocation,
        -- رصيد الزبون الحالي = ديون − مقبوض − سماح (يشمل المدفوع من الفواتير)
        COALESCE((
          SELECT SUM(Amount_DionZabon) FROM DionZabon_tbl
          WHERE id_Zabon = z.id_Zabon
            AND Note_DionZabon NOT LIKE 'تسوية سند قبض رقم%'
            AND Note_DionZabon NOT LIKE 'سماح سند قبض رقم%'
        ), 0)
        - COALESCE((SELECT SUM(Amount_CatchDoc) FROM CatchDoc_tbl WHERE id_Zabon = z.id_Zabon), 0)
        - COALESCE((SELECT SUM(AllowanceAmount) FROM CatchDoc_tbl WHERE id_Zabon = z.id_Zabon), 0)
          AS CurrentBalance
      FROM CatchDoc_tbl c
      LEFT JOIN Zabon_tbl      z  ON z.id_Zabon         = c.id_Zabon
      LEFT JOIN Zabon_Location zl ON zl.id_ZabonLocation = z.id_ZabonLocation
      WHERE 1=1`;
    const p = [];
    if (id_Zabon) { sql += " AND c.id_Zabon = ?";       p.push(id_Zabon); }
    if (from)     { sql += " AND c.Date_CatchDoc >= ?";  p.push(from); }
    if (to)       { sql += " AND c.Date_CatchDoc <= ?";  p.push(to); }
    sql += " ORDER BY c.Date_CatchDoc DESC, c.id_CatchDoc DESC";

    const countRow = await db.queryOne(
      `SELECT COUNT(*) AS total FROM CatchDoc_tbl c WHERE 1=1
       ${id_Zabon ? " AND c.id_Zabon = " + id_Zabon : ""}
       ${from     ? " AND c.Date_CatchDoc >= '" + from + "'" : ""}
       ${to       ? " AND c.Date_CatchDoc <= '" + to   + "'" : ""}`
    );
    const offset = (Number(page) - 1) * Number(limit);
    sql += " LIMIT ? OFFSET ?";
    p.push(Number(limit), offset);

    const rows = await db.query(sql, p);
    res.json({
      success    : true,
      count      : rows.length,
      total      : countRow.total,
      page       : Number(page),
      totalPages : Math.ceil(countRow.total / Number(limit)),
      data       : rows,
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ──────────────────────────────────────────────────────────
//  CATCH: GET ONE
// ──────────────────────────────────────────────────────────
const getOneCatch = async (req, res) => {
  try {
    const row = await db.queryOne(
      `SELECT c.*, z.ZabonName, zl.Location_ZabonLocation
       FROM CatchDoc_tbl c
       LEFT JOIN Zabon_tbl      z  ON z.id_Zabon          = c.id_Zabon
       LEFT JOIN Zabon_Location zl ON zl.id_ZabonLocation = z.id_ZabonLocation
       WHERE c.id_CatchDoc = ?`,
      [req.params.id]
    );
    if (!row) return res.status(404).json({ success: false, message: "السند غير موجود" });
    res.json({ success: true, data: row });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ──────────────────────────────────────────────────────────
//  CATCH: CREATE
//  Body: { id_Zabon, Amount_CatchDoc, Date_CatchDoc, Note_CatchDoc }
// ──────────────────────────────────────────────────────────
const createCatch = async (req, res) => {
  const {
    id_Zabon,
    Amount_CatchDoc,
    AllowanceAmount = 0,
    Date_CatchDoc  = null,
    Note_CatchDoc  = "",
    id_CashBox     = null,
  } = req.body;

  if (!id_Zabon)       return res.status(400).json({ success: false, message: "id_Zabon مطلوب" });
  if (!Amount_CatchDoc || Number(Amount_CatchDoc) <= 0)
    return res.status(400).json({ success: false, message: "المبلغ يجب أن يكون أكبر من صفر" });
  const allowance = Math.max(0, Number(AllowanceAmount) || 0);

  const zabon = await db.queryOne(`SELECT * FROM Zabon_tbl WHERE id_Zabon = ?`, [id_Zabon]);
  if (!zabon) return res.status(400).json({ success: false, message: `الزبون id=${id_Zabon} غير موجود` });

  const today   = new Date().toISOString().split("T")[0];
  const docDate = Date_CatchDoc || today;
  const amount  = Number(Amount_CatchDoc);

  try {
    await db.run("BEGIN TRANSACTION");

    // الرصيد قبل
    const balBefore = await getZabonBalance(id_Zabon);

    // 1️⃣  تسجيل سند القبض
    const r = await db.run(
      `INSERT INTO CatchDoc_tbl (Amount_CatchDoc, AllowanceAmount, Date_CatchDoc, Note_CatchDoc, id_Zabon, id_CashBox)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [amount, allowance, docDate, Note_CatchDoc || `سند قبض - ${zabon.ZabonName}`, id_Zabon, id_CashBox || null]
    );
    const docId = r.lastID;

    // 2️⃣  قيد خصم تلقائي في DionZabon_tbl (قيمة سالبة = تقليل الدين)
    await db.run(
      `INSERT INTO DionZabon_tbl (Amount_DionZabon, Date_DionZabon, Note_DionZabon, id_Zabon)
       VALUES (?, ?, ?, ?)`,
      [-amount, docDate, `تسوية سند قبض رقم ${docId}`, id_Zabon]
    );

    if (allowance > 0) {
      await db.run(
        `INSERT INTO DionZabon_tbl (Amount_DionZabon, Date_DionZabon, Note_DionZabon, id_Zabon)
         VALUES (?, ?, ?, ?)`,
        [-allowance, docDate, `سماح سند قبض رقم ${docId}`, id_Zabon]
      );
    }

    // الرصيد بعد
    const balAfter = await getZabonBalance(id_Zabon);

    await audit(
      req.user, "CatchDoc_tbl", docId, "CREATE",
      balBefore.netBalance, balAfter.netBalance,
      `سند قبض | ${zabon.ZabonName} | ${amount}`
    );

    await db.run("COMMIT");

    // 3️⃣  بناء printData
    const company   = await getCompanyInfo();
    const printData = buildPrintData({
      docType      : "RECEIPT",
      docNumber    : docId,
      docDate,
      amount,
      notes        : Note_CatchDoc,
      partyName    : zabon.ZabonName,
      partyType    : "زبون",
      balanceBefore: balBefore.netBalance,
      balanceAfter : balAfter.netBalance,
      company,
    });

    res.status(201).json({
      success   : true,
      message   : "تم إنشاء سند القبض بنجاح",
      docId,
      printData,
    });
  } catch (e) {
    await db.run("ROLLBACK").catch(() => {});
    res.status(500).json({ success: false, message: e.message });
  }
};

// ──────────────────────────────────────────────────────────
//  CATCH: UPDATE — يحافظ على Date_CatchDoc الأصلي
// ──────────────────────────────────────────────────────────
const updateCatch = async (req, res) => {
  const docId = req.params.id;
  const {
    id_Zabon,
    Amount_CatchDoc,
    AllowanceAmount = 0,
    Note_CatchDoc = "",
    id_CashBox = null,
  } = req.body;

  if (!Amount_CatchDoc || Number(Amount_CatchDoc) <= 0)
    return res.status(400).json({ success: false, message: "المبلغ يجب أن يكون أكبر من صفر" });

  const doc = await db.queryOne(
    `SELECT c.*, z.ZabonName FROM CatchDoc_tbl c
     LEFT JOIN Zabon_tbl z ON z.id_Zabon = c.id_Zabon
     WHERE c.id_CatchDoc = ?`,
    [docId]
  );
  if (!doc) return res.status(404).json({ success: false, message: "السند غير موجود" });

  const newZabon    = id_Zabon ? Number(id_Zabon) : doc.id_Zabon;
  const newAmount   = Number(Amount_CatchDoc);
  const newAllowance = Math.max(0, Number(AllowanceAmount) || 0);
  const origDate    = doc.Date_CatchDoc;
  const settlementNote = `تسوية سند قبض رقم ${docId}`;
  const allowanceNote  = `سماح سند قبض رقم ${docId}`;

  const zabon = await db.queryOne(`SELECT * FROM Zabon_tbl WHERE id_Zabon = ?`, [newZabon]);
  if (!zabon) return res.status(400).json({ success: false, message: `الزبون id=${newZabon} غير موجود` });

  try {
    await db.run("BEGIN TRANSACTION");

    const balBefore = await getZabonBalance(doc.id_Zabon);

    if (newZabon !== doc.id_Zabon) {
      await db.run(
        `DELETE FROM DionZabon_tbl WHERE id_Zabon = ? AND Note_DionZabon IN (?, ?)`,
        [doc.id_Zabon, settlementNote, allowanceNote]
      );
      await db.run(
        `INSERT INTO DionZabon_tbl (Amount_DionZabon, Date_DionZabon, Note_DionZabon, id_Zabon)
         VALUES (?, ?, ?, ?)`,
        [-newAmount, origDate, settlementNote, newZabon]
      );
      if (newAllowance > 0) {
        await db.run(
          `INSERT INTO DionZabon_tbl (Amount_DionZabon, Date_DionZabon, Note_DionZabon, id_Zabon)
           VALUES (?, ?, ?, ?)`,
          [-newAllowance, origDate, allowanceNote, newZabon]
        );
      }
    } else {
      await db.run(
        `UPDATE DionZabon_tbl SET Amount_DionZabon = ?, Date_DionZabon = ?
         WHERE id_Zabon = ? AND Note_DionZabon = ?`,
        [-newAmount, origDate, doc.id_Zabon, settlementNote]
      );
      const allowanceRow = await db.queryOne(
        `SELECT id_DionZabon FROM DionZabon_tbl WHERE id_Zabon = ? AND Note_DionZabon = ?`,
        [doc.id_Zabon, allowanceNote]
      );
      if (newAllowance > 0) {
        if (allowanceRow) {
          await db.run(
            `UPDATE DionZabon_tbl SET Amount_DionZabon = ?, Date_DionZabon = ? WHERE id_DionZabon = ?`,
            [-newAllowance, origDate, allowanceRow.id_DionZabon]
          );
        } else {
          await db.run(
            `INSERT INTO DionZabon_tbl (Amount_DionZabon, Date_DionZabon, Note_DionZabon, id_Zabon)
             VALUES (?, ?, ?, ?)`,
            [-newAllowance, origDate, allowanceNote, doc.id_Zabon]
          );
        }
      } else if (allowanceRow) {
        await db.run(`DELETE FROM DionZabon_tbl WHERE id_DionZabon = ?`, [allowanceRow.id_DionZabon]);
      }
    }

    await db.run(
      `UPDATE CatchDoc_tbl
       SET Amount_CatchDoc = ?, AllowanceAmount = ?, Note_CatchDoc = ?, id_Zabon = ?, id_CashBox = ?
       WHERE id_CatchDoc = ?`,
      [
        newAmount,
        newAllowance,
        Note_CatchDoc || `سند قبض - ${zabon.ZabonName}`,
        newZabon,
        id_CashBox || null,
        docId,
      ]
    );

    const balAfter = await getZabonBalance(newZabon);

    await audit(
      req.user, "CatchDoc_tbl", docId, "UPDATE",
      doc.Amount_CatchDoc, newAmount,
      `تعديل سند قبض | ${zabon.ZabonName} | التاريخ ثابت: ${origDate}`
    );

    await db.run("COMMIT");

    const company   = await getCompanyInfo();
    const printData = buildPrintData({
      docType      : "RECEIPT",
      docNumber    : Number(docId),
      docDate      : origDate,
      amount       : newAmount,
      notes        : Note_CatchDoc,
      partyName    : zabon.ZabonName,
      partyType    : "زبون",
      balanceBefore: balBefore.netBalance,
      balanceAfter : balAfter.netBalance,
      company,
    });

    res.json({ success: true, message: "تم تعديل سند القبض بنجاح", docId: Number(docId), printData });
  } catch (e) {
    await db.run("ROLLBACK").catch(() => {});
    res.status(500).json({ success: false, message: e.message });
  }
};

// ──────────────────────────────────────────────────────────
//  CATCH: DELETE (عكس التأثير المالي)
// ──────────────────────────────────────────────────────────
const removeCatch = async (req, res) => {
  try {
    const doc = await db.queryOne(
      `SELECT c.*, z.ZabonName FROM CatchDoc_tbl c
       LEFT JOIN Zabon_tbl z ON z.id_Zabon = c.id_Zabon
       WHERE c.id_CatchDoc = ?`, [req.params.id]
    );
    if (!doc) return res.status(404).json({ success: false, message: "السند غير موجود" });

    await db.run("BEGIN TRANSACTION");

    // حذف القيود التلقائية من DionZabon_tbl
    await db.run(
      `DELETE FROM DionZabon_tbl WHERE id_Zabon = ? AND Note_DionZabon = ?`,
      [doc.id_Zabon, `تسوية سند قبض رقم ${req.params.id}`]
    );
    await db.run(
      `DELETE FROM DionZabon_tbl WHERE id_Zabon = ? AND Note_DionZabon = ?`,
      [doc.id_Zabon, `سماح سند قبض رقم ${req.params.id}`]
    );

    await db.run(`DELETE FROM CatchDoc_tbl WHERE id_CatchDoc = ?`, [req.params.id]);

    await audit(
      req.user, "CatchDoc_tbl", req.params.id, "DELETE",
      doc.Amount_CatchDoc, null,
      `حذف سند قبض | ${doc.ZabonName} | تم عكس الأثر المالي`
    );

    await db.run("COMMIT");

    res.json({
      success  : true,
      message  : `تم حذف سند القبض #${req.params.id} وعكس الأثر المالي`,
      reversed : { debtEntry: true, amount: doc.Amount_CatchDoc },
    });
  } catch (e) {
    await db.run("ROLLBACK").catch(() => {});
    res.status(500).json({ success: false, message: e.message });
  }
};

// ══════════════════════════════════════════════════════════
//  ═══════════════  PAY DOC — سندات الدفع  ════════════════
// ══════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────────
//  PAY: GET ALL
// ──────────────────────────────────────────────────────────
const getAllPay = async (req, res) => {
  try {
    const { id_Amil, from, to, page = 1, limit = 50 } = req.query;
    let sql = `
      SELECT
        p.*,
        a.AmilName,
        COALESCE((
          SELECT SUM(Amount_DionAmil) FROM DionAmil_tbl
          WHERE id_Amil = a.id_Amil
            AND Note_DionAmil NOT LIKE 'تسوية سند دفع رقم%'
        ), 0)
        - COALESCE((SELECT SUM(Amount_PayDoc) FROM PayDoc_tbl WHERE id_Amil = a.id_Amil), 0)
          AS CurrentBalance
      FROM PayDoc_tbl p
      LEFT JOIN Amil_tbl a ON a.id_Amil = p.id_Amil
      WHERE 1=1`;
    const q = [];
    if (id_Amil) { sql += " AND p.id_Amil = ?";       q.push(id_Amil); }
    if (from)    { sql += " AND p.Date_PayDoc >= ?";   q.push(from); }
    if (to)      { sql += " AND p.Date_PayDoc <= ?";   q.push(to); }
    sql += " ORDER BY p.Date_PayDoc DESC, p.id_PayDoc DESC";

    const countRow = await db.queryOne(
      `SELECT COUNT(*) AS total FROM PayDoc_tbl p WHERE 1=1
       ${id_Amil ? " AND p.id_Amil = " + id_Amil : ""}
       ${from    ? " AND p.Date_PayDoc >= '" + from + "'" : ""}
       ${to      ? " AND p.Date_PayDoc <= '" + to   + "'" : ""}`
    );
    const offset = (Number(page) - 1) * Number(limit);
    sql += " LIMIT ? OFFSET ?";
    q.push(Number(limit), offset);

    const rows = await db.query(sql, q);
    res.json({
      success    : true,
      count      : rows.length,
      total      : countRow.total,
      page       : Number(page),
      totalPages : Math.ceil(countRow.total / Number(limit)),
      data       : rows,
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ──────────────────────────────────────────────────────────
//  PAY: GET ONE
// ──────────────────────────────────────────────────────────
const getOnePay = async (req, res) => {
  try {
    const row = await db.queryOne(
      `SELECT p.*, a.AmilName, a.Adress, a.Mobil
       FROM PayDoc_tbl p
       LEFT JOIN Amil_tbl a ON a.id_Amil = p.id_Amil
       WHERE p.id_PayDoc = ?`, [req.params.id]
    );
    if (!row) return res.status(404).json({ success: false, message: "السند غير موجود" });
    res.json({ success: true, data: row });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ──────────────────────────────────────────────────────────
//  PAY: CREATE
//  Body: { id_Amil, Amount_PayDoc, Date_PayDoc, Note_PayDoc }
// ──────────────────────────────────────────────────────────
const createPay = async (req, res) => {
  const {
    id_Amil,
    Amount_PayDoc,
    Date_PayDoc  = null,
    Note_PayDoc  = "",
    id_CashBox   = null,
  } = req.body;

  if (!id_Amil)     return res.status(400).json({ success: false, message: "id_Amil مطلوب" });
  if (!Amount_PayDoc || Number(Amount_PayDoc) <= 0)
    return res.status(400).json({ success: false, message: "المبلغ يجب أن يكون أكبر من صفر" });

  const amil = await db.queryOne(`SELECT * FROM Amil_tbl WHERE id_Amil = ?`, [id_Amil]);
  if (!amil) return res.status(400).json({ success: false, message: `المورد id=${id_Amil} غير موجود` });

  const today   = new Date().toISOString().split("T")[0];
  const docDate = Date_PayDoc || today;
  const amount  = Number(Amount_PayDoc);

  try {
    await db.run("BEGIN TRANSACTION");

    // الرصيد قبل
    const balBefore = await getAmilBalance(id_Amil);

    // 1️⃣  تسجيل سند الدفع
    const r = await db.run(
      `INSERT INTO PayDoc_tbl (Amount_PayDoc, Date_PayDoc, Note_PayDoc, id_Amil, id_CashBox)
       VALUES (?, ?, ?, ?, ?)`,
      [amount, docDate, Note_PayDoc || `سند دفع - ${amil.AmilName}`, id_Amil, id_CashBox || null]
    );
    const docId = r.lastID;

    // 2️⃣  قيد خصم تلقائي في DionAmil_tbl (قيمة سالبة = تقليل ديننا)
    await db.run(
      `INSERT INTO DionAmil_tbl (Amount_DionAmil, Date_DionAmil, Note_DionAmil, id_Amil)
       VALUES (?, ?, ?, ?)`,
      [-amount, docDate, `تسوية سند دفع رقم ${docId}`, id_Amil]
    );

    // الرصيد بعد
    const balAfter = await getAmilBalance(id_Amil);

    await audit(
      req.user, "PayDoc_tbl", docId, "CREATE",
      balBefore.netBalance, balAfter.netBalance,
      `سند دفع | ${amil.AmilName} | ${amount}`
    );

    await db.run("COMMIT");

    // 3️⃣  بناء printData
    const company   = await getCompanyInfo();
    const printData = buildPrintData({
      docType      : "PAYMENT",
      docNumber    : docId,
      docDate,
      amount,
      notes        : Note_PayDoc,
      partyName    : amil.AmilName,
      partyType    : "مورد",
      balanceBefore: balBefore.netBalance,
      balanceAfter : balAfter.netBalance,
      company,
    });

    res.status(201).json({
      success   : true,
      message   : "تم إنشاء سند الدفع بنجاح",
      docId,
      printData,
    });
  } catch (e) {
    await db.run("ROLLBACK").catch(() => {});
    res.status(500).json({ success: false, message: e.message });
  }
};

// ──────────────────────────────────────────────────────────
//  PAY: UPDATE — يحافظ على Date_PayDoc الأصلي
// ──────────────────────────────────────────────────────────
const updatePay = async (req, res) => {
  const docId = req.params.id;
  const {
    id_Amil,
    Amount_PayDoc,
    Note_PayDoc = "",
    id_CashBox = null,
  } = req.body;

  if (!Amount_PayDoc || Number(Amount_PayDoc) <= 0)
    return res.status(400).json({ success: false, message: "المبلغ يجب أن يكون أكبر من صفر" });

  const doc = await db.queryOne(
    `SELECT p.*, a.AmilName FROM PayDoc_tbl p
     LEFT JOIN Amil_tbl a ON a.id_Amil = p.id_Amil
     WHERE p.id_PayDoc = ?`,
    [docId]
  );
  if (!doc) return res.status(404).json({ success: false, message: "السند غير موجود" });

  const newAmil  = id_Amil ? Number(id_Amil) : doc.id_Amil;
  const newAmount = Number(Amount_PayDoc);
  const origDate  = doc.Date_PayDoc;
  const settlementNote = `تسوية سند دفع رقم ${docId}`;

  const amil = await db.queryOne(`SELECT * FROM Amil_tbl WHERE id_Amil = ?`, [newAmil]);
  if (!amil) return res.status(400).json({ success: false, message: `المورد id=${newAmil} غير موجود` });

  try {
    await db.run("BEGIN TRANSACTION");

    const balBefore = await getAmilBalance(doc.id_Amil);

    if (newAmil !== doc.id_Amil) {
      await db.run(
        `DELETE FROM DionAmil_tbl WHERE id_Amil = ? AND Note_DionAmil = ?`,
        [doc.id_Amil, settlementNote]
      );
      await db.run(
        `INSERT INTO DionAmil_tbl (Amount_DionAmil, Date_DionAmil, Note_DionAmil, id_Amil)
         VALUES (?, ?, ?, ?)`,
        [-newAmount, origDate, settlementNote, newAmil]
      );
    } else {
      await db.run(
        `UPDATE DionAmil_tbl SET Amount_DionAmil = ?, Date_DionAmil = ?
         WHERE id_Amil = ? AND Note_DionAmil = ?`,
        [-newAmount, origDate, doc.id_Amil, settlementNote]
      );
    }

    await db.run(
      `UPDATE PayDoc_tbl
       SET Amount_PayDoc = ?, Note_PayDoc = ?, id_Amil = ?, id_CashBox = ?
       WHERE id_PayDoc = ?`,
      [
        newAmount,
        Note_PayDoc || `سند دفع - ${amil.AmilName}`,
        newAmil,
        id_CashBox || null,
        docId,
      ]
    );

    const balAfter = await getAmilBalance(newAmil);

    await audit(
      req.user, "PayDoc_tbl", docId, "UPDATE",
      doc.Amount_PayDoc, newAmount,
      `تعديل سند دفع | ${amil.AmilName} | التاريخ ثابت: ${origDate}`
    );

    await db.run("COMMIT");

    const company   = await getCompanyInfo();
    const printData = buildPrintData({
      docType      : "PAYMENT",
      docNumber    : Number(docId),
      docDate      : origDate,
      amount       : newAmount,
      notes        : Note_PayDoc,
      partyName    : amil.AmilName,
      partyType    : "مورد",
      balanceBefore: balBefore.netBalance,
      balanceAfter : balAfter.netBalance,
      company,
    });

    res.json({ success: true, message: "تم تعديل سند الدفع بنجاح", docId: Number(docId), printData });
  } catch (e) {
    await db.run("ROLLBACK").catch(() => {});
    res.status(500).json({ success: false, message: e.message });
  }
};

// ──────────────────────────────────────────────────────────
//  PAY: DELETE
// ──────────────────────────────────────────────────────────
const removePay = async (req, res) => {
  try {
    const doc = await db.queryOne(
      `SELECT p.*, a.AmilName FROM PayDoc_tbl p
       LEFT JOIN Amil_tbl a ON a.id_Amil = p.id_Amil
       WHERE p.id_PayDoc = ?`, [req.params.id]
    );
    if (!doc) return res.status(404).json({ success: false, message: "السند غير موجود" });

    await db.run("BEGIN TRANSACTION");

    await db.run(
      `DELETE FROM DionAmil_tbl WHERE id_Amil = ? AND Note_DionAmil = ?`,
      [doc.id_Amil, `تسوية سند دفع رقم ${req.params.id}`]
    );
    await db.run(`DELETE FROM PayDoc_tbl WHERE id_PayDoc = ?`, [req.params.id]);

    await audit(
      req.user, "PayDoc_tbl", req.params.id, "DELETE",
      doc.Amount_PayDoc, null,
      `حذف سند دفع | ${doc.AmilName} | تم عكس الأثر المالي`
    );

    await db.run("COMMIT");

    res.json({
      success  : true,
      message  : `تم حذف سند الدفع #${req.params.id} وعكس الأثر المالي`,
      reversed : { debtEntry: true, amount: doc.Amount_PayDoc },
    });
  } catch (e) {
    await db.run("ROLLBACK").catch(() => {});
    res.status(500).json({ success: false, message: e.message });
  }
};

// ══════════════════════════════════════════════════════════
//  PRINT ENGINE  —  جلب بيانات الطباعة لأي سند
//  GET /api/documents/print/:docType/:id
//  docType = catch | pay
// ══════════════════════════════════════════════════════════
const getPrintData = async (req, res) => {
  const { docType, id } = req.params;

  if (!["catch", "pay"].includes(docType))
    return res.status(400).json({
      success: false,
      message: "docType يجب أن يكون catch (قبض) أو pay (دفع)",
    });

  try {
    const company = await getCompanyInfo();
    let printData;

    if (docType === "catch") {
      const doc = await db.queryOne(
        `SELECT c.*, z.ZabonName FROM CatchDoc_tbl c
         LEFT JOIN Zabon_tbl z ON z.id_Zabon = c.id_Zabon
         WHERE c.id_CatchDoc = ?`, [id]
      );
      if (!doc) return res.status(404).json({ success: false, message: "سند القبض غير موجود" });

      const bal = await getZabonBalance(doc.id_Zabon);
      printData  = buildPrintData({
        docType      : "RECEIPT",
        docNumber    : doc.id_CatchDoc,
        docDate      : doc.Date_CatchDoc,
        amount       : doc.Amount_CatchDoc,
        notes        : doc.Note_CatchDoc,
        partyName    : doc.ZabonName,
        partyType    : "زبون",
        balanceBefore: bal.netBalance + doc.Amount_CatchDoc + (+doc.AllowanceAmount || 0),
        balanceAfter : bal.netBalance,
        company,
      });
    } else {
      const doc = await db.queryOne(
        `SELECT p.*, a.AmilName FROM PayDoc_tbl p
         LEFT JOIN Amil_tbl a ON a.id_Amil = p.id_Amil
         WHERE p.id_PayDoc = ?`, [id]
      );
      if (!doc) return res.status(404).json({ success: false, message: "سند الدفع غير موجود" });

      const bal = await getAmilBalance(doc.id_Amil);
      printData  = buildPrintData({
        docType      : "PAYMENT",
        docNumber    : doc.id_PayDoc,
        docDate      : doc.Date_PayDoc,
        amount       : doc.Amount_PayDoc,
        notes        : doc.Note_PayDoc,
        partyName    : doc.AmilName,
        partyType    : "مورد",
        balanceBefore: bal.netBalance + doc.Amount_PayDoc,
        balanceAfter : bal.netBalance,
        company,
      });
    }

    res.json({ success: true, printData });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ══════════════════════════════════════════════════════════
//  NAVIGATE — الملاحة
// ══════════════════════════════════════════════════════════
const navigate = async (req, res) => {
  const { docType, id, direction } = req.params;

  const tableMap = {
    catch : { table: "CatchDoc_tbl", pk: "id_CatchDoc"  },
    pay   : { table: "PayDoc_tbl",   pk: "id_PayDoc"    },
  };
  const meta = tableMap[docType];
  if (!meta)
    return res.status(400).json({ success: false, message: "docType: catch أو pay" });

  try {
    let row;
    if (direction === "prev") {
      row = await db.queryOne(
        `SELECT ${meta.pk} AS id FROM "${meta.table}"
         WHERE ${meta.pk} < ? ORDER BY ${meta.pk} DESC LIMIT 1`, [id]
      );
    } else if (direction === "next") {
      row = await db.queryOne(
        `SELECT ${meta.pk} AS id FROM "${meta.table}"
         WHERE ${meta.pk} > ? ORDER BY ${meta.pk} ASC LIMIT 1`, [id]
      );
    } else {
      return res.status(400).json({ success: false, message: "direction: prev أو next" });
    }

    if (!row)
      return res.status(404).json({
        success   : false,
        message   : direction === "prev" ? "لا يوجد سند سابق" : "لا يوجد سند تالٍ",
        currentId : Number(id),
      });

    // إرجاع السند مع printData
    return getPrintData({ params: { docType, id: row.id } }, res);
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ══════════════════════════════════════════════════════════
//  BOUNDS — أول وآخر سند
// ══════════════════════════════════════════════════════════
const getBounds = async (req, res) => {
  const { docType } = req.params;
  const tableMap = {
    catch : { table: "CatchDoc_tbl", pk: "id_CatchDoc" },
    pay   : { table: "PayDoc_tbl",   pk: "id_PayDoc"   },
  };
  const meta = tableMap[docType];
  if (!meta)
    return res.status(400).json({ success: false, message: "docType: catch أو pay" });

  try {
    const [first, last] = await Promise.all([
      db.queryOne(`SELECT ${meta.pk} AS id FROM "${meta.table}" ORDER BY ${meta.pk} ASC  LIMIT 1`),
      db.queryOne(`SELECT ${meta.pk} AS id FROM "${meta.table}" ORDER BY ${meta.pk} DESC LIMIT 1`),
    ]);
    res.json({ success: true, first: first?.id || null, last: last?.id || null });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// GET /api/documents/cash-flow-summary?from=&to=
// ──────────────────────────────────────────────────────────
//  DIRECT: قبض من زبون + دفع لمورد — عملية واحدة
//  Body: { id_Zabon, id_Amil, Amount_CatchDoc, Date_CatchDoc?, Note_CatchDoc? }
// ──────────────────────────────────────────────────────────
const createDirectCatchPay = async (req, res) => {
  const {
    id_Zabon,
    id_Amil,
    Amount_CatchDoc,
    Date_CatchDoc = null,
    Note_CatchDoc = "",
  } = req.body;

  if (!id_Zabon) return res.status(400).json({ success: false, message: "id_Zabon مطلوب" });
  if (!id_Amil)  return res.status(400).json({ success: false, message: "id_Amil مطلوب" });
  if (!Amount_CatchDoc || Number(Amount_CatchDoc) <= 0)
    return res.status(400).json({ success: false, message: "المبلغ يجب أن يكون أكبر من صفر" });

  const [zabon, amil] = await Promise.all([
    db.queryOne(`SELECT * FROM Zabon_tbl WHERE id_Zabon = ?`, [id_Zabon]),
    db.queryOne(`SELECT * FROM Amil_tbl WHERE id_Amil = ?`, [id_Amil]),
  ]);
  if (!zabon) return res.status(400).json({ success: false, message: `الزبون id=${id_Zabon} غير موجود` });
  if (!amil)  return res.status(400).json({ success: false, message: `المورد id=${id_Amil} غير موجود` });

  const today   = new Date().toISOString().split("T")[0];
  const docDate = Date_CatchDoc || today;
  const amount  = Number(Amount_CatchDoc);
  const note    = (Note_CatchDoc || `${zabon.ZabonName} — ${amil.AmilName} — عملية مباشرة`).trim();

  try {
    await db.run("BEGIN TRANSACTION");

    const zabonBalBefore = await getZabonBalance(id_Zabon);
    const amilBalBefore  = await getAmilBalance(id_Amil);

    const catchR = await db.run(
      `INSERT INTO CatchDoc_tbl (Amount_CatchDoc, Date_CatchDoc, Note_CatchDoc, id_Zabon)
       VALUES (?, ?, ?, ?)`,
      [amount, docDate, note, id_Zabon]
    );
    const catchId = catchR.lastID;

    await db.run(
      `INSERT INTO DionZabon_tbl (Amount_DionZabon, Date_DionZabon, Note_DionZabon, id_Zabon)
       VALUES (?, ?, ?, ?)`,
      [-amount, docDate, `تسوية سند قبض رقم ${catchId}`, id_Zabon]
    );

    const payR = await db.run(
      `INSERT INTO PayDoc_tbl (Amount_PayDoc, Date_PayDoc, Note_PayDoc, id_Amil)
       VALUES (?, ?, ?, ?)`,
      [amount, docDate, note, id_Amil]
    );
    const payId = payR.lastID;

    await db.run(
      `INSERT INTO DionAmil_tbl (Amount_DionAmil, Date_DionAmil, Note_DionAmil, id_Amil)
       VALUES (?, ?, ?, ?)`,
      [-amount, docDate, `تسوية سند دفع رقم ${payId}`, id_Amil]
    );

    const zabonBalAfter = await getZabonBalance(id_Zabon);
    const amilBalAfter  = await getAmilBalance(id_Amil);

    await audit(
      req.user, "CatchDoc_tbl", catchId, "CREATE",
      zabonBalBefore.netBalance, zabonBalAfter.netBalance,
      `قبض ودفع مباشر | زبون: ${zabon.ZabonName} | مورد: ${amil.AmilName} | ${amount}`
    );
    await audit(
      req.user, "PayDoc_tbl", payId, "CREATE",
      amilBalBefore.netBalance, amilBalAfter.netBalance,
      `قبض ودفع مباشر | زبون: ${zabon.ZabonName} | مورد: ${amil.AmilName} | ${amount}`
    );

    await db.run("COMMIT");

    const company = await getCompanyInfo();
    res.status(201).json({
      success: true,
      message: "تم تنفيذ قبض ودفع مباشر بنجاح",
      catchDocId: catchId,
      payDocId: payId,
      amount,
      note,
      zabon: {
        name: zabon.ZabonName,
        balanceBefore: zabonBalBefore.netBalance,
        balanceAfter: zabonBalAfter.netBalance,
      },
      amil: {
        name: amil.AmilName,
        balanceBefore: amilBalBefore.netBalance,
        balanceAfter: amilBalAfter.netBalance,
      },
      printData: {
        catch: buildPrintData({
          docType: "RECEIPT",
          docNumber: catchId,
          docDate,
          amount,
          notes: note,
          partyName: zabon.ZabonName,
          partyType: "زبون",
          balanceBefore: zabonBalBefore.netBalance,
          balanceAfter: zabonBalAfter.netBalance,
          company,
        }),
        pay: buildPrintData({
          docType: "PAYMENT",
          docNumber: payId,
          docDate,
          amount,
          notes: note,
          partyName: amil.AmilName,
          partyType: "مورد",
          balanceBefore: amilBalBefore.netBalance,
          balanceAfter: amilBalAfter.netBalance,
          company,
        }),
      },
    });
  } catch (e) {
    await db.run("ROLLBACK").catch(() => {});
    res.status(500).json({ success: false, message: e.message });
  }
};

const getCashFlowSummary = async (req, res) => {
  const today = new Date().toISOString().split("T")[0];
  const dateFrom = req.query.from || "2000-01-01";
  const dateTo = req.query.to || today;

  try {
    const [catchRow, payRow, cashSalesRow, cashPurchRow] = await Promise.all([
      db.queryOne(
        `SELECT COALESCE(SUM(Amount_CatchDoc), 0) AS t
         FROM CatchDoc_tbl WHERE Date_CatchDoc BETWEEN ? AND ?`,
        [dateFrom, dateTo]
      ),
      db.queryOne(
        `SELECT COALESCE(SUM(Amount_PayDoc), 0) AS t
         FROM PayDoc_tbl WHERE Date_PayDoc BETWEEN ? AND ?`,
        [dateFrom, dateTo]
      ),
      db.queryOne(
        `SELECT COALESCE(SUM(${SALE_INVOICE_AMT}), 0) AS t
         FROM FOUT_tbl f
         LEFT JOIN PayType_Tbl pt ON pt.id_PayType = f.id_PayType_FOUT
         WHERE f.Date_FOUT BETWEEN ? AND ? AND NOT (${DEFERRED_PAY_SQL})`,
        [dateFrom, dateTo]
      ),
      db.queryOne(
        `SELECT COALESCE(SUM(${PURCHASE_INVOICE_AMT}), 0) AS t
         FROM FIN_tbl f
         LEFT JOIN PayType_Tbl pt ON pt.id_PayType = f.id_PayType_FIN
         WHERE f.Date_FIN BETWEEN ? AND ? AND NOT (${DEFERRED_PAY_SQL})`,
        [dateFrom, dateTo]
      ),
    ]);

    const catchDocs = r2(catchRow?.t);
    const payDocs = r2(payRow?.t);
    const cashSales = r2(cashSalesRow?.t);
    const cashPurchases = r2(cashPurchRow?.t);

    res.json({
      success: true,
      dateFrom,
      dateTo,
      data: {
        catchDocs,
        cashSales,
        totalCollected: r2(catchDocs + cashSales),
        payDocs,
        cashPurchases,
        totalPaid: r2(payDocs + cashPurchases),
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ══════════════════════════════════════════════════════════
//  ربح الزبون الصافي (مبيعات − تكلفة − مرتجعات) — لسند القبض
//  GET /api/documents/catch/customer-profit/:zabonId
// ══════════════════════════════════════════════════════════
const customerProfit = async (req, res) => {
  const id = Number(req.params.zabonId);
  if (!id) return res.status(400).json({ success: false, message: "الزبون مطلوب" });
  try {
    const z = await db.queryOne(
      `SELECT id_Zabon, ZabonName FROM Zabon_tbl WHERE id_Zabon = ?`,
      [id]
    );
    if (!z) return res.status(404).json({ success: false, message: "الزبون غير موجود" });

    const r = await db.queryOne(
      `SELECT
         COALESCE(SUM(d.AmountOUT * d.PriceOUT), 0) AS lineRevenue,
         COALESCE((SELECT SUM(COALESCE(f2.Dis_FOUT, 0)) FROM FOUT_tbl f2 WHERE f2.id_Zabon = ?), 0) AS totalDiscount,
         COALESCE((SELECT SUM(COALESCE(f2.Add_FOUT, 0)) FROM FOUT_tbl f2 WHERE f2.id_Zabon = ?), 0) AS totalAdditions,
         COALESCE(SUM(d.AmountOUT * m."Cost Price"), 0) AS totalCost,
         COALESCE((
           SELECT SUM(dr.AmountOUT * dr.PriceOUT) FROM DetailsRetern_tbl dr
           JOIN FRetern_tbl fr ON fr.id_NoFRetern = dr.id_NoFRetern
           WHERE fr.ReturnType = 'CUSTOMER' AND fr.id_Party = ?
         ), 0) AS returnValue,
         COALESCE((
           SELECT SUM(dr.AmountOUT * mt."Cost Price") FROM DetailsRetern_tbl dr
           JOIN FRetern_tbl fr ON fr.id_NoFRetern = dr.id_NoFRetern
           JOIN Materials_tbl mt ON mt.id_Material_NoM = dr.id_Material_NoM
           WHERE fr.ReturnType = 'CUSTOMER' AND fr.id_Party = ?
         ), 0) AS returnCost
       FROM FOUT_tbl f
       JOIN DetailsOUT_tbl d ON d.id_NoFOUT = f.id_NoFOUT
       JOIN Materials_tbl m ON m.id_Material_NoM = d.id_Material_NoM
       WHERE f.id_Zabon = ?`,
      [id, id, id, id, id]
    );

    const lineRevenue    = r2(r?.lineRevenue);
    const additions      = r2(r?.totalAdditions);
    const discounts      = r2(r?.totalDiscount);
    const salesReturns   = r2(r?.returnValue);
    const grossRevenue   = r2(lineRevenue + additions);
    const netRevenue     = r2(grossRevenue - discounts - salesReturns);
    const netCost        = r2(r2(r?.totalCost) - r2(r?.returnCost));
    const netProfit      = r2(netRevenue - netCost);

    res.json({
      success: true,
      data: {
        id_Zabon : z.id_Zabon,
        ZabonName: z.ZabonName,
        netProfit,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

module.exports = {
  // سندات القبض
  getAllCatch, getOneCatch, createCatch, updateCatch, removeCatch, customerProfit,
  // سندات الدفع
  getAllPay, getOnePay, createPay, updatePay, removePay,
  // قبض ودفع مباشر
  createDirectCatchPay,
  // محرك الطباعة والملاحة
  getPrintData, navigate, getBounds,
  getCashFlowSummary,
};
