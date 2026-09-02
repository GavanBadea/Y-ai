// ============================================================
//  controllers/fRetern.controller.js  —  نظام المرتجعات
//
//  FRetern_tbl (Header) + DetailsRetern_tbl (Lines)
//
//  نوعان من المرتجعات:
//  ┌─────────────────────────────────────────────────────┐
//  │  CUSTOMER  (من زبون — مرتجع مبيعات)                │
//  │   • يزيد المخزون  (Stock_tbl ↑)                    │
//  │   • ينقص دين الزبون (DionZabon_tbl ↓)             │
//  │   • السعر الافتراضي: آخر سعر بيع لنفس الزبون      │
//  ├─────────────────────────────────────────────────────┤
//  │  SUPPLIER  (لمورد — مرتجع مشتريات)                 │
//  │   • ينقص المخزون  (Stock_tbl ↓)                    │
//  │   • ينقص ديننا للمورد (DionAmil_tbl ↓)            │
//  │   • السعر الافتراضي: Cost Price من Materials_tbl   │
//  └─────────────────────────────────────────────────────┘
//
//  السعر قابل للتعديل يدوياً في كلا النوعين (Override)
//  القيمة المخصومة = السعر المعدّل × الكمية المرجوعة
// ============================================================
const db = require("../db");
const rPrice = (n) => Math.round(+n || 0); // ✅ تقريب السعر لعدد صحيح

