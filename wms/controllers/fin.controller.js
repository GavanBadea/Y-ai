// ============================================================
//  controllers/fin.controller.js  —  فاتورة المشتريات
//
//  FIN_tbl (Header) + DetailsIN_tbl (Lines)
//
//  المنطق الكامل:
//   ✅ توزيع Landed Cost على الأسطر بالتناسب
//   ✅ تحديث Cost Price بالمعدل المرجح (Weighted Average)
//   ✅ تحديث Stock_tbl (كمية + هدايا)
//   ✅ إضافة دين آجل → DionAmil_tbl
//   ✅ تسجيل في AuditLog_tbl
//   ✅ الملاحة: السابق / التالي
//   ✅ الحذف الكامل مع عكس كل التأثيرات
//   ✅ [محدَّث] رصيد تراكمي تاريخي دقيق في getOne/navigate
// ============================================================
const db = require("../db");
const { addWarehouseQty, subtractWarehouseQty } = require("../utils/warehouseStock");
const { recalcMaterialWAC } = require("../utils/recalcMaterialWAC");
const { applyLandedCostToLines } = require("../utils/purchaseLineCost");

function isDeferredPayType(name = "") {
  const n = String(name).trim();
  return n === "آجل" || n === "اجل" || n.toLowerCase() === "deferred" || n.toLowerCase() === "credit";
}

function isCashPayType(name = "") {
  const n = String(name).trim();
  return n === "نقد" || n === "نقدي" || n.toLowerCase() === "cash";
}

const r2 = (n) => Math.round((+n || 0) * 100) / 100;

function landedExtrasExpr(alias = "f") {
  const a = alias;
  return `(${a}.Trans + ${a}.Customs + ${a}.Porter + COALESCE(${a}.SGS, 0) + COALESCE(${a}.ExportRelease, 0) + COALESCE(${a}.VehicleManifest, 0))`;
}

function sumLandedExtrasFromBody({ Trans = 0, Customs = 0, Porter = 0, SGS = 0, ExportRelease = 0, VehicleManifest = 0 }) {
  return Number(Trans) + Number(Customs) + Number(Porter) + Number(SGS) + Number(ExportRelease) + Number(VehicleManifest);
}

// ──────────────────────────────────────────────────────────
//  BASE SELECT — رأس الفاتورة مع المجاميع
// ──────────────────────────────────────────────────────────
const HEADER_SELECT = `
  SELECT
    f.id_NoFIN,
    f.Date_FIN,
    f.id_PayType_FIN,
    f.Dis_FIN,
    f.Trans,
    f.Customs,
    f.Porter,
    COALESCE(f.SGS, 0)              AS SGS,
    COALESCE(f.ExportRelease, 0)    AS ExportRelease,
    COALESCE(f.VehicleManifest, 0)  AS VehicleManifest,
    COALESCE(f.GeneralTax, 0)       AS GeneralTax,
    f.id_Amil,
    a.AmilName,
    f.DriverName,
    f.DriverMobile,
    f.VehicleNumber,
    pt.PayTypeName,

    -- مجموع قيمة الأسطر (قبل المصاريف)
    COALESCE((
      SELECT SUM(d.AmountIN * d.PriceIN)
      FROM DetailsIN_tbl d WHERE d.id_NoFIN = f.id_NoFIN
    ), 0)                                             AS LinesTotal,

    -- إجمالي المصاريف الإضافية
    ${landedExtrasExpr("f")}                          AS TotalExtras,

    -- صافي المصاريف الموزَّعة
    (${landedExtrasExpr("f")} - f.Dis_FIN)            AS NetExtras,

    -- الإجمالي النهائي للفاتورة
    COALESCE((
      SELECT SUM(d.AmountIN * d.PriceIN)
      FROM DetailsIN_tbl d WHERE d.id_NoFIN = f.id_NoFIN
    ), 0) + (${landedExtrasExpr("f")} - f.Dis_FIN)    AS GrandTotal,

    -- عدد الأسطر
    (SELECT COUNT(*) FROM DetailsIN_tbl d WHERE d.id_NoFIN = f.id_NoFIN) AS ItemCount

  FROM FIN_tbl f
  LEFT JOIN Amil_tbl    a  ON a.id_Amil    = f.id_Amil
  LEFT JOIN PayType_Tbl pt ON pt.id_PayType = f.id_PayType_FIN
`;

// ──────────────────────────────────────────────────────────
//  helper — حساب Landed Cost لكل سطر
// ──────────────────────────────────────────────────────────
const calcLandedCost = applyLandedCostToLines;

