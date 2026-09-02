// ============================================================
//  controllers/fout.controller.js  —  فاتورة المبيعات
//
//  FOUT_tbl (Header) + DetailsOUT_tbl (Lines)
//
//  المنطق الكامل:
//   ✅ جلب المادة بـ ID أو Barcode مع LastSellPrice + Band
//   ✅ توفير الأسعار الخمسة كخيارات في رد API
//   ✅ السماح بالبيع بالسالب (لا يوقف العملية)
//   ✅ تحديث Stock_tbl (QuantityOUT + QuantityOnHand)
//   ✅ جلب الرصيد السابق للزبون (PreviousBalance)
//   ✅ إضافة دين آجل → DionZabon_tbl
//   ✅ بيانات التوصيل (سائق + مركبة)
//   ✅ الملاحة: السابق / التالي
//   ✅ الحذف الكامل مع عكس جميع التأثيرات
//   ✅ تسجيل في AuditLog_tbl بـ id_User الحالي
//   ✅ كل العمليات المركبة داخل Transaction
//   ✅ [محدَّث] رصيد تراكمي تاريخي دقيق في getOne/navigate
// ============================================================
const db = require("../db");
const { materialExpiryAlert } = require("./expiredStock.controller");
const { getWarehouseQty, subtractWarehouseQty, addWarehouseQty } = require("../utils/warehouseStock");
const { resolveDefaultSellPrice } = require("../utils/sellPriceHelpers");
const { findMaterialByScan, attachScanToMaterial } = require("../utils/materialScan");
const { checkCustomerCreditLimit } = require("../utils/partyBalance");

// ✅ تقريب الأسعار لعدد صحيح (إصلاح مشكلة 15,992 بدل 16,000)
const rPrice = (n) => Math.round(+n || 0);
const r2     = (n) => Math.round((+n || 0) * 100) / 100;

function isDeferredPayType(name = "") {
  const n = String(name).trim();
  return n === "آجل" || n === "اجل" || n.toLowerCase() === "deferred" || n.toLowerCase() === "credit";
}

// ──────────────────────────────────────────────────────────
//  helper — تسجيل في AuditLog
// ──────────────────────────────────────────────────────────
const auditLog = require("./auditLog.controller");
const audit = (user, table, recordId, field, oldVal, newVal, notes = "") =>
  auditLog.log(user, table, recordId, field, oldVal, newVal, notes);
const { formatLinesSummary, removeInvoiceDebtLinks } = auditLog;

// ──────────────────────────────────────────────────────────
//  BASE SELECT  —  رأس الفاتورة مع كل المجاميع
// ──────────────────────────────────────────────────────────
const HEADER_SELECT = `
  SELECT
    f.id_NoFOUT,
    f.Date_FOUT,
    f.id_PayType_FOUT,
    f.Dis_FOUT,
    f.Add_FOUT,
    f.Note_FOUT,
    f.id_Zabon,
    f.id_Mandob,
    f.DriverName,
    f.DriverMobile,
    f.VehicleNumber,

    z.ZabonName,
    zl.Location_ZabonLocation,
    m.MandobName,
    pt.PayTypeName,

    -- مجموع قيمة الأسطر (قبل الخصم)
    COALESCE((
      SELECT SUM(d.AmountOUT * d.PriceOUT)
      FROM DetailsOUT_tbl d WHERE d.id_NoFOUT = f.id_NoFOUT
    ), 0)                                             AS LinesTotal,

    -- الإجمالي بعد الخصم
    COALESCE((
      SELECT SUM(d.AmountOUT * d.PriceOUT)
      FROM DetailsOUT_tbl d WHERE d.id_NoFOUT = f.id_NoFOUT
    ), 0) - f.Dis_FOUT + COALESCE(f.Add_FOUT, 0)               AS GrandTotal,

    -- عدد الأسطر
    (SELECT COUNT(*) FROM DetailsOUT_tbl d WHERE d.id_NoFOUT = f.id_NoFOUT) AS ItemCount

  FROM FOUT_tbl f
  LEFT JOIN Zabon_tbl      z  ON z.id_Zabon   = f.id_Zabon
  LEFT JOIN Zabon_Location zl ON zl.id_ZabonLocation = z.id_ZabonLocation
  LEFT JOIN Mandob_tbl     m  ON m.id_Mandob  = f.id_Mandob
  LEFT JOIN PayType_Tbl    pt ON pt.id_PayType = f.id_PayType_FOUT
`;

// ──────────────────────────────────────────────────────────
//  helper — الرصيد الكلي الحالي للزبون
//  ⚠️  للاستخدام في: getCustomerInfo + create فقط
//      (لا تُستخدم في getOne أو navigate)
// ──────────────────────────────────────────────────────────
const { customerBalance } = require("../utils/partyBalance");
const getZabonBalance = customerBalance;