// ──────────────────────────────────────────────────────────
//  helper — AuditLog
// ──────────────────────────────────────────────────────────
async function audit(user, table, recordId, field, oldVal, newVal, notes = "") {
  try {
    await db.run(
      `INSERT INTO AuditLog_tbl
         (id_User, UserName, TableName, RecordID, FieldName, OldValue, NewValue, Notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user?.id_User  || 0,
        user?.UserName || "System",
        table, recordId, field,
        String(oldVal ?? ""),
        String(newVal ?? ""),
        notes,
      ]
    );
  } catch { /* لا نوقف العملية */ }
}

// ──────────────────────────────────────────────────────────
//  helper — السعر الافتراضي حسب نوع المرتجع
//
//  CUSTOMER → آخر سعر بيع لهذا الزبون لهذه المادة
//             (من DetailsOUT_tbl) أو LastSellPrice احتياطاً
//  SUPPLIER → Cost Price من Materials_tbl
// ──────────────────────────────────────────────────────────
async function getDefaultReturnPrice(type, id_Material_NoM, id_Party) {
  if (type === "CUSTOMER") {
    // آخر سعر بيع لهذا الزبون لهذه المادة
    const lastSale = await db.queryOne(
      `SELECT d.PriceOUT
       FROM DetailsOUT_tbl d
       JOIN FOUT_tbl f ON f.id_NoFOUT = d.id_NoFOUT
       WHERE d.id_Material_NoM = ? AND f.id_Zabon = ?
       ORDER BY f.Date_FOUT DESC, f.id_NoFOUT DESC
       LIMIT 1`,
      [id_Material_NoM, id_Party]
    );
    if (lastSale) return { price: lastSale.PriceOUT, source: "lastSalePrice" };

    // احتياط: LastSellPrice من جدول الأسعار
    const sp = await db.queryOne(
      `SELECT COALESCE(LastSellPrice, 0) AS p
       FROM SellPrice_tbl WHERE id_Material_NoM = ?`,
      [id_Material_NoM]
    );
    return { price: sp?.p || 0, source: "lastSellPrice_fallback" };
  }

  // SUPPLIER → Cost Price من المواد
  const mat = await db.queryOne(
    `SELECT COALESCE("Cost Price", 0) AS p FROM Materials_tbl WHERE id_Material_NoM = ?`,
    [id_Material_NoM]
  );
  return { price: mat?.p || 0, source: "costPrice" };
}

async function assertReturnSourceMatchesParty(returnType, id_Material_NoM, id_Party, partyName = "") {
  if (returnType === "CUSTOMER") {
    const row = await db.queryOne(
      `SELECT 1
       FROM DetailsOUT_tbl d
       JOIN FOUT_tbl f ON f.id_NoFOUT = d.id_NoFOUT
       WHERE f.id_Zabon = ? AND d.id_Material_NoM = ?
       LIMIT 1`,
      [id_Party, id_Material_NoM]
    );
    if (!row) {
      throw new Error(`المادة الحالية لم تُبع للزبون ${partyName || id_Party}`);
    }
    return;
  }

  const row = await db.queryOne(
    `SELECT 1
     FROM DetailsIN_tbl d
     JOIN FIN_tbl f ON f.id_NoFIN = d.id_NoFIN
     WHERE f.id_Amil = ? AND d.id_Material_NoM = ?
     LIMIT 1`,
    [id_Party, id_Material_NoM]
  );
  if (!row) {
    throw new Error(`المادة الحالية لم تُشترَ من المورد ${partyName || id_Party}`);
  }
}

// ──────────────────────────────────────────────────────────
//  BASE SELECT — رأس سند الإرجاع مع المجاميع
// ──────────────────────────────────────────────────────────
const HEADER_SELECT = `
  SELECT
    r.id_NoFRetern,
    r.Date_FRetern,
    r.Note_FRetern,
    r.DriverName_R,
    r.DriverMobile_R,
    r.VehicleNumber_R,
    r.ReturnType,
    r.id_Party,

    -- بيانات الطرف (زبون أو مورد)
    CASE r.ReturnType
      WHEN 'CUSTOMER' THEN z.ZabonName
      WHEN 'SUPPLIER' THEN a.AmilName
    END AS PartyName,

    -- إجمالي قيمة المرتجع
    COALESCE((
      SELECT SUM(d.AmountOUT * d.PriceOUT)
      FROM DetailsRetern_tbl d WHERE d.id_NoFRetern = r.id_NoFRetern
    ), 0)  AS TotalValue,

    -- عدد الأسطر
    (SELECT COUNT(*) FROM DetailsRetern_tbl d
     WHERE d.id_NoFRetern = r.id_NoFRetern) AS ItemCount

  FROM FRetern_tbl r
  LEFT JOIN Zabon_tbl z ON z.id_Zabon = r.id_Party AND r.ReturnType = 'CUSTOMER'
  LEFT JOIN Amil_tbl  a ON a.id_Amil  = r.id_Party AND r.ReturnType = 'SUPPLIER'
`;

// ══════════════════════════════════════════════════════════
//  GET PRICE DEFAULTS  —  جلب السعر الافتراضي
//  GET /api/returns/price-default?type=&id_Material_NoM=&id_Party=
// ══════════════════════════════════════════════════════════
const getPriceDefault = async (req, res) => {
  const { type, id_Material_NoM, id_Party } = req.query;

  if (!type || !id_Material_NoM)
    return res.status(400).json({
      success: false,
      message: "type (CUSTOMER|SUPPLIER) و id_Material_NoM مطلوبان",
    });

  if (!["CUSTOMER", "SUPPLIER"].includes(type))
    return res.status(400).json({
      success: false,
      message: "type يجب أن يكون CUSTOMER أو SUPPLIER",
    });

  try {
    const mat = await db.queryOne(
      `SELECT
         m.id_Material_NoM, m.MaterialName, m.Band, m."Cost Price" AS CostPrice,
         c.CatiguaryName,
         COALESCE(s.QuantityOnHand, 0) AS QuantityOnHand,
         COALESCE(sp.LastSellPrice, 0) AS LastSellPrice,
         COALESCE(sp.SellPrice1, 0)    AS SellPrice1,
         COALESCE(sp.SellPrice2, 0)    AS SellPrice2,
         COALESCE(sp.SellPrice3, 0)    AS SellPrice3,
         COALESCE(sp.SellPrice4, 0)    AS SellPrice4,
         COALESCE(sp.SellPrice5, 0)    AS SellPrice5
       FROM Materials_tbl m
       LEFT JOIN Catiguary_tbl         c  ON c.id_Catiguary    = m.id_Catiguary
       LEFT JOIN Stock_tbl             s  ON s.id_Material_NoM  = m.id_Material_NoM
       LEFT JOIN SellPrice_tbl sp ON sp.id_Material_NoM = m.id_Material_NoM
       WHERE m.id_Material_NoM = ?`,
      [id_Material_NoM]
    );
    if (!mat)
      return res.status(404).json({ success: false, message: "المادة غير موجودة" });

    const { price, source } = await getDefaultReturnPrice(type, id_Material_NoM, id_Party);

    res.json({
      success      : true,
      material     : mat,
      returnType   : type,
      defaultPrice : price,
      priceSource  : source,
      note         : "يمكن تغيير السعر عند إنشاء المرتجع (PriceOUT في كل سطر)",
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ══════════════════════════════════════════════════════════
//  GET ALL  —  قائمة سندات الإرجاع
//  ?type= &id_Party= &from= &to= &page= &limit=
// ══════════════════════════════════════════════════════════
const getAll = async (req, res) => {
  try {
    const { type, id_Party, from, to, page = 1, limit = 50 } = req.query;

    let sql = HEADER_SELECT + " WHERE 1=1";
    const p = [];

    if (type)     { sql += " AND r.ReturnType = ?";      p.push(type);     }
    if (id_Party) { sql += " AND r.id_Party = ?";        p.push(id_Party); }
    if (from)     { sql += " AND r.Date_FRetern >= ?";   p.push(from);     }
    if (to)       { sql += " AND r.Date_FRetern <= ?";   p.push(to);       }

    sql += " ORDER BY r.Date_FRetern DESC, r.id_NoFRetern DESC";

    // إجمالي للـ pagination
    const countSql = `SELECT COUNT(*) AS total FROM FRetern_tbl r WHERE 1=1
      ${type     ? " AND r.ReturnType = '"  + type     + "'" : ""}
      ${id_Party ? " AND r.id_Party = "     + id_Party       : ""}
      ${from     ? " AND r.Date_FRetern >= '" + from + "'"   : ""}
      ${to       ? " AND r.Date_FRetern <= '" + to   + "'"   : ""}`;
    const countRow = await db.queryOne(countSql);

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
//  GET ONE  —  سند كامل مع الأسطر والتأثيرات المالية
// ══════════════════════════════════════════════════════════
const getOne = async (req, res) => {
  try {
    const header = await db.queryOne(
      HEADER_SELECT + " WHERE r.id_NoFRetern = ?",
      [req.params.id]
    );
    if (!header)
      return res.status(404).json({ success: false, message: "سند الإرجاع غير موجود" });

    const lines = await db.query(
      `SELECT
         d.id_NoFRetern,
         d.id_Material_NoM,
         d.AmountOUT          AS AmountReturn,
         d.PriceOUT           AS PriceReturn,
         d.ReturnReason,
         (d.AmountOUT * d.PriceOUT) AS LineTotal,
         m.MaterialName,
         m.Barcode,
         m.Band,
         m."Cost Price"       AS CostPrice,
         COALESCE(s.QuantityOnHand, 0) AS CurrentStock
       FROM DetailsRetern_tbl d
       LEFT JOIN Materials_tbl m ON m.id_Material_NoM = d.id_Material_NoM
       LEFT JOIN Stock_tbl     s ON s.id_Material_NoM = d.id_Material_NoM
       WHERE d.id_NoFRetern = ?
       ORDER BY d.id_Material_NoM`,
      [req.params.id]
    );

    res.json({ success: true, data: { ...header, lines } });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ══════════════════════════════════════════════════════════
//  CREATE  —  إنشاء سند إرجاع
//
//  Body:
//  {
//    ReturnType      : "CUSTOMER" | "SUPPLIER",
//    id_Party        : id_Zabon أو id_Amil,
//    Date_FRetern    : "2026-04-18",   (اختياري — اليوم افتراضياً)
//    Note_FRetern    : "...",           (اختياري)
//    DriverName_R    : "...",           (اختياري)
//    DriverMobile_R  : "...",           (اختياري)
//    VehicleNumber_R : "...",           (اختياري)
//    lines: [
//      {
//        id_Material_NoM : 5,
//        AmountReturn    : 10,
//        PriceOUT        : 45000   // اختياري — إذا لم يُرسَل يُجلب تلقائياً
//      }
//    ]
//  }
// ══════════════════════════════════════════════════════════
const create = async (req, res) => {
  const {
    ReturnType,
    id_Party,
    Date_FRetern    = null,
    Note_FRetern    = "",
    DriverName_R    = "",
    DriverMobile_R  = "",
    VehicleNumber_R = "",
    lines           = [],
  } = req.body;

  // ── فحص الصلاحيات (المدير له كل الصلاحيات دائماً) ──────
  if (req.user && !req.user.isBootstrap && Number(req.user.id_Roles) !== 1) {
    if (ReturnType === "CUSTOMER" && !req.user.can_add_sales)
      return res.status(403).json({ success: false, message: "ليس لديك صلاحية إنشاء مرتجعات المبيعات (can_add_sales)" });
    if (ReturnType === "SUPPLIER" && !req.user.can_add_purchase)
      return res.status(403).json({ success: false, message: "ليس لديك صلاحية إنشاء مرتجعات المشتريات (can_add_purchase)" });
  }

  // ── التحقق الأساسي ──────────────────────────────────────
  if (!ReturnType || !["CUSTOMER", "SUPPLIER"].includes(ReturnType))
    return res.status(400).json({
      success : false,
      message : "ReturnType مطلوب: CUSTOMER (مرتجع زبون) أو SUPPLIER (مرتجع مورد)",
    });
  if (!id_Party)
    return res.status(400).json({
      success : false,
      message : ReturnType === "CUSTOMER"
        ? "id_Party = id_Zabon مطلوب لمرتجع الزبون"
        : "id_Party = id_Amil مطلوب لمرتجع المورد",
    });
  if (!lines.length)
    return res.status(400).json({ success: false, message: "يجب إضافة سطر واحد على الأقل" });

  // ── التحقق من وجود الطرف (زبون أو مورد) ─────────────
  let party;
  if (ReturnType === "CUSTOMER") {
    party = await db.queryOne(`SELECT id_Zabon AS id, ZabonName AS name FROM Zabon_tbl WHERE id_Zabon = ?`, [id_Party]);
    if (!party) return res.status(400).json({ success: false, message: `الزبون id=${id_Party} غير موجود` });
  } else {
    party = await db.queryOne(`SELECT id_Amil AS id, AmilName AS name FROM Amil_tbl WHERE id_Amil = ?`, [id_Party]);
    if (!party) return res.status(400).json({ success: false, message: `المورد id=${id_Party} غير موجود` });
  }

  // ── تحضير الأسطر مع جلب السعر الافتراضي ─────────────
  const today       = new Date().toISOString().split("T")[0];
  const returnDate  = Date_FRetern || today;
  const preparedLines = [];

  for (const line of lines) {
    const { id_Material_NoM, AmountReturn } = line;
    // السعر المُرسَل من الواجهة (Override) — أو null لجلبه تلقائياً
    let PriceOUT = line.PriceOUT !== undefined ? rPrice(line.PriceOUT) : null;

    if (!id_Material_NoM)
      return res.status(400).json({ success: false, message: "id_Material_NoM مطلوب في كل سطر" });
    if (!AmountReturn || Number(AmountReturn) <= 0)
      return res.status(400).json({
        success: false,
        message: `الكمية يجب أن تكون أكبر من صفر (المادة ${id_Material_NoM})`,
      });

    const mat = await db.queryOne(
      `SELECT id_Material_NoM, MaterialName, Band, "Cost Price" AS CostPrice
       FROM Materials_tbl WHERE id_Material_NoM = ?`,
      [id_Material_NoM]
    );
    if (!mat)
      return res.status(400).json({ success: false, message: `المادة id=${id_Material_NoM} غير موجودة` });

    const stock = await db.queryOne(
      `SELECT COALESCE(QuantityOnHand, 0) AS qty FROM Stock_tbl WHERE id_Material_NoM = ?`,
      [id_Material_NoM]
    );
    const currentQty = stock?.qty || 0;

    try {
      await assertReturnSourceMatchesParty(ReturnType, id_Material_NoM, id_Party, party.name);
    } catch (e) {
      return res.status(400).json({ success: false, message: e.message });
    }

    // جلب السعر الافتراضي إذا لم يُرسَل
    let priceSource = "manual";
    if (PriceOUT === null) {
      const def  = await getDefaultReturnPrice(ReturnType, id_Material_NoM, id_Party);
      PriceOUT   = def.price;
      priceSource = def.source;
    }

    // تحذير: مرتجع مورد ينقص المخزون — تحقق من عدم الوصول لسالب كبير
    const stockAfter = ReturnType === "CUSTOMER"
      ? currentQty + Number(AmountReturn)
      : currentQty - Number(AmountReturn);

    preparedLines.push({
      id_Material_NoM   : Number(id_Material_NoM),
      MaterialName      : mat.MaterialName,
      Band              : mat.Band,
      CostPrice         : mat.CostPrice,
      AmountReturn      : Number(AmountReturn),
      PriceOUT,
      ReturnReason      : line.ReturnReason || "",
      LineTotal         : Number(AmountReturn) * PriceOUT,
      priceSource,
      CurrentQty        : currentQty,
      StockAfter        : stockAfter,
    });
  }

  // ── الإجمالي ─────────────────────────────────────────
  const totalValue = preparedLines.reduce((s, l) => s + l.LineTotal, 0);

  // ══════════════════════════════════════════════════════
  //  تنفيذ العمليات داخل Transaction
  // ══════════════════════════════════════════════════════
  try {
    await db.run("BEGIN TRANSACTION");

    // 1️⃣  رأس سند الإرجاع
    const hdr = await db.run(
      `INSERT INTO FRetern_tbl
         (Date_FRetern, Note_FRetern, DriverName_R, DriverMobile_R,
          VehicleNumber_R, ReturnType, id_Party)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [returnDate, Note_FRetern, DriverName_R, DriverMobile_R,
       VehicleNumber_R, ReturnType, id_Party]
    );
    const returnId = hdr.lastID;

    for (const line of preparedLines) {
      // 2️⃣  سطر التفصيل (مع سبب المرتجع الاختياري)
      await db.run(
        `INSERT INTO DetailsRetern_tbl
           (id_NoFRetern, id_Material_NoM, AmountOUT, PriceOUT, ReturnReason)
         VALUES (?, ?, ?, ?, ?)`,
        [returnId, line.id_Material_NoM, line.AmountReturn, line.PriceOUT, line.ReturnReason || ""]
      );

      if (ReturnType === "CUSTOMER") {
        // 3️⃣  CUSTOMER: زيادة المخزون
        await db.run(
          `INSERT INTO Stock_tbl
             (id_Material_NoM, QuantityReturn, QuantityOnHand, LastUpdateDate)
           VALUES (?, ?, ?, datetime('now'))
           ON CONFLICT(id_Material_NoM) DO UPDATE SET
             QuantityReturn = QuantityReturn + excluded.QuantityReturn,
             QuantityOnHand = QuantityOnHand + excluded.QuantityReturn,
             LastUpdateDate = excluded.LastUpdateDate`,
          [line.id_Material_NoM, line.AmountReturn, line.AmountReturn]
        );
      } else {
        // 3️⃣  SUPPLIER: نقصان المخزون
        await db.run(
          `UPDATE Stock_tbl SET
             QuantityReturn = QuantityReturn + ?,
             QuantityOnHand = QuantityOnHand - ?,
             LastUpdateDate = datetime('now')
           WHERE id_Material_NoM = ?`,
          [line.AmountReturn, line.AmountReturn, line.id_Material_NoM]
        );
      }

      // 4️⃣  AuditLog لكل سطر
      await audit(
        req.user, "Stock_tbl", line.id_Material_NoM,
        ReturnType === "CUSTOMER" ? "QuantityOnHand ++" : "QuantityOnHand --",
        line.CurrentQty, line.StockAfter,
        `سند إرجاع #${returnId} | ${ReturnType} | ${line.AmountReturn} ${line.Band}`
      );
    }

    // 5️⃣  التأثير المالي
    if (ReturnType === "CUSTOMER") {
      // نقصان دين الزبون بقيمة المرتجع
      await db.run(
        `INSERT INTO DionZabon_tbl
           (Amount_DionZabon, Date_DionZabon, Note_DionZabon, id_Zabon)
         VALUES (?, ?, ?, ?)`,
        // قيمة سالبة = خصم من الدين
        [-totalValue, returnDate,
         `مرتجع مبيعات رقم ${returnId}`, id_Party]
      );
    } else {
      // نقصان ديننا للمورد بقيمة المرتجع
      await db.run(
        `INSERT INTO DionAmil_tbl
           (Amount_DionAmil, Date_DionAmil, Note_DionAmil, id_Amil)
         VALUES (?, ?, ?, ?)`,
        // قيمة سالبة = خصم من ديننا
        [-totalValue, returnDate,
         `مرتجع مشتريات رقم ${returnId}`, id_Party]
      );
    }

    // 6️⃣  AuditLog للسند
    await audit(
      req.user, "FRetern_tbl", returnId,
      "CREATE",
      null,
      totalValue,
      `${ReturnType === "CUSTOMER" ? "مرتجع زبون" : "مرتجع مورد"} | ${party.name} | ${preparedLines.length} أصناف | القيمة: ${totalValue}`
    );

    await db.run("COMMIT");

    res.status(201).json({
      success   : true,
      message   : `تم إنشاء سند الإرجاع بنجاح`,
      returnId,
      summary   : {
        returnType   : ReturnType,
        partyName    : party.name,
        returnDate,
        itemsCount   : preparedLines.length,
        totalValue   : Math.round(totalValue * 100) / 100,
        // التأثير المالي
        financialImpact: ReturnType === "CUSTOMER"
          ? { table: "DionZabon_tbl", effect: `خصم ${Math.round(totalValue*100)/100} من دين الزبون` }
          : { table: "DionAmil_tbl",  effect: `خصم ${Math.round(totalValue*100)/100} من ديننا للمورد` },
        // التأثير المخزني
        stockImpact: ReturnType === "CUSTOMER"
          ? "زيادة المخزون"
          : "نقصان المخزون",
      },
      lines     : preparedLines.map((l) => ({
        id_Material_NoM : l.id_Material_NoM,
        MaterialName    : l.MaterialName,
        Band            : l.Band,
        AmountReturn    : l.AmountReturn,
        PriceOUT        : l.PriceOUT,
        LineTotal       : Math.round(l.LineTotal * 100) / 100,
        priceSource     : l.priceSource,
        StockAfter      : l.StockAfter,
      })),
    });
  } catch (e) {
    await db.run("ROLLBACK").catch(() => {});
    res.status(500).json({ success: false, message: e.message });
  }
};