// ──────────────────────────────────────────────────────────
//  helper — WAC من قيمة المخzون الفعلية (بدون تقريب مبكر)
// ──────────────────────────────────────────────────────────
function wacFromInventoryValue(oldQty, oldCost, newQty, inventoryValue) {
  const oq = +oldQty || 0;
  const oc = +oldCost || 0;
  const nq = +newQty || 0;
  const iv = +inventoryValue || 0;
  const totalQty = oq + nq;
  if (totalQty === 0) return nq > 0 ? iv / nq : 0;
  return (oq * oc + iv) / totalQty;
}

// ──────────────────────────────────────────────────────────
//  helper — المعدل المرجح (Weighted Average Cost)
// ──────────────────────────────────────────────────────────
function weightedAvgCost(oldQty, oldCost, newQty, newCost) {
  const totalQty = oldQty + newQty;
  if (totalQty === 0) return newCost;
  return (oldQty * oldCost + newQty * newCost) / totalQty;
}

// ──────────────────────────────────────────────────────────
//  helper — تسجيل في AuditLog
// ──────────────────────────────────────────────────────────
const auditLog = require("./auditLog.controller");
const audit = (user, table, recordId, field, oldVal, newVal, notes) =>
  auditLog.log(user, table, recordId, field, oldVal, newVal, notes);
const { formatLinesSummary, removeInvoiceDebtLinks } = auditLog;

// ──────────────────────────────────────────────────────────
//  helper — الرصيد التراكمي التاريخي للمورد عند فاتورة محددة
//
//  الخوارزمية:
//
//  1️⃣  ابحث في DionAmil_tbl عن سطر الدين الخاص بهذه الفاتورة
//       تُعرَّف بـ: Note_DionAmil = 'فاتورة مشتريات رقم X'
//
//  2️⃣  اجمع كل ديون المورد المُدرَجة قبل لحظة إنشاء هذه الفاتورة:
//       WHERE id_DionAmil < نقطة_القطع
//       ← id_DionAmil AUTOINCREMENT = ترتيب الإنشاء الفعلي
//       (دين سابق يُسجَّل لاحقاً لا يظهر في فاتورة أقدم)
//
//  3️⃣  اجمع المدفوعات المُدرَجة قبل نفس النقطة الزمنية
//
//  4️⃣  previousBalance = Σ ديون سابقة  −  Σ مدفوعات سابقة
//       finalBalance    = previousBalance + قيمة هذه الفاتورة
//
//  @param {number} id_Amil     - رقم المورد
//  @param {number} invoiceId   - رقم الفاتورة (id_NoFIN)
//  @param {string} invoiceDate - تاريخ الفاتورة (YYYY-MM-DD)
// ──────────────────────────────────────────────────────────
async function getSupplierInvoiceDebtCutoff(id_Amil, invId) {
  const debtNote = `فاتورة مشتريات رقم ${invId}`;

  const ownDebt = await db.queryOne(
    `SELECT MIN(id_DionAmil) AS id
     FROM DionAmil_tbl
     WHERE id_Amil = ? AND Note_DionAmil = ?`,
    [id_Amil, debtNote]
  );
  if (ownDebt?.id) return ownDebt.id;

  const nextInvoiceDebt = await db.queryOne(
    `SELECT MIN(d.id_DionAmil) AS id
     FROM DionAmil_tbl d
     WHERE d.id_Amil = ?
       AND d.Note_DionAmil LIKE 'فاتورة مشتريات رقم %'
       AND CAST(TRIM(REPLACE(d.Note_DionAmil, 'فاتورة مشتريات رقم ', '')) AS INTEGER) > ?`,
    [id_Amil, invId]
  );
  if (nextInvoiceDebt?.id) return nextInvoiceDebt.id;

  const firstLaterEntry = await db.queryOne(
    `SELECT MIN(d.id_DionAmil) AS id
     FROM DionAmil_tbl d
     WHERE d.id_Amil = ?
       AND d.Note_DionAmil NOT LIKE 'تسوية سند دفع رقم%'
       AND d.Note_DionAmil NOT LIKE 'تعديل فاتورة مشتريات%'
       AND d.id_DionAmil > (
         SELECT COALESCE(MAX(d2.id_DionAmil), 0)
         FROM DionAmil_tbl d2
         WHERE d2.id_Amil = ?
           AND d2.Note_DionAmil LIKE 'فاتورة مشتريات رقم %'
           AND CAST(TRIM(REPLACE(d2.Note_DionAmil, 'فاتورة مشتريات رقم ', '')) AS INTEGER) < ?
       )`,
    [id_Amil, id_Amil, invId]
  );
  return firstLaterEntry?.id ?? null;
}

