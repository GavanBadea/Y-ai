// ============================================================
//  controllers/pos.controller.js
//  نقطة البيع السريعة (POS — Point of Sale)
//
//  الأولوية: السرعة والأداء
//
//  يُعيد استخدام منطق fout.controller لكن بـ:
//   • مسار init موحّد يُحمَّل مرة واحدة عند فتح الشاشة
//   • مواد مجمّعة حسب التصنيف (Grid)
//   • Checkout سريع بحقول اختيارية قليلة
//   • جميع القواعد المالية والمخزنية محفوظة
// ============================================================
const db = require("../db");
const { checkCustomerCreditLimit } = require("../utils/partyBalance");
const { resolveDefaultSellPrice } = require("../utils/sellPriceHelpers");
const { materialExpiryAlert } = require("./expiredStock.controller");
const { findMaterialByScan, attachScanToMaterial } = require("../utils/materialScan");

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
//  helper — رصيد الزبون الحالي
// ──────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────
//  helper — التحقق من نوع الدفع الآجل
// ──────────────────────────────────────────────────────────
function isDeferredPayType(name = "") {
  const n = String(name).trim();
  return n === "آجل" || n === "اجل" || n.toLowerCase() === "deferred" || n.toLowerCase() === "credit";
}

async function getZabonBalance(id_Zabon) {
  const [d, c] = await Promise.all([
    db.queryOne(`SELECT COALESCE(SUM(Amount_DionZabon),0) AS t FROM DionZabon_tbl WHERE id_Zabon=?`, [id_Zabon]),
    db.queryOne(`SELECT COALESCE(SUM(Amount_CatchDoc),0)  AS t FROM CatchDoc_tbl   WHERE id_Zabon=?`, [id_Zabon]),
  ]);
  return { totalDebt: d.t, totalCollected: c.t, netBalance: d.t - c.t };
}