// ══════════════════════════════════════════════════════════
//  DELETE  —  حذف كامل مع عكس جميع التأثيرات
// ══════════════════════════════════════════════════════════
const remove = async (req, res) => {
  try {
    const header = await db.queryOne(
      `SELECT * FROM FRetern_tbl WHERE id_NoFRetern = ?`, [req.params.id]
    );
    if (!header)
      return res.status(404).json({ success: false, message: "سند الإرجاع غير موجود" });

    const lines = await db.query(
      `SELECT d.*, m.MaterialName, m.Band,
              COALESCE(s.QuantityOnHand, 0) AS CurrentQty
       FROM DetailsRetern_tbl d
       LEFT JOIN Materials_tbl m ON m.id_Material_NoM = d.id_Material_NoM
       LEFT JOIN Stock_tbl     s ON s.id_Material_NoM = d.id_Material_NoM
       WHERE d.id_NoFRetern = ?`,
      [req.params.id]
    );

    await db.run("BEGIN TRANSACTION");

    for (const line of lines) {
      if (header.ReturnType === "CUSTOMER") {
        // عكس: نقصان المخزون (كان قد زاد عند الإرجاع)
        await db.run(
          `UPDATE Stock_tbl SET
             QuantityReturn = MAX(0, QuantityReturn - ?),
             QuantityOnHand = QuantityOnHand - ?,
             LastUpdateDate = datetime('now')
           WHERE id_Material_NoM = ?`,
          [line.AmountOUT, line.AmountOUT, line.id_Material_NoM]
        );
      } else {
        // عكس: زيادة المخزون (كان قد نقص عند الإرجاع)
        await db.run(
          `UPDATE Stock_tbl SET
             QuantityReturn = MAX(0, QuantityReturn - ?),
             QuantityOnHand = QuantityOnHand + ?,
             LastUpdateDate = datetime('now')
           WHERE id_Material_NoM = ?`,
          [line.AmountOUT, line.AmountOUT, line.id_Material_NoM]
        );
      }
      await audit(
        req.user, "Stock_tbl", line.id_Material_NoM,
        "REVERSED",
        line.CurrentQty,
        header.ReturnType === "CUSTOMER"
          ? line.CurrentQty - line.AmountOUT
          : line.CurrentQty + line.AmountOUT,
        `حذف سند إرجاع #${req.params.id}`
      );
    }

    // عكس التأثير المالي
    const totalValue = lines.reduce((s, l) => s + l.AmountOUT * l.PriceOUT, 0);
    if (header.ReturnType === "CUSTOMER") {
      // حذف قيد الدين السالب
      await db.run(
        `DELETE FROM DionZabon_tbl
         WHERE id_Zabon = ? AND Note_DionZabon = ?`,
        [header.id_Party, `مرتجع مبيعات رقم ${req.params.id}`]
      );
    } else {
      await db.run(
        `DELETE FROM DionAmil_tbl
         WHERE id_Amil = ? AND Note_DionAmil = ?`,
        [header.id_Party, `مرتجع مشتريات رقم ${req.params.id}`]
      );
    }

    await db.run(`DELETE FROM DetailsRetern_tbl WHERE id_NoFRetern = ?`, [req.params.id]);
    await db.run(`DELETE FROM FRetern_tbl        WHERE id_NoFRetern = ?`, [req.params.id]);

    await audit(
      req.user, "FRetern_tbl", req.params.id,
      "DELETE",
      totalValue, null,
      "حذف كامل لسند الإرجاع — تم عكس جميع التأثيرات"
    );

    await db.run("COMMIT");

    res.json({
      success  : true,
      message  : `تم حذف سند الإرجاع #${req.params.id} وعكس جميع تأثيراته`,
      reversed : {
        stockLines    : lines.length,
        financialEntry: true,
        totalReversed : Math.round(totalValue * 100) / 100,
      },
    });
  } catch (e) {
    await db.run("ROLLBACK").catch(() => {});
    res.status(500).json({ success: false, message: e.message });
  }
};