async function getAmilBalanceForInvoice(id_Amil, invoiceId, invoiceDate) {
  const invId = Number(invoiceId);
  const invDate = String(invoiceDate || "").split("T")[0];

  const header = await db.queryOne(
    `SELECT f.id_NoFIN, pt.PayTypeName
     FROM FIN_tbl f
     LEFT JOIN PayType_Tbl pt ON pt.id_PayType = f.id_PayType_FIN
     WHERE f.id_NoFIN = ?`,
    [invId]
  );
  const deferred = header && isDeferredPayType(header.PayTypeName);

  let debtCutoff = await getSupplierInvoiceDebtCutoff(id_Amil, invId);
  if (!debtCutoff) {
    const maxRow = await db.queryOne(
      `SELECT COALESCE(MAX(id_DionAmil), 0) + 1 AS id FROM DionAmil_tbl WHERE id_Amil = ?`,
      [id_Amil]
    );
    debtCutoff = maxRow?.id || 1;
  }

  const ownPay = await db.queryOne(
    `SELECT MIN(id_PayDoc) AS id
     FROM PayDoc_tbl
     WHERE id_Amil = ? AND Note_PayDoc = ?`,
    [id_Amil, `دفعة على فاتورة مشتريات #${invId}`]
  );
  const payCutoff = ownPay?.id ?? debtCutoff;

  const debtBefore = await db.queryOne(
    `SELECT COALESCE(SUM(Amount_DionAmil), 0) AS total
     FROM DionAmil_tbl
     WHERE id_Amil = ?
       AND id_DionAmil < ?
       AND Note_DionAmil NOT LIKE 'تسوية سند دفع رقم%'
       AND Note_DionAmil NOT LIKE 'تعديل فاتورة مشتريات%'`,
    [id_Amil, debtCutoff]
  );

  const paidBefore = ownPay?.id
    ? await db.queryOne(
        `SELECT COALESCE(SUM(Amount_PayDoc), 0) AS total
         FROM PayDoc_tbl
         WHERE id_Amil = ?
           AND id_PayDoc < ?
           AND Date_PayDoc <= ?`,
        [id_Amil, payCutoff, invDate]
      )
    : await db.queryOne(
        `SELECT COALESCE(SUM(Amount_PayDoc), 0) AS total
         FROM PayDoc_tbl
         WHERE id_Amil = ? AND Date_PayDoc <= ?`,
        [id_Amil, invDate]
      );

  const previousBalance = r2(debtBefore.total - paidBefore.total);

  if (!deferred) {
    return { previousBalance, finalBalance: previousBalance, thisInvoiceDebt: 0 };
  }

  const invoiceEntry = await db.queryOne(
    `SELECT Amount_DionAmil
     FROM DionAmil_tbl
     WHERE id_Amil = ?
       AND Note_DionAmil = ?
     ORDER BY id_DionAmil DESC
     LIMIT 1`,
    [id_Amil, `فاتورة مشتريات رقم ${invId}`]
  );

  const thisInvoiceDebt = r2(invoiceEntry?.Amount_DionAmil || 0);
  const finalBalance    = r2(previousBalance + thisInvoiceDebt);

  return { previousBalance, finalBalance, thisInvoiceDebt };
}

async function removeInvoicePayDocs(id_Amil, invoiceId) {
  if (!id_Amil) return 0;
  const payNote = `دفعة على فاتورة مشتريات #${invoiceId}`;
  const rows = await db.query(
    `SELECT id_PayDoc FROM PayDoc_tbl WHERE id_Amil = ? AND Note_PayDoc = ?`,
    [id_Amil, payNote]
  );
  for (const row of rows) {
    const pid = row.id_PayDoc;
    await db.run(
      `DELETE FROM DionAmil_tbl
       WHERE id_Amil = ? AND Note_DionAmil LIKE ?`,
      [id_Amil, `تسوية سند دفع رقم ${pid}%`]
    );
    await db.run(`DELETE FROM PayDoc_tbl WHERE id_PayDoc = ?`, [pid]);
  }
  return rows.length;
}