// ══════════════════════════════════════════════════════════
//  1.  INIT  —  GET /api/pos/init
//
//  يُرجع دفعة واحدة:
//   • categories   (الأصناف)
//   • payTypes     (طرق الدفع)
//   • mandobs      (المندوبون)
//   • customers    (الزبائن + رصيد كل منهم)
//
//  يُستدعى مرة واحدة عند فتح شاشة POS
// ══════════════════════════════════════════════════════════
const init = async (_req, res) => {
  try {
    const [categories, payTypes, mandobs, customers] = await Promise.all([

      // الأصناف مرتّبة مع عدد موادها
      db.query(`
        SELECT
          c.id_Catiguary,
          c.CatiguaryName,
          COUNT(m.id_Material_NoM) AS materialCount
        FROM Catiguary_tbl c
        LEFT JOIN Materials_tbl m ON m.id_Catiguary = c.id_Catiguary
        GROUP BY c.id_Catiguary
        ORDER BY c.CatiguaryName
      `),

      // طرق الدفع
      db.query(`SELECT id_PayType, PayTypeName FROM PayType_Tbl ORDER BY id_PayType`),

      // المندوبون
      db.query(`SELECT id_Mandob, MandobName FROM Mandob_tbl ORDER BY MandobName`),

      // الزبائن مع أرصدتهم (للاختيار السريع)
      db.query(`
        SELECT
          z.id_Zabon,
          z.ZabonName,
          z.Mobail,
          z."Credit Limit"                           AS CreditLimit,
          zl.Location_ZabonLocation,
          COALESCE((SELECT SUM(Amount_DionZabon)
                    FROM DionZabon_tbl WHERE id_Zabon=z.id_Zabon), 0)
          - COALESCE((SELECT SUM(Amount_CatchDoc)
                      FROM CatchDoc_tbl   WHERE id_Zabon=z.id_Zabon), 0) AS NetBalance
        FROM Zabon_tbl z
        LEFT JOIN Zabon_Location zl ON zl.id_ZabonLocation = z.id_ZabonLocation
        ORDER BY z.ZabonName
      `),
    ]);

    res.json({
      success    : true,
      loadedAt   : new Date().toISOString(),
      data       : { categories, payTypes, mandobs, customers },
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ══════════════════════════════════════════════════════════
//  2.  MATERIALS BY CATEGORY  —  GET /api/pos/categories/:id/materials
//
//  يُرجع مواد الصنف مع:
//   • اسم المادة + Band (الوحدة)
//   • LastSellPrice (السعر المقترح)
//   • الأسعار الخمسة (للتغيير من القائمة الجانبية)
//   • QuantityOnHand + QuantityWithUnit (الكمية + الوحدة)
//   • Barcode
//
//  ?inStockOnly=1  → فقط المواد التي لها مخزون > 0
// ══════════════════════════════════════════════════════════
const getMaterialsByCategory = async (req, res) => {
  try {
    const { id }          = req.params;
    const { inStockOnly } = req.query;

    let sql = `
      SELECT
        m.id_Material_NoM,
        m.MaterialName,
        m.Barcode,
        m.Band                                         AS Unit,
        m.Band,

        -- المخزون
        COALESCE(s.QuantityOnHand, 0)                  AS QuantityOnHand,
        COALESCE(s.QuantityOnHand, 0) || ' ' || m.Band AS QuantityWithUnit,
        CASE WHEN COALESCE(s.QuantityOnHand, 0) <= 0
          THEN 1 ELSE 0 END                            AS IsOutOfStock,

        -- السعر المقترح (يُعتمد تلقائياً عند اختيار المادة)
        COALESCE(sp.LastSellPrice, 0)                  AS DefaultPrice,

        -- الأسعار الخمسة للقائمة الجانبية
        COALESCE(sp.LastSellPrice, 0)                  AS LastSellPrice,
        COALESCE(sp.SellPrice1,    0)                  AS SellPrice1,
        COALESCE(sp.SellPrice2,    0)                  AS SellPrice2,
        COALESCE(sp.SellPrice3,    0)                  AS SellPrice3,
        COALESCE(sp.SellPrice4,    0)                  AS SellPrice4,
        COALESCE(sp.SellPrice5,    0)                  AS SellPrice5,

        -- التكلفة (للمعرفة الداخلية / هامش الربح)
        m."Cost Price"                                 AS CostPrice,

        -- آخر تاريخ صلاحية لدفعة شراء لهذه المادة
        (SELECT MAX(di.ExpairDate) FROM DetailsIN_tbl di
         WHERE di.id_Material_NoM = m.id_Material_NoM
           AND di.ExpairDate IS NOT NULL AND di.ExpairDate != '') AS NearestExpiry

      FROM Materials_tbl m
      LEFT JOIN Stock_tbl             s  ON s.id_Material_NoM  = m.id_Material_NoM
      LEFT JOIN SellPrice_tbl sp ON sp.id_Material_NoM = m.id_Material_NoM
      WHERE m.id_Catiguary = ?`;

    const params = [id];
    if (inStockOnly === "1") {
      sql += " AND COALESCE(s.QuantityOnHand, 0) > 0";
    }
    sql += " ORDER BY m.MaterialName";

    const rows = await db.query(sql, params);

    // تحويل الأسعار لمصفوفة priceOptions لكل مادة
    const data = rows.map((r) => {
      const defaultPrice = resolveDefaultSellPrice(r);
      return {
      id_Material_NoM : r.id_Material_NoM,
      MaterialName    : r.MaterialName,
      Barcode         : r.Barcode,
      Unit            : r.Unit,
      Band            : r.Band,
      QuantityOnHand  : r.QuantityOnHand,
      QuantityWithUnit: r.QuantityWithUnit,
      IsOutOfStock    : r.IsOutOfStock === 1,
      NearestExpiry   : r.NearestExpiry || null,
      IsExpired       : r.NearestExpiry ? r.NearestExpiry < new Date().toISOString().split('T')[0] : false,
      DefaultPrice    : defaultPrice,
      ActiveSellPrice : defaultPrice,
      SellPrice1      : r.SellPrice1,
      SellPrice2      : r.SellPrice2,
      SellPrice3      : r.SellPrice3,
      SellPrice4      : r.SellPrice4,
      SellPrice5      : r.SellPrice5,
      CostPrice       : r.CostPrice,
      priceOptions    : [
        ...(defaultPrice > 0 ? [{ label: "السعر الحالي", value: defaultPrice, key: "ActiveSellPrice" }] : []),
        { label: "سعر 1",   value: r.SellPrice1,    key: "SellPrice1"    },
        { label: "سعر 2",   value: r.SellPrice2,    key: "SellPrice2"    },
        { label: "سعر 3",   value: r.SellPrice3,    key: "SellPrice3"    },
        { label: "سعر 4",   value: r.SellPrice4,    key: "SellPrice4"    },
        { label: "سعر 5",   value: r.SellPrice5,    key: "SellPrice5"    },
      ].filter((p) => p.value > 0),
    };
    });

    res.json({ success: true, count: data.length, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ══════════════════════════════════════════════════════════
//  3.  SEARCH MATERIAL  —  GET /api/pos/material/:identifier
//  identifier = id أو Barcode أو اسم جزئي
//  مسار مستقل للبحث السريع بالباركود أو الاسم
// ══════════════════════════════════════════════════════════
const searchMaterial = async (req, res) => {
  const { identifier } = req.params;
  const isNumeric = /^\d+$/.test(identifier);
  const POS_MATERIAL_SELECT = `
       SELECT
         m.id_Material_NoM, m.MaterialName, m.Barcode, m.Band,
         COALESCE(s.QuantityOnHand, 0)                  AS QuantityOnHand,
         COALESCE(s.QuantityOnHand, 0) || ' ' || m.Band AS QuantityWithUnit,
         COALESCE(sp.LastSellPrice, 0)                  AS DefaultPrice,
         COALESCE(sp.LastSellPrice, 0)                  AS LastSellPrice,
         COALESCE(sp.SellPrice1,    0)                  AS SellPrice1,
         COALESCE(sp.SellPrice2,    0)                  AS SellPrice2,
         COALESCE(sp.SellPrice3,    0)                  AS SellPrice3,
         COALESCE(sp.SellPrice4,    0)                  AS SellPrice4,
         COALESCE(sp.SellPrice5,    0)                  AS SellPrice5,
         c.CatiguaryName
       FROM Materials_tbl m
       LEFT JOIN Stock_tbl      s  ON s.id_Material_NoM  = m.id_Material_NoM
       LEFT JOIN SellPrice_tbl  sp ON sp.id_Material_NoM = m.id_Material_NoM
       LEFT JOIN Catiguary_tbl  c  ON c.id_Catiguary     = m.id_Catiguary`;

  try {
    const found = await findMaterialByScan(db, identifier, {
      barcodeSql: POS_MATERIAL_SELECT + " WHERE CAST(m.Barcode AS TEXT) = CAST(? AS TEXT)",
      idSql: POS_MATERIAL_SELECT + " WHERE m.id_Material_NoM = ?",
    });

    if (found) {
      const defaultPrice = resolveDefaultSellPrice(found.row);
      const data = attachScanToMaterial({
        ...found.row,
        DefaultPrice: defaultPrice,
        ActiveSellPrice: defaultPrice,
        IsOutOfStock: found.row.QuantityOnHand <= 0,
        priceOptions: [
          ...(defaultPrice > 0 ? [{ label: "السعر الحالي", value: defaultPrice }] : []),
          { label: "سعر 1", value: found.row.SellPrice1 },
          { label: "سعر 2", value: found.row.SellPrice2 },
          { label: "سعر 3", value: found.row.SellPrice3 },
          { label: "سعر 4", value: found.row.SellPrice4 },
          { label: "سعر 5", value: found.row.SellPrice5 },
        ].filter((p) => p.value > 0),
      }, found.scan);
      data.expiryWarning = await materialExpiryAlert(data.id_Material_NoM);
      return res.json({
        success: true,
        count: 1,
        single: true,
        scan: found.scan,
        data,
      });
    }

    // المرحلة 2: بحث بالاسم
    let rows = await db.query(
        `SELECT
           m.id_Material_NoM, m.MaterialName, m.Barcode, m.Band,
           COALESCE(s.QuantityOnHand, 0)                  AS QuantityOnHand,
           COALESCE(s.QuantityOnHand, 0) || ' ' || m.Band AS QuantityWithUnit,
           COALESCE(sp.LastSellPrice, 0)                  AS DefaultPrice,
           COALESCE(sp.LastSellPrice, 0)                  AS LastSellPrice,
           COALESCE(sp.SellPrice1,    0)                  AS SellPrice1,
           COALESCE(sp.SellPrice2,    0)                  AS SellPrice2,
           COALESCE(sp.SellPrice3,    0)                  AS SellPrice3,
           COALESCE(sp.SellPrice4,    0)                  AS SellPrice4,
           COALESCE(sp.SellPrice5,    0)                  AS SellPrice5,
           c.CatiguaryName
         FROM Materials_tbl m
         LEFT JOIN Stock_tbl      s  ON s.id_Material_NoM  = m.id_Material_NoM
         LEFT JOIN SellPrice_tbl  sp ON sp.id_Material_NoM = m.id_Material_NoM
         LEFT JOIN Catiguary_tbl  c  ON c.id_Catiguary     = m.id_Catiguary
         WHERE m.MaterialName LIKE ?
         ORDER BY m.MaterialName
         LIMIT 20`,
        [`%${identifier}%`]
      );

    // المرحلة 3: إذا لم يوجد بالاسم وكان الإدخال رقمياً — بحث بالـ ID
    if (!rows.length && isNumeric) {
      rows = await db.query(
        `SELECT
           m.id_Material_NoM, m.MaterialName, m.Barcode, m.Band,
           COALESCE(s.QuantityOnHand, 0)                  AS QuantityOnHand,
           COALESCE(s.QuantityOnHand, 0) || ' ' || m.Band AS QuantityWithUnit,
           COALESCE(sp.LastSellPrice, 0)                  AS DefaultPrice,
           COALESCE(sp.LastSellPrice, 0)                  AS LastSellPrice,
           COALESCE(sp.SellPrice1,    0)                  AS SellPrice1,
           COALESCE(sp.SellPrice2,    0)                  AS SellPrice2,
           COALESCE(sp.SellPrice3,    0)                  AS SellPrice3,
           COALESCE(sp.SellPrice4,    0)                  AS SellPrice4,
           COALESCE(sp.SellPrice5,    0)                  AS SellPrice5,
           c.CatiguaryName
         FROM Materials_tbl m
         LEFT JOIN Stock_tbl      s  ON s.id_Material_NoM  = m.id_Material_NoM
         LEFT JOIN SellPrice_tbl  sp ON sp.id_Material_NoM = m.id_Material_NoM
         LEFT JOIN Catiguary_tbl  c  ON c.id_Catiguary     = m.id_Catiguary
         WHERE m.id_Material_NoM = ?
         ORDER BY m.MaterialName
         LIMIT 1`,
        [Number(identifier)]
      );
    }

    if (!rows.length)
      return res.status(404).json({
        success: false,
        message: `لا نتائج لـ "${identifier}"`,
      });

    const data = rows.map((r) => {
      const defaultPrice = resolveDefaultSellPrice(r);
      return {
      ...r,
      DefaultPrice : defaultPrice,
      ActiveSellPrice: defaultPrice,
      SellPrice1   : r.SellPrice1,
      SellPrice2   : r.SellPrice2,
      SellPrice3   : r.SellPrice3,
      SellPrice4   : r.SellPrice4,
      SellPrice5   : r.SellPrice5,
      IsOutOfStock : r.QuantityOnHand <= 0,
      priceOptions : [
        ...(defaultPrice > 0 ? [{ label: "السعر الحالي", value: defaultPrice }] : []),
        { label: "سعر 1",   value: r.SellPrice1    },
        { label: "سعر 2",   value: r.SellPrice2    },
        { label: "سعر 3",   value: r.SellPrice3    },
        { label: "سعر 4",   value: r.SellPrice4    },
        { label: "سعر 5",   value: r.SellPrice5    },
      ].filter((p) => p.value > 0),
    };
    });

    if (data.length === 1) {
      data[0].expiryWarning = await materialExpiryAlert(data[0].id_Material_NoM);
    }

    // إذا نتيجة واحدة → أرجع مباشرة (باركود مباشر)
    res.json({
      success   : true,
      count     : data.length,
      single    : data.length === 1,
      data      : data.length === 1 ? data[0] : data,
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ══════════════════════════════════════════════════════════
//  4.  CART PREVIEW  —  POST /api/pos/cart-preview
//
//  يستقبل سلة مؤقتة ويُرجع المجاميع والتحقق
//  بدون أي تأثير على قاعدة البيانات
//
//  Body: { id_Zabon, Dis_FOUT, items: [{ id_Material_NoM, AmountOUT, PriceOUT }] }
// ══════════════════════════════════════════════════════════
const cartPreview = async (req, res) => {
  const { id_Zabon, Dis_FOUT = 0, items = [] } = req.body;

  if (!items.length)
    return res.status(400).json({ success: false, message: "السلة فارغة" });

  try {
    const warnings    = [];
    let   linesTotal  = 0;
    const enriched    = [];

    for (const item of items) {
      const mat = await db.queryOne(
        `SELECT m.id_Material_NoM, m.MaterialName, m.Band,
                COALESCE(s.QuantityOnHand,0) AS qty,
                COALESCE(sp.LastSellPrice,0) AS LastSellPrice
         FROM Materials_tbl m
         LEFT JOIN Stock_tbl             s  ON s.id_Material_NoM  = m.id_Material_NoM
         LEFT JOIN SellPrice_tbl sp ON sp.id_Material_NoM = m.id_Material_NoM
         WHERE m.id_Material_NoM = ?`,
        [item.id_Material_NoM]
      );
      if (!mat) {
        warnings.push(`المادة id=${item.id_Material_NoM} غير موجودة`);
        continue;
      }

      const amt      = Number(item.AmountOUT || 1);
      const price    = Number(item.PriceOUT  || mat.LastSellPrice);
      const lineTotal = amt * price;
      linesTotal     += lineTotal;

      if (mat.qty - amt < 0) {
        warnings.push(`⚠️ "${mat.MaterialName}": المخزون سيصبح ${mat.qty - amt} ${mat.Band}`);
      }

      enriched.push({
        id_Material_NoM : mat.id_Material_NoM,
        MaterialName    : mat.MaterialName,
        Band            : mat.Band,
        AmountOUT       : amt,
        PriceOUT        : price,
        LineTotal       : Math.round(lineTotal * 100) / 100,
        StockAfterSale  : mat.qty - amt,
      });
    }

    const grandTotal     = linesTotal - Number(Dis_FOUT);
    const prevBalance    = id_Zabon ? await getZabonBalance(id_Zabon) : null;

    res.json({
      success      : true,
      warnings     : warnings.length ? warnings : undefined,
      cart         : {
        itemsCount   : enriched.length,
        linesTotal   : Math.round(linesTotal  * 100) / 100,
        discount     : Number(Dis_FOUT),
        grandTotal   : Math.round(grandTotal  * 100) / 100,
        previousBalance : prevBalance?.netBalance ?? null,
        items        : enriched,
      },
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ══════════════════════════════════════════════════════════
//  5.  CHECKOUT  —  POST /api/pos/checkout
//
//  الحفظ السريع — حقول السائق اختيارية
//
//  Body (الحد الأدنى):
//  {
//    id_Zabon, id_PayType_FOUT,
//    items: [{ id_Material_NoM, AmountOUT, PriceOUT }]
//  }
//
//  Body (كامل):
//  {
//    id_Zabon, id_PayType_FOUT, Dis_FOUT, Note_FOUT, id_Mandob,
//    DriverName, DriverMobile, VehicleNumber,
//    items: [{ id_Material_NoM, AmountOUT, PriceOUT }]
//  }
// ══════════════════════════════════════════════════════════
const checkout = async (req, res) => {
  const {
    id_Zabon,
    id_PayType_FOUT,
    Dis_FOUT      = 0,
    Note_FOUT     = "",
    PaidAmount    = null,   // ← مبلغ مدفوع حقيقي من الحاسبة
    id_Mandob     = null,
    DriverName    = "",
    DriverMobile  = "",
    VehicleNumber = "",
    items         = [],
  } = req.body;

  // ── التحقق السريع ──────────────────────────────────────
  if (!id_PayType_FOUT) return res.status(400).json({ success: false, message: "id_PayType_FOUT مطلوب" });
  if (!items.length)    return res.status(400).json({ success: false, message: "السلة فارغة" });

  // ── التحقق من الزبون (اختياري) ونوع الدفع ───────────
  const [zabon, payType] = await Promise.all([
    id_Zabon
      ? db.queryOne(`SELECT * FROM Zabon_tbl WHERE id_Zabon = ?`, [id_Zabon])
      : Promise.resolve(null),                               // ← بدون زبون مسموح
    db.queryOne(`SELECT * FROM PayType_Tbl WHERE id_PayType = ?`, [id_PayType_FOUT]),
  ]);
  if (id_Zabon && !zabon) return res.status(400).json({ success: false, message: `الزبون id=${id_Zabon} غير موجود` });
  if (!payType)           return res.status(400).json({ success: false, message: `نوع الدفع id=${id_PayType_FOUT} غير موجود` });

  // ── تحضير الأسطر ─────────────────────────────────────
  const today       = new Date().toISOString().split("T")[0];
  const preparedLines = [];
  const warnings      = [];

  for (const item of items) {
    const { id_Material_NoM, AmountOUT, PriceOUT } = item;

    if (!id_Material_NoM || !AmountOUT || Number(AmountOUT) <= 0)
      return res.status(400).json({
        success: false,
        message: `بيانات غير مكتملة في أحد الأسطر (id_Material_NoM أو AmountOUT)`,
      });

    const mat = await db.queryOne(
      `SELECT m.id_Material_NoM, m.MaterialName, m.Band,
              COALESCE(s.QuantityOnHand,0)       AS CurrentQty,
              COALESCE(sp.LastSellPrice,0)        AS LastSellPrice
       FROM Materials_tbl m
       LEFT JOIN Stock_tbl             s  ON s.id_Material_NoM  = m.id_Material_NoM
       LEFT JOIN SellPrice_tbl sp ON sp.id_Material_NoM = m.id_Material_NoM
       WHERE m.id_Material_NoM = ?`,
      [id_Material_NoM]
    );
    if (!mat) return res.status(400).json({ success: false, message: `المادة id=${id_Material_NoM} غير موجودة` });

    const amt         = Number(AmountOUT);
    // السعر: المُرسَل أو LastSellPrice كاحتياط
    const price       = Number(PriceOUT ?? mat.LastSellPrice);
    const stockAfter  = mat.CurrentQty - amt;

    // ✅ البيع بالسالب مسموح — نُنبّه فقط
    if (stockAfter < 0) {
      warnings.push(
        `⚠️ "${mat.MaterialName}": المخزون سيصبح ${stockAfter} ${mat.Band}`
      );
    }

    preparedLines.push({
      id_Material_NoM,
      MaterialName : mat.MaterialName,
      Band         : mat.Band,
      AmountOUT    : amt,
      PriceOUT     : price,
      CurrentQty   : mat.CurrentQty,
      StockAfter   : stockAfter,
    });
  }

  // ── المجاميع ─────────────────────────────────────────
  const linesTotal  = preparedLines.reduce((s, l) => s + l.AmountOUT * l.PriceOUT, 0);
  const grandTotal  = linesTotal - Number(Dis_FOUT);
  // ✅ المبلغ الفعلي المدفوع — يستخدم PaidAmount إذا أُرسل، وإلا الإجمالي
  const actualPaid  = PaidAmount !== null ? Math.max(0, Number(PaidAmount)) : grandTotal;
  const changeAmt   = Math.max(0, actualPaid - grandTotal);
  // رصيد الزبون — null إذا لم يُختر زبون
  const prevBal    = id_Zabon ? await getZabonBalance(id_Zabon) : null;

  if (id_Zabon && isDeferredPayType(payType.PayTypeName)) {
    const creditMsg = checkCustomerCreditLimit(
      zabon["Credit Limit"],
      prevBal?.netBalance ?? 0,
      grandTotal,
      actualPaid
    );
    if (creditMsg) {
      return res.status(400).json({ success: false, message: creditMsg });
    }
  }

  // ══════════════════════════════════════════════════════
  //  التنفيذ داخل Transaction
  // ══════════════════════════════════════════════════════
  try {
    await db.run("BEGIN TRANSACTION");

    // 1️⃣  رأس الفاتورة
    const hdr = await db.run(
      `INSERT INTO FOUT_tbl
         (Date_FOUT, id_PayType_FOUT, Dis_FOUT, Note_FOUT,
          id_Zabon, id_Mandob, DriverName, DriverMobile, VehicleNumber)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [today, id_PayType_FOUT, Number(Dis_FOUT),
       Note_FOUT || `POS — ${zabon?.ZabonName || "بدون زبون"}`,
       id_Zabon, id_Mandob, DriverName, DriverMobile, VehicleNumber]
    );
    const invoiceId = hdr.lastID;

    for (const line of preparedLines) {
      // 2️⃣  سطر التفصيل
      await db.run(
        `INSERT INTO DetailsOUT_tbl
           (id_NoFOUT, id_Material_NoM, AmountOUT, PriceOUT, AmountStayInStorage)
         VALUES (?, ?, ?, ?, ?)`,
        [invoiceId, line.id_Material_NoM,
         line.AmountOUT, line.PriceOUT, line.StockAfter]
      );

      // 3️⃣  تحديث المخزون (بالسالب مسموح)
      await db.run(
        `INSERT INTO Stock_tbl
           (id_Material_NoM, QuantityOUT, QuantityOnHand, LastUpdateDate)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(id_Material_NoM) DO UPDATE SET
           QuantityOUT    = QuantityOUT    + excluded.QuantityOUT,
           QuantityOnHand = QuantityOnHand - excluded.QuantityOUT,
           LastUpdateDate = excluded.LastUpdateDate`,
        [line.id_Material_NoM, line.AmountOUT, line.AmountOUT]
      );

      // 4️⃣  AuditLog لكل سطر
      await audit(
        req.user, "Stock_tbl", line.id_Material_NoM,
        "QuantityOnHand",
        line.CurrentQty, line.StockAfter,
        `POS فاتورة #${invoiceId} — ${line.AmountOUT} ${line.Band}`
      );
    }

    // 5️⃣  الترحيل المالي — فقط إذا يوجد زبون محدد + دفع آجل
    if (id_Zabon && isDeferredPayType(payType.PayTypeName)) {
      await db.run(
        `INSERT INTO DionZabon_tbl
           (Amount_DionZabon, Date_DionZabon, Note_DionZabon, id_Zabon)
         VALUES (?, ?, ?, ?)`,
        [grandTotal, today, `فاتورة مبيعات رقم ${invoiceId}`, id_Zabon]
      );
    }
    // بدون زبون أو نقدي → لا دين يُسجَّل

    // 6️⃣  AuditLog للفاتورة
    await audit(
      req.user, "FOUT_tbl", invoiceId,
      "POS_CHECKOUT", null, grandTotal,
      `POS | ${zabon?.ZabonName || "بدون زبون"} | ${payType.PayTypeName} | ${preparedLines.length} أصناف`
    );

    await db.run("COMMIT");

    res.status(201).json({
      success          : true,
      message          : "✅ تم حفظ الفاتورة بنجاح",
      invoiceId,
      warnings         : warnings.length ? warnings : undefined,
      receipt          : {
        invoiceId,
        invoiceDate   : today,
        customerName  : zabon?.ZabonName || "بدون زبون",
        paymentType   : payType.PayTypeName,
        itemsCount    : preparedLines.length,
        linesTotal    : Math.round(linesTotal  * 100) / 100,
        discount      : Number(Dis_FOUT),
        grandTotal    : Math.round(grandTotal  * 100) / 100,
        paidAmount    : Math.round(actualPaid  * 100) / 100,
        changeAmount  : Math.round(changeAmt   * 100) / 100,
        previousBalance: prevBal?.netBalance ?? null,
        newBalance    : (id_Zabon && isDeferredPayType(payType.PayTypeName))
          ? (prevBal?.netBalance ?? 0) + grandTotal
          : (prevBal?.netBalance ?? null),
        lines         : preparedLines.map((l) => ({
          MaterialName : l.MaterialName,
          Band         : l.Band,
          AmountOUT    : l.AmountOUT,
          PriceOUT     : l.PriceOUT,
          LineTotal    : Math.round(l.AmountOUT * l.PriceOUT * 100) / 100,
          StockAfter   : l.StockAfter,
        })),
      },
    });
  } catch (e) {
    await db.run("ROLLBACK").catch(() => {});
    res.status(500).json({ success: false, message: e.message });
  }
};

// ══════════════════════════════════════════════════════════
//  6.  NAVIGATE POS  —  الملاحة في فواتير POS فقط
//
//  يستخدم جدول FOUT_tbl مع تصفية Note_FOUT يبدأ بـ "POS"
//  GET /api/pos/navigate/:id/:direction
// ══════════════════════════════════════════════════════════
const navigate = async (req, res) => {
  const { id, direction } = req.params;
  try {
    let row;
    if (direction === "prev") {
      row = await db.queryOne(
        `SELECT id_NoFOUT FROM FOUT_tbl
         WHERE id_NoFOUT < ? AND Note_FOUT LIKE 'POS%'
         ORDER BY id_NoFOUT DESC LIMIT 1`,
        [id]
      );
    } else if (direction === "next") {
      row = await db.queryOne(
        `SELECT id_NoFOUT FROM FOUT_tbl
         WHERE id_NoFOUT > ? AND Note_FOUT LIKE 'POS%'
         ORDER BY id_NoFOUT ASC LIMIT 1`,
        [id]
      );
    } else {
      return res.status(400).json({ success: false, message: "direction: prev أو next" });
    }

    if (!row)
      return res.status(404).json({
        success   : false,
        message   : direction === "prev" ? "لا توجد فاتورة POS سابقة" : "لا توجد فاتورة POS تالية",
        currentId : Number(id),
      });

    const [header, lines] = await Promise.all([
      db.queryOne(
        `SELECT f.*, z.ZabonName, pt.PayTypeName, m.MandobName
         FROM FOUT_tbl f
         LEFT JOIN Zabon_tbl    z  ON z.id_Zabon   = f.id_Zabon
         LEFT JOIN PayType_Tbl  pt ON pt.id_PayType = f.id_PayType_FOUT
         LEFT JOIN Mandob_tbl   m  ON m.id_Mandob  = f.id_Mandob
         WHERE f.id_NoFOUT = ?`,
        [row.id_NoFOUT]
      ),
      db.query(
        `SELECT d.*, mat.MaterialName, mat.Band,
                (d.AmountOUT * d.PriceOUT) AS LineTotal
         FROM DetailsOUT_tbl d
         LEFT JOIN Materials_tbl mat ON mat.id_Material_NoM = d.id_Material_NoM
         WHERE d.id_NoFOUT = ?`,
        [row.id_NoFOUT]
      ),
    ]);

    const prevBal = await getZabonBalance(header.id_Zabon);
    res.json({
      success   : true,
      direction,
      data      : { ...header, previousBalance: prevBal, lines },
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ══════════════════════════════════════════════════════════
//  7.  POS BOUNDS  —  أول وآخر فاتورة POS
// ══════════════════════════════════════════════════════════
const getBounds = async (_req, res) => {
  try {
    const [first, last] = await Promise.all([
      db.queryOne(`SELECT id_NoFOUT FROM FOUT_tbl WHERE Note_FOUT LIKE 'POS%' ORDER BY id_NoFOUT ASC  LIMIT 1`),
      db.queryOne(`SELECT id_NoFOUT FROM FOUT_tbl WHERE Note_FOUT LIKE 'POS%' ORDER BY id_NoFOUT DESC LIMIT 1`),
    ]);
    res.json({
      success      : true,
      firstInvoice : first?.id_NoFOUT || null,
      lastInvoice  : last?.id_NoFOUT  || null,
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

module.exports = {
  init,
  getMaterialsByCategory,
  searchMaterial,
  cartPreview,
  checkout,
  navigate,
  getBounds,
};