// ══════════════════════════════════════════════════════════
//  NAVIGATE  —  السابق / التالي
// ══════════════════════════════════════════════════════════
const navigate = async (req, res) => {
  const { id, direction } = req.params;
  try {
    let row;
    if (direction === "prev") {
      row = await db.queryOne(
        `SELECT id_NoFRetern FROM FRetern_tbl
         WHERE id_NoFRetern < ? ORDER BY id_NoFRetern DESC LIMIT 1`, [id]
      );
    } else if (direction === "next") {
      row = await db.queryOne(
        `SELECT id_NoFRetern FROM FRetern_tbl
         WHERE id_NoFRetern > ? ORDER BY id_NoFRetern ASC LIMIT 1`, [id]
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

    const header = await db.queryOne(
      HEADER_SELECT + " WHERE r.id_NoFRetern = ?", [row.id_NoFRetern]
    );
    const lines = await db.query(
      `SELECT d.*, m.MaterialName, m.Band, (d.AmountOUT * d.PriceOUT) AS LineTotal
       FROM DetailsRetern_tbl d
       LEFT JOIN Materials_tbl m ON m.id_Material_NoM = d.id_Material_NoM
       WHERE d.id_NoFRetern = ?`,
      [row.id_NoFRetern]
    );

    res.json({ success: true, direction, data: { ...header, lines } });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ══════════════════════════════════════════════════════════
//  BOUNDS  —  أول وآخر سند
// ══════════════════════════════════════════════════════════
const getBounds = async (_req, res) => {
  try {
    const [first, last] = await Promise.all([
      db.queryOne(`SELECT id_NoFRetern FROM FRetern_tbl ORDER BY id_NoFRetern ASC  LIMIT 1`),
      db.queryOne(`SELECT id_NoFRetern FROM FRetern_tbl ORDER BY id_NoFRetern DESC LIMIT 1`),
    ]);
    res.json({
      success      : true,
      firstReturn  : first?.id_NoFRetern || null,
      lastReturn   : last?.id_NoFRetern  || null,
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ══════════════════════════════════════════════════════════
//  GET EDIT DATA  —  للمدير فقط
// ══════════════════════════════════════════════════════════
const getEditData = async (req, res) => {
  try {
    const header = await db.queryOne(
      HEADER_SELECT + " WHERE r.id_NoFRetern = ?",
      [req.params.id]
    );
    if (!header)
      return res.status(404).json({ success: false, message: "سند الإرجاع غير موجود" });

    const lines = await db.query(
      `SELECT
         d.id_Material_NoM,
         d.AmountOUT          AS AmountReturn,
         d.PriceOUT           AS PriceReturn,
         d.ReturnReason,
         m.MaterialName,
         m.Barcode,
         m.Band,
         COALESCE(s.QuantityOnHand, 0) AS QuantityOnHand
       FROM DetailsRetern_tbl d
       LEFT JOIN Materials_tbl m ON m.id_Material_NoM = d.id_Material_NoM
       LEFT JOIN Stock_tbl     s ON s.id_Material_NoM = d.id_Material_NoM
       WHERE d.id_NoFRetern = ?
       ORDER BY d.id_Material_NoM`,
      [req.params.id]
    );

    res.json({ success: true, header, lines });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

async function reverseReturnStock(returnType, line) {
  if (returnType === "CUSTOMER") {
    await db.run(
      `UPDATE Stock_tbl SET
         QuantityReturn = MAX(0, QuantityReturn - ?),
         QuantityOnHand = QuantityOnHand - ?,
         LastUpdateDate = datetime('now')
       WHERE id_Material_NoM = ?`,
      [line.AmountOUT, line.AmountOUT, line.id_Material_NoM]
    );
  } else {
    await db.run(
      `UPDATE Stock_tbl SET
         QuantityReturn = MAX(0, QuantityReturn - ?),
         QuantityOnHand = QuantityOnHand + ?,
         LastUpdateDate = datetime('now')
       WHERE id_Material_NoM = ?`,
      [line.AmountOUT, line.AmountOUT, line.id_Material_NoM]
    );
  }
}

async function applyReturnStock(returnType, id_Material_NoM, qty) {
  if (returnType === "CUSTOMER") {
    await db.run(
      `INSERT INTO Stock_tbl
         (id_Material_NoM, QuantityReturn, QuantityOnHand, LastUpdateDate)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(id_Material_NoM) DO UPDATE SET
         QuantityReturn = QuantityReturn + excluded.QuantityReturn,
         QuantityOnHand = QuantityOnHand + excluded.QuantityReturn,
         LastUpdateDate = excluded.LastUpdateDate`,
      [id_Material_NoM, qty, qty]
    );
  } else {
    await db.run(
      `UPDATE Stock_tbl SET
         QuantityReturn = QuantityReturn + ?,
         QuantityOnHand = QuantityOnHand - ?,
         LastUpdateDate = datetime('now')
       WHERE id_Material_NoM = ?`,
      [qty, qty, id_Material_NoM]
    );
  }
}

// ══════════════════════════════════════════════════════════
//  UPDATE  —  تعديل كامل للمدير (عكس القديم + تطبيق الجديد)
// ══════════════════════════════════════════════════════════
const update = async (req, res) => {
  const returnId = Number(req.params.id);
  const {
    id_Party,
    Date_FRetern,
    Note_FRetern    = "",
    DriverName_R    = "",
    DriverMobile_R  = "",
    VehicleNumber_R = "",
    lines           = [],
  } = req.body;

  try {
    const header = await db.queryOne(
      `SELECT * FROM FRetern_tbl WHERE id_NoFRetern = ?`,
      [returnId]
    );
    if (!header)
      return res.status(404).json({ success: false, message: "سند الإرجاع غير موجود" });
    if (!lines.length)
      return res.status(400).json({ success: false, message: "يجب إضافة سطر واحد على الأقل" });

    const oldLines = await db.query(
      `SELECT * FROM DetailsRetern_tbl WHERE id_NoFRetern = ?`,
      [returnId]
    );

    const newParty = id_Party != null ? Number(id_Party) : header.id_Party;
    const newDate  = Date_FRetern || header.Date_FRetern;
    const returnType = header.ReturnType;

    if (returnType === "CUSTOMER") {
      const party = await db.queryOne(`SELECT id_Zabon FROM Zabon_tbl WHERE id_Zabon = ?`, [newParty]);
      if (!party) return res.status(400).json({ success: false, message: "الزبون غير موجود" });
    } else {
      const party = await db.queryOne(`SELECT id_Amil FROM Amil_tbl WHERE id_Amil = ?`, [newParty]);
      if (!party) return res.status(400).json({ success: false, message: "المورد غير موجود" });
    }

    const partyNameRow = returnType === "CUSTOMER"
      ? await db.queryOne(`SELECT ZabonName AS name FROM Zabon_tbl WHERE id_Zabon = ?`, [newParty])
      : await db.queryOne(`SELECT AmilName AS name FROM Amil_tbl WHERE id_Amil = ?`, [newParty]);
    const partyName = partyNameRow?.name || "";

    const preparedLines = [];
    for (const line of lines) {
      const id_Material_NoM = Number(line.id_Material_NoM);
      const AmountReturn    = Number(line.AmountReturn ?? line.AmountOUT);
      const PriceOUT        = rPrice(line.PriceOUT ?? line.PriceReturn ?? 0);

      if (!id_Material_NoM)
        return res.status(400).json({ success: false, message: "id_Material_NoM مطلوب في كل سطر" });
      if (!AmountReturn || AmountReturn <= 0)
        return res.status(400).json({ success: false, message: "الكمية يجب أن تكون أكبر من صفر" });

      const mat = await db.queryOne(
        `SELECT id_Material_NoM, MaterialName FROM Materials_tbl WHERE id_Material_NoM = ?`,
        [id_Material_NoM]
      );
      if (!mat)
        return res.status(400).json({ success: false, message: `المادة id=${id_Material_NoM} غير موجودة` });

      try {
        await assertReturnSourceMatchesParty(returnType, id_Material_NoM, newParty, partyName);
      } catch (e) {
        return res.status(400).json({ success: false, message: e.message });
      }

      preparedLines.push({
        id_Material_NoM,
        AmountReturn,
        PriceOUT,
        ReturnReason: line.ReturnReason || "",
        LineTotal: AmountReturn * PriceOUT,
      });
    }

    const totalValue = preparedLines.reduce((s, l) => s + l.LineTotal, 0);

    await db.run("BEGIN TRANSACTION");
    try {
      for (const ol of oldLines) {
        await reverseReturnStock(returnType, ol);
      }

      if (returnType === "CUSTOMER") {
        await db.run(
          `DELETE FROM DionZabon_tbl WHERE id_Zabon = ? AND Note_DionZabon = ?`,
          [header.id_Party, `مرتجع مبيعات رقم ${returnId}`]
        );
      } else {
        await db.run(
          `DELETE FROM DionAmil_tbl WHERE id_Amil = ? AND Note_DionAmil = ?`,
          [header.id_Party, `مرتجع مشتريات رقم ${returnId}`]
        );
      }

      await db.run(`DELETE FROM DetailsRetern_tbl WHERE id_NoFRetern = ?`, [returnId]);

      await db.run(
        `UPDATE FRetern_tbl SET
           Date_FRetern = ?,
           Note_FRetern = ?,
           DriverName_R = ?,
           DriverMobile_R = ?,
           VehicleNumber_R = ?,
           id_Party = ?
         WHERE id_NoFRetern = ?`,
        [newDate, Note_FRetern, DriverName_R, DriverMobile_R, VehicleNumber_R, newParty, returnId]
      );

      for (const line of preparedLines) {
        await db.run(
          `INSERT INTO DetailsRetern_tbl
             (id_NoFRetern, id_Material_NoM, AmountOUT, PriceOUT, ReturnReason)
           VALUES (?, ?, ?, ?, ?)`,
          [returnId, line.id_Material_NoM, line.AmountReturn, line.PriceOUT, line.ReturnReason]
        );
        await applyReturnStock(returnType, line.id_Material_NoM, line.AmountReturn);
      }

      if (returnType === "CUSTOMER") {
        await db.run(
          `INSERT INTO DionZabon_tbl (Amount_DionZabon, Date_DionZabon, Note_DionZabon, id_Zabon)
           VALUES (?, ?, ?, ?)`,
          [-totalValue, newDate, `مرتجع مبيعات رقم ${returnId}`, newParty]
        );
      } else {
        await db.run(
          `INSERT INTO DionAmil_tbl (Amount_DionAmil, Date_DionAmil, Note_DionAmil, id_Amil)
           VALUES (?, ?, ?, ?)`,
          [-totalValue, newDate, `مرتجع مشتريات رقم ${returnId}`, newParty]
        );
      }

      await audit(
        req.user, "FRetern_tbl", returnId,
        "UPDATE", header.id_Party, newParty,
        `تعديل سند إرجاع — ${preparedLines.length} أصناف — القيمة: ${Math.round(totalValue * 100) / 100}`
      );

      await db.run("COMMIT");
      res.json({
        success: true,
        message: "تم حفظ التعديل — تم تحديث المخزون والديون",
        returnId,
        totalValue: Math.round(totalValue * 100) / 100,
      });
    } catch (e) {
      await db.run("ROLLBACK").catch(() => {});
      throw e;
    }
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

module.exports = {
  getPriceDefault,
  getAll,
  getOne,
  getEditData,
  create,
  update,
  remove,
  navigate,
  getBounds,
};