// ──────────────────────────────────────────────────────────
//  helper — الرصيد التراكمي التاريخي للزبون عند فاتورة محددة
//
//  الخوارزمية:
//
//  1️⃣  ابحث في DionZabon_tbl عن سطر الدين الخاص بهذه الفاتورة
//       تُعرَّف بـ: Note_DionZabon = 'فاتورة مبيعات رقم X'
//
//  2️⃣  اجمع كل ديون الزبون التي سبقت هذا السطر:
//       WHERE id_DionZabon < id_سطر_الفاتورة
//       ← id_DionZabon AUTOINCREMENT يضمن ترتيب الإدراج الدقيق
//
//  3️⃣  اجمع كل مدفوعات الزبون حتى تاريخ الفاتورة:
//       WHERE Date_CatchDoc <= Date_FOUT
//
//  4️⃣  previousBalance = Σ ديون سابقة  −  Σ مدفوعات سابقة
//       finalBalance    = previousBalance + قيمة هذه الفاتورة
//
//  @param {number} id_Zabon    - رقم الزبون
//  @param {number} invoiceId   - رقم الفاتورة (id_NoFOUT)
//  @param {string} invoiceDate - تاريخ الفاتورة (YYYY-MM-DD)
// ──────────────────────────────────────────────────────────
async function getCustomerInvoiceDebtCutoff(id_Zabon, invId) {
  const debtNote = `فاتورة مبيعات رقم ${invId}`;

  const ownDebt = await db.queryOne(
    `SELECT MIN(id_DionZabon) AS id
     FROM DionZabon_tbl
     WHERE id_Zabon = ? AND Note_DionZabon = ?`,
    [id_Zabon, debtNote]
  );
  if (ownDebt?.id) return ownDebt.id;

  const nextInvoiceDebt = await db.queryOne(
    `SELECT MIN(d.id_DionZabon) AS id
     FROM DionZabon_tbl d
     WHERE d.id_Zabon = ?
       AND d.Note_DionZabon LIKE 'فاتورة مبيعات رقم %'
       AND CAST(TRIM(REPLACE(d.Note_DionZabon, 'فاتورة مبيعات رقم ', '')) AS INTEGER) > ?`,
    [id_Zabon, invId]
  );
  if (nextInvoiceDebt?.id) return nextInvoiceDebt.id;

  const firstLaterEntry = await db.queryOne(
    `SELECT MIN(d.id_DionZabon) AS id
     FROM DionZabon_tbl d
     WHERE d.id_Zabon = ?
       AND d.Note_DionZabon NOT LIKE 'تسوية سند قبض رقم%'
       AND d.Note_DionZabon NOT LIKE 'سماح سند قبض رقم%'
       AND d.Note_DionZabon NOT LIKE 'تعديل فاتورة مبيعات%'
       AND d.id_DionZabon > (
         SELECT COALESCE(MAX(d2.id_DionZabon), 0)
         FROM DionZabon_tbl d2
         WHERE d2.id_Zabon = ?
           AND d2.Note_DionZabon LIKE 'فاتورة مبيعات رقم %'
           AND CAST(TRIM(REPLACE(d2.Note_DionZabon, 'فاتورة مبيعات رقم ', '')) AS INTEGER) < ?
       )`,
    [id_Zabon, id_Zabon, invId]
  );
  return firstLaterEntry?.id ?? null;
}

async function getZabonBalanceForInvoice(id_Zabon, invoiceId, invoiceDate) {
  const invId   = Number(invoiceId);
  const invDate = String(invoiceDate || "").split("T")[0];

  const header = await db.queryOne(
    `SELECT f.id_NoFOUT, pt.PayTypeName
     FROM FOUT_tbl f
     LEFT JOIN PayType_Tbl pt ON pt.id_PayType = f.id_PayType_FOUT
     WHERE f.id_NoFOUT = ?`,
    [invId]
  );
  const deferred = header && isDeferredPayType(header.PayTypeName);

  const debtCutoff = await getCustomerInvoiceDebtCutoff(id_Zabon, invId);

  const ownPay = await db.queryOne(
    `SELECT MIN(id_CatchDoc) AS id
     FROM CatchDoc_tbl
     WHERE id_Zabon = ? AND Note_CatchDoc = ?`,
    [id_Zabon, `دفعة على فاتورة مبيعات #${invId}`]
  );
  const payCutoff = ownPay?.id ?? debtCutoff;

  const debtBefore = debtCutoff
    ? await db.queryOne(
        `SELECT COALESCE(SUM(Amount_DionZabon), 0) AS total
         FROM DionZabon_tbl
         WHERE id_Zabon = ?
           AND id_DionZabon < ?
           AND Note_DionZabon NOT LIKE 'تسوية سند قبض رقم%'
           AND Note_DionZabon NOT LIKE 'سماح سند قبض رقم%'`,
        [id_Zabon, debtCutoff]
      )
    : { total: 0 };

  const collectedBefore = payCutoff
    ? await db.queryOne(
        `SELECT COALESCE(SUM(Amount_CatchDoc), 0) AS total
         FROM CatchDoc_tbl
         WHERE id_Zabon = ?
           AND id_CatchDoc < ?
           AND Date_CatchDoc <= ?`,
        [id_Zabon, payCutoff, invDate]
      )
    : { total: 0 };

  const previousBalance = r2(debtBefore.total - collectedBefore.total);

  if (!deferred) {
    return { previousBalance, finalBalance: previousBalance, thisInvoiceDebt: 0 };
  }

  const invoiceEntry = await db.queryOne(
    `SELECT Amount_DionZabon
     FROM DionZabon_tbl
     WHERE id_Zabon = ?
       AND Note_DionZabon = ?
     ORDER BY id_DionZabon DESC
     LIMIT 1`,
    [id_Zabon, `فاتورة مبيعات رقم ${invId}`]
  );

  const thisInvoiceDebt = r2(invoiceEntry?.Amount_DionZabon || 0);
  const finalBalance    = r2(previousBalance + thisInvoiceDebt);

  return { previousBalance, finalBalance, thisInvoiceDebt };
}

