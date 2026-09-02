// ============================================================
//  controllers/materials.controller.js  —  المواد
//
//  التحديثات:
//   ✅ حقل Barcode (UNIQUE) في الإضافة والتعديل
//   ✅ حقل Band (الوحدة) كامل في كل العمليات
//   ✅ GET /scan/:barcode  → بحث بالباركود (لشاشة المبيعات)
//   ✅ توليد باركود تلقائي إذا لم يُرسَل عند الإضافة
//   ✅ Band يظهر في كل رد مع الكمية للواجهة الأمامية
//
//  كل GET يُدمج (JOIN):
//   • Catiguary_tbl         → CatiguaryName
//   • Type_tbl              → TypeName
//   • Stock_tbl             → QuantityOnHand + باقي الكميات
//   • SellPrice_tbl → SellPrice1..5 + LastSellPrice
//   + يحسب ProfitMarginPct تلقائياً
// ============================================================
const db = require("../db");
const { latestSlotPrice } = require("../utils/sellPriceHelpers");
const { findMaterialByScan, attachScanToMaterial } = require("../utils/materialScan");

let weightKgReady = false;
async function ensureWeightKgColumn() {
  if (weightKgReady) return;
  try {
    await db.run(`ALTER TABLE Materials_tbl ADD COLUMN WeightKg REAL DEFAULT 0`);
  } catch (e) {
    const msg = String(e.message || "");
    if (!msg.toLowerCase().includes("duplicate column")) throw e;
  }
  weightKgReady = true;
}

// ──────────────────────────────────────────────────────────
//  توليد باركود تلقائي  (EAN-13 مبسّط بصيغة MAT-timestamp)
//  يُستخدم فقط إذا لم يُرسَل باركود يدوي
// ──────────────────────────────────────────────────────────
function generateBarcode() {
  const ts     = Date.now().toString().slice(-9);   // 9 أرقام من الـ timestamp
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, "0");
  return `MAT${ts}${random}`;                        // مثال: MAT123456789042
}

// ──────────────────────────────────────────────────────────
//  BASE SELECT — يُعاد استخدامه في كل الاستعلامات
//  يشمل: الصنف، النوع، الوحدة (Band)، الباركود،
//         المخزون، الأسعار الخمسة، هامش الربح
// ──────────────────────────────────────────────────────────
const BASE = `
  SELECT
    m.id_Material_NoM,
    m.MaterialName,
    m.Barcode,
    COALESCE(m.WeightKg, 0)                 AS WeightKg,
    m.Band                                  AS Unit,
    m.Band,
    m.id_Catiguary,
    m.id_Type,
    m."Cost Price"                          AS CostPrice,

    -- الصنف والنوع
    c.CatiguaryName,
    t.TypeName,

    -- المخزون
    COALESCE(s.QuantityIN,     0)           AS QuantityIN,
    COALESCE(s.QuantityOUT,    0)           AS QuantityOUT,
    COALESCE(s.QuantityReturn, 0)           AS QuantityReturn,
    COALESCE(s.QuantityOnHand, 0)           AS QuantityOnHand,

    -- الوحدة مع الكمية (جاهز للواجهة الأمامية — مثال: "150 كارتون")
    COALESCE(s.QuantityOnHand, 0) || ' ' || m.Band AS QuantityWithUnit,

    s.LastUpdateDate                        AS StockLastUpdate,

    -- الأسعار الخمسة
    sp.SellPrice1,
    sp.SellPrice2,
    sp.SellPrice3,
    sp.SellPrice4,
    sp.SellPrice5,
    sp.LastSellPrice,

    -- هامش الربح %
    ROUND(
      CASE WHEN m."Cost Price" > 0
        THEN ((sp.LastSellPrice - m."Cost Price") / m."Cost Price") * 100
        ELSE 0
      END, 2
    )                                       AS ProfitMarginPct

  FROM Materials_tbl m
  LEFT JOIN Catiguary_tbl         c  ON c.id_Catiguary    = m.id_Catiguary
  LEFT JOIN Type_tbl              t  ON t.id_Type          = m.id_Type
  LEFT JOIN Stock_tbl             s  ON s.id_Material_NoM  = m.id_Material_NoM
  LEFT JOIN SellPrice_tbl sp ON sp.id_Material_NoM = m.id_Material_NoM
`;