// ══════════════════════════════════════════════════════════
//  GET ALL  — قائمة الفواتير مع المجاميع
//  ?from= &to= &id_Amil= &id_PayType= &page= &limit=
// ══════════════════════════════════════════════════════════
const getAll = async (req, res) => {
  try {
    const { from, to, id_Amil, id_PayType, page = 1, limit = 50 } = req.query;

    let sql = HEADER_SELECT + " WHERE 1=1";
    const p = [];

    if (from)       { sql += " AND f.Date_FIN >= ?";       p.push(from); }
    if (to)         { sql += " AND f.Date_FIN <= ?";       p.push(to); }
    if (id_Amil)    { sql += " AND f.id_Amil = ?";         p.push(id_Amil); }
    if (id_PayType) { sql += " AND f.id_PayType_FIN = ?";  p.push(id_PayType); }

    sql += " ORDER BY f.Date_FIN DESC, f.id_NoFIN DESC";

    const offset = (Number(page) - 1) * Number(limit);
    const countRow = await db.queryOne(
      `SELECT COUNT(*) AS total FROM FIN_tbl f WHERE 1=1
       ${from       ? " AND f.Date_FIN >= '" + from + "'" : ""}
       ${to         ? " AND f.Date_FIN <= '" + to   + "'" : ""}
       ${id_Amil    ? " AND f.id_Amil = "    + id_Amil    : ""}
       ${id_PayType ? " AND f.id_PayType_FIN = " + id_PayType : ""}`
    );

    sql += ` LIMIT ? OFFSET ?`;
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
//  GET ONE  — رأس + تفاصيل + Landed Cost + رصيد تاريخي مورد
// ══════════════════════════════════════════════════════════
const getOne = async (req, res) => {
  try {
    const header = await db.queryOne(
      HEADER_SELECT + " WHERE f.id_NoFIN = ?",
      [req.params.id]
    );
    if (!header)
      return res.status(404).json({ success: false, message: "الفاتورة غير موجودة" });

    const lines = await db.query(
      `SELECT
         d.*,
         m.MaterialName,
         m.Barcode,
         m.Band,
         m."Cost Price"                      AS CurrentCostPrice,
         c.CatiguaryName,
         (d.AmountIN * d.PriceIN)            AS LineTotal,
         COALESCE(s.QuantityOnHand, 0)       AS CurrentStock
       FROM DetailsIN_tbl d
       LEFT JOIN Materials_tbl m ON m.id_Material_NoM = d.id_Material_NoM
       LEFT JOIN Catiguary_tbl c ON c.id_Catiguary    = m.id_Catiguary
       LEFT JOIN Stock_tbl     s ON s.id_Material_NoM = d.id_Material_NoM
       WHERE d.id_NoFIN = ?
       ORDER BY d.id_Material_NoM`,
      [req.params.id]
    );

    const linesWithLC = calcLandedCost(lines, header.NetExtras);

    // ✅ الرصيد التراكمي التاريخي:
    //    يبحث في DionAmil عن كل الديون التي سبقت هذه الفاتورة (بحسب id)
    //    ويبحث في PayDoc عن كل المدفوعات حتى تاريخ الفاتورة
    const balance = await getAmilBalanceForInvoice(
      header.id_Amil,
      Number(req.params.id),
      header.Date_FIN           // ← تاريخ الفاتورة لتصفية المدفوعات
    );

    const paidRow = await db.queryOne(
      `SELECT COALESCE(SUM(Amount_PayDoc), 0) AS paidAmount
       FROM PayDoc_tbl
       WHERE id_Amil = ? AND Note_PayDoc = ?`,
      [header.id_Amil, `دفعة على فاتورة مشتريات #${req.params.id}`]
    );

    const isDeferred = isDeferredPayType(header.PayTypeName);
    const isCash     = isCashPayType(header.PayTypeName);
    const paidAmount = isCash
      ? r2(header.GrandTotal || 0)
      : r2(paidRow?.paidAmount || 0);
    const finalBalance = isDeferred
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
        lines           : linesWithLC,
      },
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ══════════════════════════════════════════════════════════
//  CREATE  — إنشاء الفاتورة الكاملة
// ══════════════════════════════════════════════════════════
const create = async (req, res) => {
  const {
    Date_FIN,
    id_PayType_FIN,
    Dis_FIN  = 0,
    Trans    = 0,
    Customs  = 0,
    Porter   = 0,
    SGS      = 0,
    ExportRelease    = 0,
    VehicleManifest  = 0,
    GeneralTax       = 0,
    id_Amil,
    id_Warehouse = null,
    DriverName    = "",
    DriverMobile  = "",
    VehicleNumber = "",
    PaidAmount    = 0,
    lines    = [],
  } = req.body;

  if (!id_Amil)
    return res.status(400).json({ success: false, message: "المورد (id_Amil) مطلوب" });
  if (!id_PayType_FIN)
    return res.status(400).json({ success: false, message: "نوع الدفع (id_PayType_FIN) مطلوب" });
  if (!Array.isArray(lines) || lines.length === 0)
    return res.status(400).json({ success: false, message: "يجب إضافة سطر واحد على الأقل" });

  const whId = id_Warehouse ? Number(id_Warehouse) : null;
  if (whId) {
    const wh = await db.queryOne(
      `SELECT id_Warehouse FROM Warehouses_tbl WHERE id_Warehouse = ? AND IsActive = 1`,
      [whId]
    );
    if (!wh)
      return res.status(400).json({ success: false, message: "المستودع المختار غير موجود أو غير نشط" });
  }

  const amil = await db.queryOne(`SELECT * FROM Amil_tbl WHERE id_Amil = ?`, [id_Amil]);
  if (!amil)
    return res.status(400).json({ success: false, message: `المورد id=${id_Amil} غير موجود` });

  const payType = await db.queryOne(
    `SELECT * FROM PayType_Tbl WHERE id_PayType = ?`, [id_PayType_FIN]
  );
  if (!payType)
    return res.status(400).json({ success: false, message: `نوع الدفع id=${id_PayType_FIN} غير موجود` });

  const today       = new Date().toISOString().split("T")[0];
  const invoiceDate = Date_FIN || today;
  const preparedLines = [];

  for (const line of lines) {
    const { id_Material_NoM, AmountIN = 1, PriceIN = 0, ExpairDate = null, Gift_IN = 0 } = line;

    if (!id_Material_NoM)
      return res.status(400).json({ success: false, message: "id_Material_NoM مطلوب في كل سطر" });
    if (AmountIN <= 0)
      return res.status(400).json({ success: false, message: `الكمية يجب أن تكون أكبر من صفر (المادة ${id_Material_NoM})` });

    const mat = await db.queryOne(
      `SELECT id_Material_NoM, MaterialName, "Cost Price" AS CostPrice
       FROM Materials_tbl WHERE id_Material_NoM = ?`,
      [id_Material_NoM]
    );
    if (!mat)
      return res.status(400).json({ success: false, message: `المادة id=${id_Material_NoM} غير موجودة` });

    const stock = await db.queryOne(
      `SELECT COALESCE(QuantityOnHand, 0) AS qty FROM Stock_tbl WHERE id_Material_NoM = ?`,
      [id_Material_NoM]
    );

    preparedLines.push({
      id_Material_NoM,
      MaterialName : mat.MaterialName,
      OldCostPrice : mat.CostPrice || 0,
      OldStock     : stock?.qty || 0,
      AmountIN     : Number(AmountIN),
      PriceIN      : Number(PriceIN),
      ExpairDate,
      Gift_IN      : Number(Gift_IN || 0),
    });
  }

  const netExtras   = sumLandedExtrasFromBody({ Trans, Customs, Porter, SGS, ExportRelease, VehicleManifest }) - Number(Dis_FIN);
  const linesWithLC = calcLandedCost(preparedLines, netExtras);

  try {
    const hdr = await db.run(
      `INSERT INTO FIN_tbl (Date_FIN, id_PayType_FIN, Dis_FIN, Trans, Customs, Porter, SGS, ExportRelease, VehicleManifest, GeneralTax, id_Amil, id_Warehouse, DriverName, DriverMobile, VehicleNumber)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        invoiceDate, id_PayType_FIN, Number(Dis_FIN), Number(Trans), Number(Customs), Number(Porter),
        Number(SGS), Number(ExportRelease), Number(VehicleManifest), Number(GeneralTax || 0),
        id_Amil, whId, String(DriverName || ""), String(DriverMobile || ""), String(VehicleNumber || ""),
      ]
    );
    const invoiceId = hdr.lastID;
    const linesSummary = [];

    for (const line of linesWithLC) {
      const totalQtyIn = line.AmountIN + line.Gift_IN;

      await db.run(
        `INSERT INTO DetailsIN_tbl (id_NoFIN, id_Material_NoM, AmountIN, PriceIN, ExpairDate, Gift_IN)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [invoiceId, line.id_Material_NoM, line.AmountIN, line.PriceIN, line.ExpairDate, line.Gift_IN]
      );

      const wac = wacFromInventoryValue(
        line.OldStock, line.OldCostPrice, totalQtyIn, line.InventoryValue
      );

      await db.run(
        `UPDATE Materials_tbl SET "Cost Price" = ? WHERE id_Material_NoM = ?`,
        [wac, line.id_Material_NoM]
      );

      await db.run(
        `INSERT INTO Stock_tbl (id_Material_NoM, QuantityIN, QuantityOnHand, LastUpdateDate)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(id_Material_NoM) DO UPDATE SET
           QuantityIN     = QuantityIN     + excluded.QuantityIN,
           QuantityOnHand = QuantityOnHand + excluded.QuantityIN,
           LastUpdateDate = excluded.LastUpdateDate`,
        [line.id_Material_NoM, totalQtyIn, totalQtyIn]
      );

      if (whId)
        await addWarehouseQty(line.id_Material_NoM, whId, totalQtyIn);

      await audit(req.user, "Materials_tbl", line.id_Material_NoM, "Cost Price",
        line.OldCostPrice, wac,
        `فاتورة مشتريات #${invoiceId} — Landed Cost: ${line.LandedCostPerUnit}`
      );

      linesSummary.push({
        id_Material_NoM   : line.id_Material_NoM,
        MaterialName      : line.MaterialName,
        AmountIN          : line.AmountIN,
        Gift_IN           : line.Gift_IN,
        TotalQtyIn        : totalQtyIn,
        PriceIN           : line.PriceIN,
        LandedCostShare   : line.LandedCostShare,
        LandedCostPerUnit : line.LandedCostPerUnit,
        OldCostPrice      : line.OldCostPrice,
        NewCostPrice      : wac,
      });
    }

    for (const line of linesWithLC) {
      await recalcMaterialWAC(line.id_Material_NoM);
    }

    const linesTotal = preparedLines.reduce((s, l) => s + l.AmountIN * l.PriceIN, 0);
    const grandTotal = linesTotal + sumLandedExtrasFromBody({ Trans, Customs, Porter, SGS, ExportRelease, VehicleManifest }) - Number(Dis_FIN);

    if (isDeferredPayType(payType.PayTypeName)) {
      await db.run(
        `INSERT INTO DionAmil_tbl (Amount_DionAmil, Date_DionAmil, Note_DionAmil, id_Amil)
         VALUES (?, ?, ?, ?)`,
        [grandTotal, invoiceDate, `فاتورة مشتريات رقم ${invoiceId}`, id_Amil]
      );
    }

    // دفعة جزئية سريعة — سند دفع مرتبط بالفاتورة (مع الدفع الآجل)
    const paidAmt = Math.max(0, Number(PaidAmount) || 0);
    let payDocId = null;
    let payOnInvoiceAmt = 0;
    if (paidAmt > 0 && isDeferredPayType(payType.PayTypeName)) {
      payOnInvoiceAmt = Math.min(paidAmt, grandTotal);
      const payRes = await db.run(
        `INSERT INTO PayDoc_tbl (Amount_PayDoc, Date_PayDoc, Note_PayDoc, id_Amil)
         VALUES (?, ?, ?, ?)`,
        [payOnInvoiceAmt, invoiceDate, `دفعة على فاتورة مشتريات #${invoiceId}`, id_Amil]
      );
      payDocId = payRes.lastID;
      await db.run(
        `INSERT INTO DionAmil_tbl (Amount_DionAmil, Date_DionAmil, Note_DionAmil, id_Amil)
         VALUES (?, ?, ?, ?)`,
        [-payOnInvoiceAmt, invoiceDate, `تسوية سند دفع رقم ${payDocId}`, id_Amil]
      );
    }

    if (payDocId) {
      await audit(req.user, "PayDoc_tbl", payDocId, "CREATE", null, payOnInvoiceAmt,
        `دفعة على فاتورة مشتريات #${invoiceId}`);
    }
    await audit(req.user, "FIN_tbl", invoiceId, "CREATE", null, grandTotal,
      `إنشاء فاتورة مشتريات | المورد: ${amil.AmilName} | ${payType.PayTypeName} | مواد: ${formatLinesSummary(linesWithLC, "in")}`
    );

    res.status(201).json({
      success   : true,
      message   : "تم إنشاء فاتورة المشتريات بنجاح",
      invoiceId,
      summary   : {
        invoiceDate,
        supplierName : amil.AmilName,
        paymentType  : payType.PayTypeName,
        linesCount   : linesWithLC.length,
        linesTotal   : Math.round(linesTotal * 100) / 100,
        extras       : { Trans, Customs, Porter, SGS, ExportRelease, VehicleManifest },
        discount     : Dis_FIN,
        netExtras    : Math.round(netExtras * 100) / 100,
        grandTotal   : Math.round(grandTotal * 100) / 100,
        debtAdded    : isDeferredPayType(payType.PayTypeName),
        paidAmount   : paidAmt > 0 ? Math.round(Math.min(paidAmt, grandTotal) * 100) / 100 : 0,
        payDocId     : payDocId || undefined,
      },
      lines: linesSummary,
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ══════════════════════════════════════════════════════════
//  DELETE — الحذف الكامل مع عكس كل التأثيرات
// ══════════════════════════════════════════════════════════
const remove = async (req, res) => {
  try {
    const header = await db.queryOne(
      `SELECT f.*, pt.PayTypeName
       FROM FIN_tbl f
       LEFT JOIN PayType_Tbl pt ON pt.id_PayType = f.id_PayType_FIN
       WHERE f.id_NoFIN = ?`,
      [req.params.id]
    );
    if (!header)
      return res.status(404).json({ success: false, message: "الفاتورة غير موجودة" });

    const lines = await db.query(
      `SELECT d.*, m.MaterialName, m.Band, m."Cost Price" AS CurrentCostPrice,
              COALESCE(s.QuantityOnHand, 0) AS CurrentStock
       FROM DetailsIN_tbl d
       LEFT JOIN Materials_tbl m ON m.id_Material_NoM = d.id_Material_NoM
       LEFT JOIN Stock_tbl     s ON s.id_Material_NoM = d.id_Material_NoM
       WHERE d.id_NoFIN = ?`,
      [req.params.id]
    );

    const whId = header.id_Warehouse ? Number(header.id_Warehouse) : null;

    await db.run("BEGIN TRANSACTION");

    for (const line of lines) {
      const totalQtyIn = (line.AmountIN || 0) + (line.Gift_IN || 0);

      await db.run(
        `UPDATE Stock_tbl SET
           QuantityIN     = MAX(0, QuantityIN     - ?),
           QuantityOnHand = MAX(0, QuantityOnHand - ?),
           LastUpdateDate = datetime('now')
         WHERE id_Material_NoM = ?`,
        [totalQtyIn, totalQtyIn, line.id_Material_NoM]
      );

      if (whId) {
        try {
          await subtractWarehouseQty(line.id_Material_NoM, whId, totalQtyIn);
        } catch (e) {
          return res.status(400).json({
            success: false,
            message: `تعذر عكس كمية المستودع: ${e.message}`,
          });
        }
      }

      const newStock = Math.max(0, line.CurrentStock - totalQtyIn);
      if (newStock > 0 && line.CurrentCostPrice > 0) {
        const reversedCost = (line.CurrentCostPrice * line.CurrentStock - line.PriceIN * totalQtyIn) / newStock;
        if (reversedCost > 0) {
          await db.run(
            `UPDATE Materials_tbl SET "Cost Price" = ? WHERE id_Material_NoM = ?`,
            [Math.round(reversedCost * 1000) / 1000, line.id_Material_NoM]
          );
        }
      }

      await audit(req.user, "DetailsIN_tbl", req.params.id, "DELETE_LINE",
        `${line.MaterialName || line.id_Material_NoM}: ${totalQtyIn} ${line.Band || ""}`,
        null,
        `حذف سطر فاتورة مشتريات #${req.params.id}`
      );
    }

    const payCancelled = await removeInvoicePayDocs(header.id_Amil, req.params.id);

    const debtCancelled = await removeInvoiceDebtLinks(
      "supplier", header.id_Amil, req.params.id
    );

    const linesTotal = lines.reduce((s, l) => s + (l.AmountIN || 0) * (l.PriceIN || 0), 0);
    const deletedTotal = r2(
      linesTotal
        + (header.Trans || 0) + (header.Customs || 0) + (header.Porter || 0)
        + (header.SGS || 0) + (header.ExportRelease || 0) + (header.VehicleManifest || 0)
        - (header.Dis_FIN || 0)
    );

    await db.run(`DELETE FROM DetailsIN_tbl WHERE id_NoFIN = ?`, [req.params.id]);
    await db.run(`DELETE FROM FIN_tbl        WHERE id_NoFIN = ?`, [req.params.id]);

    await audit(req.user, "FIN_tbl", req.params.id, "DELETE",
      String(deletedTotal),
      null,
      `حذف فاتورة مشتريات | المورد: ${header.id_Amil} | مواد: ${formatLinesSummary(lines, "in")}`
    );

    await db.run("COMMIT");

    res.json({
      success : true,
      message : `تم حذف فاتورة المشتريات #${req.params.id} وعكس جميع تأثيراتها`,
      reversed: {
        stockRestored : lines.length,
        debtCancelled,
        payCancelled,
      },
    });
  } catch (e) {
    await db.run("ROLLBACK").catch(() => {});
    res.status(500).json({ success: false, message: e.message });
  }
};

// ══════════════════════════════════════════════════════════
//  NAVIGATE — الملاحة (السابق / التالي) مع رصيد تاريخي دقيق
// ══════════════════════════════════════════════════════════
const navigate = async (req, res) => {
  const { id, direction } = req.params;
  try {
    let row;
    if (direction === "prev") {
      row = await db.queryOne(
        `SELECT id_NoFIN FROM FIN_tbl WHERE id_NoFIN < ? ORDER BY id_NoFIN DESC LIMIT 1`, [id]
      );
    } else if (direction === "next") {
      row = await db.queryOne(
        `SELECT id_NoFIN FROM FIN_tbl WHERE id_NoFIN > ? ORDER BY id_NoFIN ASC LIMIT 1`, [id]
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

    const header = await db.queryOne(HEADER_SELECT + " WHERE f.id_NoFIN = ?", [row.id_NoFIN]);
    const lines  = await db.query(
      `SELECT d.*, m.MaterialName, m.Barcode, m.Band,
              (d.AmountIN * d.PriceIN) AS LineTotal
       FROM DetailsIN_tbl d
       LEFT JOIN Materials_tbl m ON m.id_Material_NoM = d.id_Material_NoM
       WHERE d.id_NoFIN = ?`,
      [row.id_NoFIN]
    );

    // ✅ الرصيد التراكمي التاريخي للمورد للفاتورة المُنقَل إليها
    const balance = await getAmilBalanceForInvoice(
      header.id_Amil,
      Number(row.id_NoFIN),
      header.Date_FIN
    );

    const paidRow = await db.queryOne(
      `SELECT COALESCE(SUM(Amount_PayDoc), 0) AS paidAmount
       FROM PayDoc_tbl
       WHERE id_Amil = ? AND Note_PayDoc = ?`,
      [header.id_Amil, `دفعة على فاتورة مشتريات #${row.id_NoFIN}`]
    );

    res.json({
      success   : true,
      direction,
      data      : {
        ...header,
        previousBalance : balance.previousBalance,
        finalBalance    : balance.finalBalance,
        thisInvoiceDebt : balance.thisInvoiceDebt,
        paidAmount      : paidRow?.paidAmount || 0,
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
      db.queryOne(`SELECT id_NoFIN FROM FIN_tbl ORDER BY id_NoFIN ASC  LIMIT 1`),
      db.queryOne(`SELECT id_NoFIN FROM FIN_tbl ORDER BY id_NoFIN DESC LIMIT 1`),
    ]);
    res.json({
      success      : true,
      firstInvoice : first?.id_NoFIN || null,
      lastInvoice  : last?.id_NoFIN  || null,
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ══════════════════════════════════════════════════════════
//  GET LANDED COST PREVIEW  — معاينة قبل الحفظ
//  POST /api/invoices-in/preview-landed-cost
// ══════════════════════════════════════════════════════════
const previewLandedCost = async (req, res) => {
  const { Trans = 0, Customs = 0, Porter = 0, SGS = 0, ExportRelease = 0, VehicleManifest = 0, Dis_FIN = 0, lines = [] } = req.body;

  if (!lines.length)
    return res.status(400).json({ success: false, message: "أدخل الأسطر أولاً" });

  const netExtras  = sumLandedExtrasFromBody({ Trans, Customs, Porter, SGS, ExportRelease, VehicleManifest }) - Number(Dis_FIN);
  const linesTotal = lines.reduce((s, l) => s + (l.AmountIN || 1) * (l.PriceIN || 0), 0);
  const grandTotal = linesTotal + netExtras;

  const preview = calcLandedCost(
    lines.map((l) => ({ ...l, AmountIN: Number(l.AmountIN || 1), PriceIN: Number(l.PriceIN || 0) })),
    netExtras
  );

  res.json({
    success : true,
    summary : {
      linesTotal : Math.round(linesTotal * 100) / 100,
      netExtras  : Math.round(netExtras  * 100) / 100,
      grandTotal : Math.round(grandTotal * 100) / 100,
    },
    lines   : preview.map((l) => ({
      id_Material_NoM   : l.id_Material_NoM,
      AmountIN          : l.AmountIN,
      PriceIN           : l.PriceIN,
      Gift_IN           : l.Gift_IN || 0,
      LineTotal         : Math.round((l.LineTotal ?? l.AmountIN * l.PriceIN) * 100) / 100,
      LandedCostShare   : Math.round(l.LandedCostShare  * 100) / 100,
      LandedCostPerUnit : Math.round(l.LandedCostPerUnit * 100) / 100,
    })),
  });
};

module.exports = {
  getAll,
  getOne,
  create,
  remove,
  navigate,
  getFirstLast,
  previewLandedCost,
};