async function removeInvoiceCatchDocs(id_Zabon, invoiceId) {
  if (!id_Zabon) return 0;
  const payNote = `دفعة على فاتورة مبيعات #${invoiceId}`;
  const rows = await db.query(
    `SELECT id_CatchDoc FROM CatchDoc_tbl WHERE id_Zabon = ? AND Note_CatchDoc = ?`,
    [id_Zabon, payNote]
  );
  for (const row of rows) {
    const cid = row.id_CatchDoc;
    await db.run(
      `DELETE FROM DionZabon_tbl
       WHERE id_Zabon = ? AND (
         Note_DionZabon LIKE ? OR Note_DionZabon LIKE ?
       )`,
      [id_Zabon, `تسوية سند قبض رقم ${cid}%`, `سماح سند قبض رقم ${cid}%`]
    );
    await db.run(`DELETE FROM CatchDoc_tbl WHERE id_CatchDoc = ?`, [cid]);
  }
  return rows.length;
}

// ══════════════════════════════════════════════════════════
//  GET MATERIAL FOR SALE  — جلب مادة لسطر الفاتورة
//  GET /api/invoices-out/material/:identifier
// ══════════════════════════════════════════════════════════
const getMaterialForSale = async (req, res) => {
  const { identifier } = req.params;
  const MATERIAL_SELECT = `
       SELECT
         m.id_Material_NoM,
         m.MaterialName,
         m.Barcode,
         COALESCE(m.WeightKg, 0)             AS WeightKg,
         m.Band,
         m."Cost Price"                      AS CostPrice,
         c.CatiguaryName,
         t.TypeName,
         COALESCE(s.QuantityOnHand, 0)       AS QuantityOnHand,
         COALESCE(s.QuantityOnHand, 0) || ' ' || m.Band AS QuantityWithUnit,
         COALESCE(sp.LastSellPrice, 0)        AS DefaultPrice,
         COALESCE(sp.LastSellPrice, 0)        AS LastSellPrice,
         COALESCE(sp.SellPrice1, 0)           AS SellPrice1,
         COALESCE(sp.SellPrice2, 0)           AS SellPrice2,
         COALESCE(sp.SellPrice3, 0)           AS SellPrice3,
         COALESCE(sp.SellPrice4, 0)           AS SellPrice4,
         COALESCE(sp.SellPrice5, 0)           AS SellPrice5
       FROM Materials_tbl m
       LEFT JOIN Catiguary_tbl  c  ON c.id_Catiguary   = m.id_Catiguary
       LEFT JOIN Type_tbl       t  ON t.id_Type         = m.id_Type
       LEFT JOIN Stock_tbl      s  ON s.id_Material_NoM = m.id_Material_NoM
       LEFT JOIN SellPrice_tbl sp  ON sp.id_Material_NoM = m.id_Material_NoM`;

  try {
    const found = await findMaterialByScan(db, identifier, {
      barcodeSql: MATERIAL_SELECT + " WHERE CAST(m.Barcode AS TEXT) = CAST(? AS TEXT)",
      idSql: MATERIAL_SELECT + " WHERE m.id_Material_NoM = ?",
    });

    if (!found) {
      return res.status(404).json({
        success : false,
        message : `لم يتم العثور على مادة بـ Barcode/ID: ${identifier}`,
      });
    }

    const row = attachScanToMaterial(found.row, found.scan);

    const stockWarning = row.QuantityOnHand <= 0
      ? `⚠️ تنبيه: المادة "${row.MaterialName}" رصيدها ${row.QuantityOnHand} — سيصبح البيع بالسالب`
      : null;
    const expiryWarning = await materialExpiryAlert(row.id_Material_NoM);

    res.json({
      success      : true,
      stockWarning,
      expiryWarning,
      scan         : found.scan,
      data         : row,
      priceOptions : [
        { label: "آخر سعر", value: Math.round(row.LastSellPrice || 0) },
        { label: "سعر 1",   value: Math.round(row.SellPrice1    || 0) },
        { label: "سعر 2",   value: Math.round(row.SellPrice2    || 0) },
        { label: "سعر 3",   value: Math.round(row.SellPrice3    || 0) },
        { label: "سعر 4",   value: Math.round(row.SellPrice4    || 0) },
        { label: "سعر 5",   value: Math.round(row.SellPrice5    || 0) },
      ].filter((p) => p.value > 0),
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ══════════════════════════════════════════════════════════
//  GET CUSTOMER INFO  — جلب بيانات الزبون + رصيده الحالي
//  GET /api/invoices-out/customer/:id
// ══════════════════════════════════════════════════════════
const getCustomerInfo = async (req, res) => {
  try {
    const zabon = await db.queryOne(
      `SELECT z.*, zl.Location_ZabonLocation
       FROM Zabon_tbl z
       LEFT JOIN Zabon_Location zl ON zl.id_ZabonLocation = z.id_ZabonLocation
       WHERE z.id_Zabon = ?`,
      [req.params.id]
    );
    if (!zabon)
      return res.status(404).json({ success: false, message: "الزبون غير موجود" });

    const balance = await getZabonBalance(req.params.id);
    res.json({ success: true, data: { ...zabon, previousBalance: balance } });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ══════════════════════════════════════════════════════════
//  GET ALL  — قائمة فواتير المبيعات
//  ?from= &to= &id_Zabon= &id_Mandob= &id_PayType= &page= &limit=
// ══════════════════════════════════════════════════════════
const getAll = async (req, res) => {
  try {
    const {
      from, to, id_Zabon, id_Mandob, id_PayType,
      page = 1, limit = 50,
    } = req.query;

    let sql = HEADER_SELECT + " WHERE 1=1";
    const p = [];

    if (from)       { sql += " AND f.Date_FOUT >= ?";      p.push(from); }
    if (to)         { sql += " AND f.Date_FOUT <= ?";      p.push(to); }
    if (id_Zabon)   { sql += " AND f.id_Zabon = ?";        p.push(id_Zabon); }
    if (id_Mandob)  { sql += " AND f.id_Mandob = ?";       p.push(id_Mandob); }
    if (id_PayType) { sql += " AND f.id_PayType_FOUT = ?"; p.push(id_PayType); }

    sql += " ORDER BY f.Date_FOUT DESC, f.id_NoFOUT DESC";

    const countSql = sql
      .replace(HEADER_SELECT, "SELECT COUNT(*) AS total FROM FOUT_tbl f")
      .split("ORDER BY")[0];
    const countRow = await db.queryOne(countSql, p);

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

// ══════════════════════════════════════════════════════════
//  GET ONE  — رأس + أسطر + رصيد تراكمي تاريخي
// ══════════════════════════════════════════════════════════
const getOne = async (req, res) => {
  try {
    const header = await db.queryOne(
      HEADER_SELECT + " WHERE f.id_NoFOUT = ?",
      [req.params.id]
    );
    if (!header)
      return res.status(404).json({ success: false, message: "الفاتورة غير موجودة" });

    const lines = await db.query(
      `SELECT
         d.id_NoFOUT,
         d.id_Material_NoM,
         d.AmountOUT,
         d.PriceOUT,
         COALESCE(d.gift_qty, 0)               AS gift_qty,
         d.AmountStayInStorage,
         m.MaterialName,
         m.Barcode,
         COALESCE(m.WeightKg, 0)             AS WeightKg,
         m.Band,
         c.CatiguaryName,
         (d.AmountOUT * d.PriceOUT)          AS LineTotal,
         COALESCE(s.QuantityOnHand, 0)        AS CurrentStock
       FROM DetailsOUT_tbl d
       LEFT JOIN Materials_tbl m ON m.id_Material_NoM = d.id_Material_NoM
       LEFT JOIN Catiguary_tbl c ON c.id_Catiguary    = m.id_Catiguary
       LEFT JOIN Stock_tbl     s ON s.id_Material_NoM = d.id_Material_NoM
       WHERE d.id_NoFOUT = ?
       ORDER BY d.id_Material_NoM`,
      [req.params.id]
    );

    // ✅ الرصيد التراكمي التاريخي:
    //    يبحث في DionZabon عن كل الديون التي سبقت هذه الفاتورة (بحسب id)
    //    ويبحث في CatchDoc عن كل المدفوعات حتى تاريخ الفاتورة
    const balance = await getZabonBalanceForInvoice(
      header.id_Zabon,
      Number(req.params.id),
      header.Date_FOUT          // ← تاريخ الفاتورة لتصفية المدفوعات
    );

    const paidRow = await db.queryOne(
      `SELECT COALESCE(SUM(Amount_CatchDoc), 0) AS paidAmount
       FROM CatchDoc_tbl
       WHERE id_Zabon = ? AND Note_CatchDoc = ?`,
      [header.id_Zabon, `دفعة على فاتورة مبيعات #${req.params.id}`]
    );

    const paidAmount = r2(paidRow?.paidAmount || 0);
    const finalBalance = isDeferredPayType(header.PayTypeName)
      ? r2(balance.previousBalance + balance.thisInvoiceDebt - paidAmount)
      : r2(balance.previousBalance);

    res.json({
      success : true,
      data    : {
        ...header,
        previousBalance : balance.previousBalance,
        finalBalance,
        thisInvoiceDebt : balance.thisInvoiceDebt,
        paidAmount,
        lines,
      },
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ══════════════════════════════════════════════════════════
//  CREATE  — إنشاء فاتورة مبيعات كاملة
// ══════════════════════════════════════════════════════════
const create = async (req, res) => {
  const {
    Date_FOUT,
    id_PayType_FOUT,
    Dis_FOUT      = 0,
    Add_FOUT      = 0,
    Note_FOUT     = "",
    id_Zabon,
    id_Mandob     = null,
    DriverName    = "",
    DriverMobile  = "",
    VehicleNumber = "",
    PaidAmount    = 0,
    lines         = [],
  } = req.body;

  if (!id_Zabon)
    return res.status(400).json({ success: false, message: "الزبون (id_Zabon) مطلوب" });
  if (!id_PayType_FOUT)
    return res.status(400).json({ success: false, message: "نوع الدفع (id_PayType_FOUT) مطلوب" });
  if (!Array.isArray(lines) || lines.length === 0)
    return res.status(400).json({ success: false, message: "يجب إضافة سطر واحد على الأقل" });

  const zabon = await db.queryOne(`SELECT * FROM Zabon_tbl WHERE id_Zabon = ?`, [id_Zabon]);
  if (!zabon)
    return res.status(400).json({ success: false, message: `الزبون id=${id_Zabon} غير موجود` });

  const payType = await db.queryOne(
    `SELECT * FROM PayType_Tbl WHERE id_PayType = ?`, [id_PayType_FOUT]
  );
  if (!payType)
    return res.status(400).json({ success: false, message: `نوع الدفع id=${id_PayType_FOUT} غير موجود` });

  if (id_Mandob) {
    const mandob = await db.queryOne(`SELECT id_Mandob FROM Mandob_tbl WHERE id_Mandob = ?`, [id_Mandob]);
    if (!mandob)
      return res.status(400).json({ success: false, message: `المندوب id=${id_Mandob} غير موجود` });
  }

  const today       = new Date().toISOString().split("T")[0];
  const invoiceDate = Date_FOUT || today;
  const preparedLines = [];

  for (const line of lines) {
    const { id_Material_NoM, AmountOUT, PriceOUT, gift_qty = 0, id_Warehouse = null } = line;

    if (!id_Material_NoM)
      return res.status(400).json({ success: false, message: "id_Material_NoM مطلوب في كل سطر" });
    if (!AmountOUT || Number(AmountOUT) <= 0)
      return res.status(400).json({ success: false, message: `الكمية يجب أن تكون أكبر من صفر (المادة ${id_Material_NoM})` });
    if (PriceOUT === undefined || Number(PriceOUT) < 0)
      return res.status(400).json({ success: false, message: `سعر البيع مطلوب (المادة ${id_Material_NoM})` });

    const whId = id_Warehouse ? Number(id_Warehouse) : null;
    if (whId) {
      const wh = await db.queryOne(
        `SELECT id_Warehouse FROM Warehouses_tbl WHERE id_Warehouse = ? AND IsActive = 1`,
        [whId]
      );
      if (!wh)
        return res.status(400).json({ success: false, message: `المستودع id=${whId} غير موجود أو غير نشط` });
    }

    const mat = await db.queryOne(
      `SELECT m.id_Material_NoM, m.MaterialName, m.Band, m."Cost Price" AS CostPrice, sp.LastSellPrice
       FROM Materials_tbl m
       LEFT JOIN SellPrice_tbl sp ON sp.id_Material_NoM = m.id_Material_NoM
       WHERE m.id_Material_NoM = ?`,
      [id_Material_NoM]
    );
    if (!mat)
      return res.status(400).json({ success: false, message: `المادة id=${id_Material_NoM} غير موجودة` });

    const stock = await db.queryOne(
      `SELECT COALESCE(QuantityOnHand, 0) AS qty FROM Stock_tbl WHERE id_Material_NoM = ?`,
      [id_Material_NoM]
    );
    const globalQty = stock?.qty || 0;
    const warehouseQty = whId ? await getWarehouseQty(id_Material_NoM, whId) : null;
    const currentQty = whId ? warehouseQty : globalQty;
    const giftQ = Math.max(0, Math.floor(Number(gift_qty) || 0));
    const totalDeduct = r2(Number(AmountOUT) + giftQ);
    const stockAfter = r2(currentQty - totalDeduct);

    preparedLines.push({
      id_Material_NoM  : Number(id_Material_NoM),
      id_Warehouse     : whId,
      MaterialName     : mat.MaterialName,
      Band             : mat.Band,
      CostPrice        : mat.CostPrice || 0,
      AmountOUT        : r2(Number(AmountOUT)),
      PriceOUT         : rPrice(Number(PriceOUT)),
      gift_qty         : giftQ,
      CurrentQty       : currentQty,
      StockAfterSale   : stockAfter,
      isBelowZero      : stockAfter < 0,
      usesWarehouse    : !!whId,
    });
  }

  // الرصيد قبل إنشاء الفاتورة (قبل إدراج الدين في DionZabon)
  const balanceBefore = await getZabonBalance(id_Zabon);

  const linesTotal = preparedLines.reduce((s, l) => s + l.AmountOUT * l.PriceOUT, 0);
  const grandTotal = linesTotal - Number(Dis_FOUT) + Number(Add_FOUT || 0);

  if (isDeferredPayType(payType.PayTypeName)) {
    const creditMsg = checkCustomerCreditLimit(
      zabon["Credit Limit"],
      balanceBefore.netBalance,
      grandTotal,
      PaidAmount
    );
    if (creditMsg) {
      return res.status(400).json({ success: false, message: creditMsg });
    }
  }

  try {
    await db.run("BEGIN TRANSACTION");

    const hdr = await db.run(
      `INSERT INTO FOUT_tbl
         (Date_FOUT, id_PayType_FOUT, Dis_FOUT, Add_FOUT, Note_FOUT,
          id_Zabon, id_Mandob, DriverName, DriverMobile, VehicleNumber)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [invoiceDate, id_PayType_FOUT, Number(Dis_FOUT), Number(Add_FOUT || 0), Note_FOUT,
       id_Zabon, id_Mandob, DriverName, DriverMobile, VehicleNumber]
    );
    const invoiceId = hdr.lastID;
    const belowZeroWarnings = [];

    for (const line of preparedLines) {
      await db.run(
        `INSERT INTO DetailsOUT_tbl
           (id_NoFOUT, id_Material_NoM, AmountOUT, PriceOUT, AmountStayInStorage, gift_qty, id_Warehouse)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [invoiceId, line.id_Material_NoM, line.AmountOUT, line.PriceOUT, line.StockAfterSale, line.gift_qty, line.id_Warehouse]
      );

      // الخصم من المخزون = الكمية المباعة + كمية الهدية
      const totalDeduct = r2(line.AmountOUT + line.gift_qty);
      await db.run(
        `INSERT INTO Stock_tbl
           (id_Material_NoM, QuantityOUT, QuantityOnHand, LastUpdateDate)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(id_Material_NoM) DO UPDATE SET
           QuantityOUT    = QuantityOUT    + excluded.QuantityOUT,
           QuantityOnHand = QuantityOnHand - excluded.QuantityOUT,
           LastUpdateDate = excluded.LastUpdateDate`,
        [line.id_Material_NoM, totalDeduct, totalDeduct]
      );

      if (line.id_Warehouse)
        await subtractWarehouseQty(line.id_Material_NoM, line.id_Warehouse, totalDeduct, true);

      await audit(req.user, "Stock_tbl", line.id_Material_NoM, "QuantityOnHand",
        line.CurrentQty, line.StockAfterSale,
        `فاتورة مبيعات #${invoiceId} | مباع: ${line.AmountOUT} هدية: ${line.gift_qty}${line.id_Warehouse ? ` | مستودع ${line.id_Warehouse}` : ""} ${line.Band}`
      );

      if (line.isBelowZero)
        belowZeroWarnings.push(`"${line.MaterialName}": المخزون أصبح ${line.StockAfterSale} ${line.Band}`);

    }

    if (isDeferredPayType(payType.PayTypeName)) {
      await db.run(
        `INSERT INTO DionZabon_tbl (Amount_DionZabon, Date_DionZabon, Note_DionZabon, id_Zabon)
         VALUES (?, ?, ?, ?)`,
        [grandTotal, invoiceDate, `فاتورة مبيعات رقم ${invoiceId}`, id_Zabon]
      );
    }

    // دفعة جزئية سريعة — سند قبض مرتبط بالفاتورة (مع الدفع الآجل)
    const paidAmt = Math.max(0, Number(PaidAmount) || 0);
    let catchDocId = null;
    let payOnInvoiceAmt = 0;
    if (paidAmt > 0 && isDeferredPayType(payType.PayTypeName)) {
      payOnInvoiceAmt = Math.min(paidAmt, grandTotal);
      const catchRes = await db.run(
        `INSERT INTO CatchDoc_tbl (Amount_CatchDoc, Date_CatchDoc, Note_CatchDoc, id_Zabon)
         VALUES (?, ?, ?, ?)`,
        [payOnInvoiceAmt, invoiceDate, `دفعة على فاتورة مبيعات #${invoiceId}`, id_Zabon]
      );
      catchDocId = catchRes.lastID;
      await db.run(
        `INSERT INTO DionZabon_tbl (Amount_DionZabon, Date_DionZabon, Note_DionZabon, id_Zabon)
         VALUES (?, ?, ?, ?)`,
        [-payOnInvoiceAmt, invoiceDate, `تسوية سند قبض رقم ${catchDocId}`, id_Zabon]
      );
    }

    if (catchDocId) {
      await audit(req.user, "CatchDoc_tbl", catchDocId, "CREATE", null, payOnInvoiceAmt,
        `دفعة على فاتورة مبيعات #${invoiceId}`);
    }

    await audit(req.user, "FOUT_tbl", invoiceId, "CREATE", null, grandTotal,
      `إنشاء فاتورة مبيعات | الزبون: ${zabon.ZabonName} | ${payType.PayTypeName} | مواد: ${formatLinesSummary(preparedLines, "out")}`
    );

    await db.run("COMMIT");

    res.status(201).json({
      success           : true,
      message           : "تم إنشاء فاتورة المبيعات بنجاح",
      invoiceId,
      belowZeroWarnings : belowZeroWarnings.length ? belowZeroWarnings : undefined,
      summary           : {
        invoiceDate,
        customerName    : zabon.ZabonName,
        paymentType     : payType.PayTypeName,
        linesCount      : preparedLines.length,
        linesTotal      : Math.round(linesTotal * 100) / 100,
        discount        : Number(Dis_FOUT),
        grandTotal      : Math.round(grandTotal * 100) / 100,
        debtAdded       : isDeferredPayType(payType.PayTypeName),
        paidAmount      : paidAmt > 0 ? Math.round(Math.min(paidAmt, grandTotal) * 100) / 100 : 0,
        catchDocId      : catchDocId || undefined,
        previousBalance : balanceBefore.netBalance,
        newBalance      : isDeferredPayType(payType.PayTypeName)
          ? balanceBefore.netBalance + grandTotal
          : balanceBefore.netBalance,
      },
      lines: preparedLines.map((l) => ({
        id_Material_NoM : l.id_Material_NoM,
        MaterialName    : l.MaterialName,
        Band            : l.Band,
        AmountOUT       : l.AmountOUT,
        gift_qty        : l.gift_qty,
        PriceOUT        : l.PriceOUT,
        LineTotal       : Math.round(l.AmountOUT * l.PriceOUT * 100) / 100,
        StockAfterSale  : l.StockAfterSale,
        isBelowZero     : l.isBelowZero,
      })),
    });
  } catch (e) {
    await db.run("ROLLBACK").catch(() => {});
    res.status(500).json({ success: false, message: e.message });
  }
};

// ══════════════════════════════════════════════════════════
//  DELETE  — حذف كامل مع عكس جميع التأثيرات
// ══════════════════════════════════════════════════════════
const remove = async (req, res) => {
  try {
    const header = await db.queryOne(
      `SELECT f.*, pt.PayTypeName
       FROM FOUT_tbl f
       LEFT JOIN PayType_Tbl pt ON pt.id_PayType = f.id_PayType_FOUT
       WHERE f.id_NoFOUT = ?`,
      [req.params.id]
    );
    if (!header)
      return res.status(404).json({ success: false, message: "الفاتورة غير موجودة" });

    const lines = await db.query(
      `SELECT d.*, m.MaterialName, m.Band,
              COALESCE(s.QuantityOnHand, 0) AS CurrentStock
       FROM DetailsOUT_tbl d
       LEFT JOIN Materials_tbl m ON m.id_Material_NoM = d.id_Material_NoM
       LEFT JOIN Stock_tbl     s ON s.id_Material_NoM = d.id_Material_NoM
       WHERE d.id_NoFOUT = ?`,
      [req.params.id]
    );

    await db.run("BEGIN TRANSACTION");

    for (const line of lines) {
      const totalRestore = r2((line.AmountOUT || 0) + (line.gift_qty || 0));
      await db.run(
        `UPDATE Stock_tbl SET
           QuantityOUT    = MAX(0, QuantityOUT    - ?),
           QuantityOnHand = QuantityOnHand + ?,
           LastUpdateDate = datetime('now')
         WHERE id_Material_NoM = ?`,
        [totalRestore, totalRestore, line.id_Material_NoM]
      );
      if (line.id_Warehouse)
        await addWarehouseQty(line.id_Material_NoM, line.id_Warehouse, totalRestore);
      await audit(req.user, "Stock_tbl", line.id_Material_NoM, "DELETE_LINE",
        `${line.MaterialName || line.id_Material_NoM}: ${totalRestore} ${line.Band || ""}`,
        null,
        `حذف سطر فاتورة مبيعات #${req.params.id}`
      );
    }

    const catchCancelled = await removeInvoiceCatchDocs(header.id_Zabon, req.params.id);

    const debtCancelled = await removeInvoiceDebtLinks(
      "customer", header.id_Zabon, req.params.id
    );

    const deletedTotal = r2(
      lines.reduce((s, l) => s + (l.AmountOUT || 0) * (l.PriceOUT || 0), 0)
        - (header.Dis_FOUT || 0) + (header.Add_FOUT || 0)
    );

    await db.run(`DELETE FROM DetailsOUT_tbl WHERE id_NoFOUT = ?`, [req.params.id]);
    await db.run(`DELETE FROM FOUT_tbl        WHERE id_NoFOUT = ?`, [req.params.id]);

    await audit(req.user, "FOUT_tbl", req.params.id, "DELETE",
      String(deletedTotal),
      null,
      `حذف فاتورة مبيعات | الزبون: ${header.id_Zabon} | مواد: ${formatLinesSummary(lines, "out")}`
    );

    await db.run("COMMIT");

    res.json({
      success  : true,
      message  : `تم حذف فاتورة المبيعات #${req.params.id} وعكس جميع تأثيراتها`,
      reversed : { stockRestored: lines.length, debtCancelled, catchCancelled },
    });
  } catch (e) {
    await db.run("ROLLBACK").catch(() => {});
    res.status(500).json({ success: false, message: e.message });
  }
};

// ══════════════════════════════════════════════════════════
//  NAVIGATE  — الملاحة (السابق / التالي) مع رصيد تاريخي دقيق
//  GET /api/invoices-out/:id/navigate/:direction
// ══════════════════════════════════════════════════════════
const navigate = async (req, res) => {
  const { id, direction } = req.params;
  try {
    let row;
    if (direction === "prev") {
      row = await db.queryOne(
        `SELECT id_NoFOUT FROM FOUT_tbl WHERE id_NoFOUT < ? ORDER BY id_NoFOUT DESC LIMIT 1`,
        [id]
      );
    } else if (direction === "next") {
      row = await db.queryOne(
        `SELECT id_NoFOUT FROM FOUT_tbl WHERE id_NoFOUT > ? ORDER BY id_NoFOUT ASC LIMIT 1`,
        [id]
      );
    } else {
      return res.status(400).json({ success: false, message: "direction يجب أن يكون prev أو next" });
    }

    if (!row)
      return res.status(404).json({
        success   : false,
        message   : direction === "prev" ? "لا توجد فاتورة سابقة" : "لا توجد فاتورة تالية",
        direction,
        currentId : Number(id),
      });

    const header = await db.queryOne(HEADER_SELECT + " WHERE f.id_NoFOUT = ?", [row.id_NoFOUT]);
    const lines  = await db.query(
      `SELECT d.*, m.MaterialName, m.Band, m.Barcode,
              COALESCE(m.WeightKg, 0) AS WeightKg,
              (d.AmountOUT * d.PriceOUT) AS LineTotal
       FROM DetailsOUT_tbl d
       LEFT JOIN Materials_tbl m ON m.id_Material_NoM = d.id_Material_NoM
       WHERE d.id_NoFOUT = ?`,
      [row.id_NoFOUT]
    );

    // ✅ الرصيد التراكمي التاريخي للفاتورة المُنقَل إليها
    const balance = await getZabonBalanceForInvoice(
      header.id_Zabon,
      Number(row.id_NoFOUT),
      header.Date_FOUT
    );

    res.json({
      success   : true,
      direction,
      data      : {
        ...header,
        previousBalance : balance.previousBalance,
        finalBalance    : balance.finalBalance,
        thisInvoiceDebt : balance.thisInvoiceDebt,
        lines,
      },
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ══════════════════════════════════════════════════════════
//  GET FIRST & LAST  — أول وآخر فاتورة
// ══════════════════════════════════════════════════════════
const getFirstLast = async (_req, res) => {
  try {
    const [first, last] = await Promise.all([
      db.queryOne(`SELECT id_NoFOUT FROM FOUT_tbl ORDER BY id_NoFOUT ASC  LIMIT 1`),
      db.queryOne(`SELECT id_NoFOUT FROM FOUT_tbl ORDER BY id_NoFOUT DESC LIMIT 1`),
    ]);
    res.json({
      success      : true,
      firstInvoice : first?.id_NoFOUT || null,
      lastInvoice  : last?.id_NoFOUT  || null,
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

module.exports = {
  getMaterialForSale,
  getCustomerInfo,
  getAll,
  getOne,
  create,
  remove,
  navigate,
  getFirstLast,
};