// ══════════════════════════════════════════════════════════
//  GET ALL
//  ?search= &id_Catiguary= &id_Type= &lowStock= &barcode=
// ══════════════════════════════════════════════════════════
const getAll = async (req, res) => {
  try {
    await ensureWeightKgColumn();
    const { search, id_Catiguary, id_Type, lowStock, barcode } = req.query;
    let sql = BASE + " WHERE 1=1";
    const p  = [];

    if (search)       { sql += " AND m.MaterialName LIKE ?";          p.push(`%${search}%`); }
    if (id_Catiguary) { sql += " AND m.id_Catiguary = ?";             p.push(id_Catiguary);  }
    if (id_Type)      { sql += " AND m.id_Type = ?";                  p.push(id_Type);       }
    if (barcode)      { sql += " AND m.Barcode LIKE ?";               p.push(`%${barcode}%`);}
    if (lowStock !== undefined) {
      sql += " AND COALESCE(s.QuantityOnHand, 0) <= ?";
      p.push(Number(lowStock));
    }

    sql += " ORDER BY m.MaterialName";
    const rows = await db.query(sql, p);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ══════════════════════════════════════════════════════════
//  GET ONE  — بحث بالـ ID
// ══════════════════════════════════════════════════════════
const getOne = async (req, res) => {
  try {
    await ensureWeightKgColumn();
    const row = await db.queryOne(
      BASE + " WHERE m.id_Material_NoM = ?",
      [req.params.id]
    );
    if (!row) return res.status(404).json({ success: false, message: "المادة غير موجودة" });
    res.json({ success: true, data: row });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ══════════════════════════════════════════════════════════
//  SCAN BARCODE  — GET /api/materials/scan/:barcode
//
//  مسار خاص لشاشة المبيعات — مسح الباركود يُرجع:
//   • بيانات المادة الكاملة
//   • الكمية المتاحة مع الوحدة (مثال: "150 كارتون")
//   • الأسعار الخمسة جاهزة للاختيار
// ══════════════════════════════════════════════════════════
const scanBarcode = async (req, res) => {
  try {
    await ensureWeightKgColumn();
    const found = await findMaterialByScan(db, req.params.barcode, {
      barcodeSql: BASE + " WHERE CAST(m.Barcode AS TEXT) = CAST(? AS TEXT)",
      idSql: BASE + " WHERE m.id_Material_NoM = ?",
    });

    if (!found) {
      return res.status(404).json({
        success : false,
        message : `لم يتم العثور على مادة بالباركود: ${req.params.barcode}`,
        barcode : req.params.barcode,
      });
    }

    const row = attachScanToMaterial(found.row, found.scan);

    // تحذير إذا كانت الكمية صفر
    const warning = row.QuantityOnHand <= 0
      ? `⚠️ المادة "${row.MaterialName}" غير متوفرة في المخزون`
      : null;

    res.json({
      success : true,
      warning,
      data    : row,
      scan    : found.scan,
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ══════════════════════════════════════════════════════════
//  CREATE
//  Body: { MaterialName, Barcode?, Band, id_Catiguary, id_Type, PosPrice? }
// ══════════════════════════════════════════════════════════
const create = async (req, res) => {
  let {
    MaterialName,
    Barcode        = null,
    Band           = "كارتون",
    id_Catiguary   = 0,
    id_Type        = 0,
    PosPrice       = 0,
    WeightKg       = 0,
  } = req.body;

  const posPrice = Math.max(0, Number(PosPrice ?? 0) || 0);

  // ── التحقق الأساسي ─────────────────────────────────────
  if (!MaterialName)
    return res.status(400).json({
      success  : false,
      message  : "اسم المادة (MaterialName) مطلوب",
      required : ["MaterialName"],
    });

  if (!Band || Band.trim() === "")
    return res.status(400).json({
      success : false,
      message : "حقل الوحدة (Band) مطلوب — مثال: كارتون، قطعة، كيلو",
    });

  // ── توليد باركود تلقائي إذا لم يُرسَل ─────────────────
  let autoBarcode = false;
  if (!Barcode || Barcode.trim() === "") {
    Barcode     = generateBarcode();
    autoBarcode = true;
  }

  // ── التحقق من الصنف والنوع ────────────────────────────
  if (Number(id_Catiguary) !== 0) {
    const cat = await db.queryOne(
      `SELECT id_Catiguary FROM Catiguary_tbl WHERE id_Catiguary = ?`, [id_Catiguary]
    );
    if (!cat)
      return res.status(400).json({
        success : false,
        message : `الصنف id=${id_Catiguary} غير موجود — راجع GET /api/common/categories`,
      });
  }
  if (Number(id_Type) !== 0) {
    const typ = await db.queryOne(
      `SELECT id_Type FROM Type_tbl WHERE id_Type = ?`, [id_Type]
    );
    if (!typ)
      return res.status(400).json({
        success : false,
        message : `النوع id=${id_Type} غير موجود — راجع GET /api/common/types`,
      });
  }

  try {
    await ensureWeightKgColumn();
    // 1️⃣ إدراج المادة
    const weightKg = Math.max(0, Number(WeightKg ?? 0) || 0);
    const mat = await db.run(
      `INSERT INTO Materials_tbl
         (MaterialName, Barcode, Band, id_Catiguary, id_Type, "Cost Price", WeightKg)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [MaterialName, Barcode, Band.trim(), id_Catiguary, id_Type, 0, weightKg]
    );
    const id = mat.lastID;

    // 2️⃣ سجل المخزون (يبدأ بصفر)
    await db.run(`INSERT INTO Stock_tbl (id_Material_NoM) VALUES (?)`, [id]);

    // 3️⃣ سعر نقاط البيع — LastSellPrice + SellPrice1 ليتوافق POS مع خانات الأسعار
    await db.run(
      `INSERT INTO SellPrice_tbl
         (id_Material_NoM, SellPrice1, SellPrice2, SellPrice3,
          SellPrice4, SellPrice5, LastSellPrice)
       VALUES (?, ?, 0, 0, 0, 0, ?)`,
      [id, posPrice, posPrice]
    );

    res.status(201).json({
      success      : true,
      message      : "تم إضافة المادة مع سجل المخزون والأسعار",
      id,
      Barcode,
      autoBarcode,  // true = تم التوليد تلقائياً
      Band,
    });
  } catch (e) {
    if (e.message?.includes("UNIQUE") && e.message?.includes("Barcode"))
      return res.status(409).json({
        success : false,
        message : `الباركود "${Barcode}" مستخدم لمادة أخرى — أدخل باركوداً مختلفاً`,
      });
    res.status(500).json({ success: false, message: e.message });
  }
};

// ══════════════════════════════════════════════════════════
//  UPDATE
//  يسمح بتعديل: MaterialName, Barcode, Band, id_Catiguary, id_Type, PosPrice
//  Cost Price يُحدَّث فقط من فواتير الشراء (LC)
// ══════════════════════════════════════════════════════════
const update = async (req, res) => {
  const {
    MaterialName,
    Barcode,
    Band,
    id_Catiguary,
    id_Type,
    PosPrice,
    WeightKg,
  } = req.body;

  // التحقق من Barcode إذا أُرسل
  if (Barcode !== undefined && Barcode !== null && Barcode.trim() === "")
    return res.status(400).json({
      success : false,
      message : "لا يمكن حفظ باركود فارغ — أرسل قيمة أو null لإزالته",
    });

  // التحقق من Band إذا أُرسل
  if (Band !== undefined && (!Band || Band.trim() === ""))
    return res.status(400).json({
      success : false,
      message : "الوحدة (Band) لا يمكن أن تكون فارغة",
    });

  try {
    await ensureWeightKgColumn();
    const weightKgUpd = Math.max(0, Number(WeightKg ?? 0) || 0);
    await db.run(
      `UPDATE Materials_tbl
       SET MaterialName  = COALESCE(?, MaterialName),
           Barcode       = COALESCE(?, Barcode),
           Band          = COALESCE(?, Band),
           id_Catiguary  = COALESCE(?, id_Catiguary),
           id_Type       = COALESCE(?, id_Type),
           WeightKg      = ?
       WHERE id_Material_NoM = ?`,
      [MaterialName, Barcode, Band, id_Catiguary, id_Type, weightKgUpd, req.params.id]
    );

    if (PosPrice !== undefined) {
      const posPrice = Math.max(0, Number(PosPrice) || 0);
      const priceRes = await db.run(
        `UPDATE SellPrice_tbl SET LastSellPrice = ?, SellPrice1 = ? WHERE id_Material_NoM = ?`,
        [posPrice, posPrice, req.params.id]
      );
      if (!priceRes.changes) {
        await db.run(
          `INSERT INTO SellPrice_tbl
             (id_Material_NoM, SellPrice1, SellPrice2, SellPrice3, SellPrice4, SellPrice5, LastSellPrice)
           VALUES (?, ?, 0, 0, 0, 0, ?)`,
          [req.params.id, posPrice, posPrice]
        );
      }
    }

    // ── إذا لم يكن للمادة سجل مخزون بعد → أنشئ واحداً ──
    const stockExists = await db.queryOne(
      `SELECT id_Material_NoM FROM Stock_tbl WHERE id_Material_NoM = ?`,
      [req.params.id]
    );
    if (!stockExists) {
      await db.run(`INSERT INTO Stock_tbl (id_Material_NoM) VALUES (?)`, [req.params.id]);
    }

    // أعد المادة المحدّثة كاملة
    const updated = await db.queryOne(
      BASE + " WHERE m.id_Material_NoM = ?",
      [req.params.id]
    );
    if (!updated)
      return res.status(404).json({ success: false, message: "المادة غير موجودة" });

    res.json({ success: true, message: "تم التعديل بنجاح", data: updated });
  } catch (e) {
    if (e.message?.includes("UNIQUE") && e.message?.includes("Barcode"))
      return res.status(409).json({
        success : false,
        message : `الباركود "${Barcode}" مستخدم لمادة أخرى`,
      });
    res.status(500).json({ success: false, message: e.message });
  }
};

// ══════════════════════════════════════════════════════════
//  REMOVE — يمنع الحذف إذا توجد حركات مرتبطة
// ══════════════════════════════════════════════════════════
const remove = async (req, res) => {
  try {
    const [inRows, outRows, retRows] = await Promise.all([
      db.queryOne(`SELECT COUNT(*) AS cnt FROM DetailsIN_tbl     WHERE id_Material_NoM = ?`, [req.params.id]),
      db.queryOne(`SELECT COUNT(*) AS cnt FROM DetailsOUT_tbl    WHERE id_Material_NoM = ?`, [req.params.id]),
      db.queryOne(`SELECT COUNT(*) AS cnt FROM DetailsRetern_tbl WHERE id_Material_NoM = ?`, [req.params.id]),
    ]);

    const total = inRows.cnt + outRows.cnt + retRows.cnt;
    if (total > 0)
      return res.status(409).json({
        success : false,
        message : "لا يمكن حذف المادة لوجود حركات مرتبطة بها",
        details : {
          purchaseLines : inRows.cnt,
          salesLines    : outRows.cnt,
          returnLines   : retRows.cnt,
        },
      });

    // حذف السجلات المرتبطة أولاً
    await db.run(`DELETE FROM Stock_tbl             WHERE id_Material_NoM = ?`, [req.params.id]);
    await db.run(`DELETE FROM SellPrice_tbl WHERE id_Material_NoM = ?`, [req.params.id]);
    await db.run(`DELETE FROM PriceHistory_tbl      WHERE id_Material_NoM = ?`, [req.params.id]);

    const r = await db.run(
      `DELETE FROM Materials_tbl WHERE id_Material_NoM = ?`, [req.params.id]
    );
    if (!r.changes)
      return res.status(404).json({ success: false, message: "المادة غير موجودة" });

    res.json({ success: true, message: "تم حذف المادة وجميع سجلاتها" });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ══════════════════════════════════════════════════════════
//  UPDATE PRICES ONLY — PATCH /api/materials/:id/prices
//  يحدّث الأسعار فقط ويحفظ في PriceHistory
// ══════════════════════════════════════════════════════════
const updatePrices = async (req, res) => {
  const { SellPrice1, SellPrice2, SellPrice3, SellPrice4, SellPrice5 } = req.body;

  if (SellPrice1 === undefined)
    return res.status(400).json({
      success : false,
      message : "SellPrice1 مطلوب كحد أدنى",
    });

  try {
    const r = await db.run(
      `UPDATE SellPrice_tbl
       SET SellPrice1    = ?,
           SellPrice2    = COALESCE(?, SellPrice2),
           SellPrice3    = COALESCE(?, SellPrice3),
           SellPrice4    = COALESCE(?, SellPrice4),
           SellPrice5    = COALESCE(?, SellPrice5),
           LastSellPrice = ?
       WHERE id_Material_NoM = ?`,
      [SellPrice1, SellPrice2, SellPrice3, SellPrice4, SellPrice5,
       SellPrice1, req.params.id]
    );
    if (!r.changes)
      return res.status(404).json({
        success : false,
        message : "المادة غير موجودة أو لا تملك سجل أسعار",
      });

    // حفظ في تاريخ الأسعار
    await db.run(
      `UPDATE PriceHistory_tbl SET IsCurrentPrice = 0 WHERE id_Material_NoM = ?`,
      [req.params.id]
    );
    await db.run(
      `INSERT INTO PriceHistory_tbl
         (id_Material_NoM, SellPrice, IsCurrentPrice, ChangedByUser)
       VALUES (?, ?, 1, ?)`,
      [req.params.id, SellPrice1, req.user?.id_User || null]
    );

    res.json({ success: true, message: "تم تحديث الأسعار وحفظ السجل التاريخي" });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

module.exports = { getAll, getOne, scanBarcode, create, update, remove, updatePrices };
