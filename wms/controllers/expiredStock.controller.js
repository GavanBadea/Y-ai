// ============================================================
//  controllers/expiredStock.controller.js
//  نظام إدارة المواد منتهية الصلاحية
//
//  الجدول الجديد: ExpiredStock_tbl
//  الحقول:
//   id_Expired, id_Material_NoM, id_DetailsIN,
//   ExpiredQty, CostPrice, TotalLoss,
//   ExpairDate, ProcessedDate, Notes
//
//  Endpoints:
//   GET  /api/expired-stock              → قائمة المشطوبات
//   GET  /api/expired-stock/pending      → المنتهية وتنتظر الشطب
//   POST /api/expired-stock/process      → شطب تلقائي للمنتهية
//   POST /api/expired-stock/process/:id  → شطب يدوي لسجل معين
//   GET  /api/expired-stock/summary      → ملخص الخسائر
// ============================================================
const db = require("../db");

const r2 = (n) => Math.round((n || 0) * 100) / 100;

/** تنبيه بيع مادة لها دفعات منتهية لم تُشطب بعد */
async function materialExpiryAlert(id_Material_NoM) {
  const row = await db.queryOne(
    `SELECT
       COUNT(*) AS batchCount,
       COALESCE(SUM(
         di.AmountIN - COALESCE(
           (SELECT SUM(ex.ExpiredQty) FROM ExpiredStock_tbl ex WHERE ex.id_DetailsIN = di.id_DetailsIN),
           0
         )
       ), 0) AS pendingQty
     FROM DetailsIN_tbl di
     WHERE di.id_Material_NoM = ?
       AND di.ExpairDate IS NOT NULL AND di.ExpairDate != ''
       AND di.ExpairDate < date('now')
       AND di.AmountIN > COALESCE(
         (SELECT SUM(ex.ExpiredQty) FROM ExpiredStock_tbl ex WHERE ex.id_DetailsIN = di.id_DetailsIN),
         0
       )`,
    [id_Material_NoM]
  );
  if (!row?.batchCount || !row.pendingQty) return null;
  return {
    expiredPending: true,
    batchCount: row.batchCount,
    pendingQty: row.pendingQty,
    message: `⚠️ مادة منتهية الصلاحية — ${row.pendingQty} وحدة بانتظار الشطب`,
  };
}

// ──────────────────────────────────────────────────────────
//  إنشاء الجدول إن لم يكن موجوداً (يُستدعى من db.js)
// ──────────────────────────────────────────────────────────
// الجدول يُنشأ في db.js تلقائياً

// ──────────────────────────────────────────────────────────
//  helper — جلب الكمية المتبقية لدفعة شراء معينة
//  (الكمية المشتراة - ما بيع - ما شُطب سابقاً)
// ──────────────────────────────────────────────────────────
async function getRemainingQty(id_DetailsIN, purchasedQty) {
  // الكمية المشطوبة سابقاً من نفس الدفعة
  const prev = await db.queryOne(
    `SELECT COALESCE(SUM(ExpiredQty), 0) AS written
     FROM ExpiredStock_tbl WHERE id_DetailsIN = ?`,
    [id_DetailsIN]
  );
  return Math.max(0, purchasedQty - (prev?.written || 0));
}

// ══════════════════════════════════════════════════════════
//  GET /api/expired-stock
//  قائمة كل المواد المشطوبة سابقاً
// ══════════════════════════════════════════════════════════
const getAll = async (req, res) => {
  const { from, to } = req.query;
  try {
    let sql = `
      SELECT
        e.*,
        m.MaterialName, m.Band,
        c.CatiguaryName,
        fi.Date_FIN AS purchaseDate,
        fi.id_NoFIN AS invoiceNo
      FROM ExpiredStock_tbl e
      JOIN Materials_tbl    m  ON m.id_Material_NoM = e.id_Material_NoM
      LEFT JOIN Catiguary_tbl c ON c.id_Catiguary   = m.id_Catiguary
      LEFT JOIN DetailsIN_tbl di ON di.id_DetailsIN  = e.id_DetailsIN
      LEFT JOIN FIN_tbl       fi ON fi.id_NoFIN       = di.id_NoFIN
      WHERE 1=1`;
    const p = [];
    if (from) { sql += " AND e.ProcessedDate >= ?"; p.push(from); }
    if (to)   { sql += " AND e.ProcessedDate <= ?"; p.push(to);   }
    sql += " ORDER BY e.ProcessedDate DESC, e.id_Expired DESC";

    const rows = await db.query(sql, p);
    const totalLoss = r2(rows.reduce((s, r) => s + (r.TotalLoss || 0), 0));
    const totalQty  = rows.reduce((s, r) => s + (r.ExpiredQty || 0), 0);

    res.json({ success: true, count: rows.length, totalLoss, totalQty, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ══════════════════════════════════════════════════════════
//  GET /api/expired-stock/pending
//  المواد التي انتهت صلاحيتها ولم تُشطب بعد
// ══════════════════════════════════════════════════════════
const getPending = async (_req, res) => {
  const today = new Date().toISOString().split("T")[0];
  try {
    const rows = await db.query(`
      SELECT
        di.id_DetailsIN,
        di.id_Material_NoM,
        di.AmountIN        AS purchasedQty,
        di.PriceIN         AS costPrice,
        di.ExpairDate,
        m.MaterialName,
        m.Band,
        c.CatiguaryName,
        fi.Date_FIN        AS purchaseDate,
        fi.id_NoFIN        AS invoiceNo,
        COALESCE(s.QuantityOnHand, 0) AS stockOnHand,
        COALESCE(
          (SELECT SUM(ex.ExpiredQty) FROM ExpiredStock_tbl ex WHERE ex.id_DetailsIN = di.id_DetailsIN),
          0
        ) AS alreadyWrittenOff
      FROM DetailsIN_tbl di
      JOIN Materials_tbl    m  ON m.id_Material_NoM = di.id_Material_NoM
      LEFT JOIN Catiguary_tbl c ON c.id_Catiguary   = m.id_Catiguary
      JOIN FIN_tbl            fi ON fi.id_NoFIN      = di.id_NoFIN
      LEFT JOIN Stock_tbl     s  ON s.id_Material_NoM = di.id_Material_NoM
      WHERE di.ExpairDate IS NOT NULL
        AND di.ExpairDate != ''
        AND di.ExpairDate < ?
      ORDER BY di.ExpairDate ASC
    `, [today]);

    // حساب الكمية المتبقية القابلة للشطب لكل دفعة
    const enriched = rows
      .map(r => {
        const remainingQty = Math.max(0, r.purchasedQty - r.alreadyWrittenOff);
        const daysExpired  = Math.ceil(
          (new Date(today) - new Date(r.ExpairDate)) / 86400000
        );
        return {
          ...r,
          remainingQty,
          daysExpired,
          potentialLoss: r2(remainingQty * r.costPrice),
        };
      })
      .filter(r => r.remainingQty > 0); // فقط ما لم يُشطب كلياً

    const totalPotentialLoss = r2(enriched.reduce((s, r) => s + r.potentialLoss, 0));

    res.json({
      success: true,
      count: enriched.length,
      totalPotentialLoss,
      data: enriched,
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ══════════════════════════════════════════════════════════
//  POST /api/expired-stock/process
//  شطب تلقائي لجميع المواد المنتهية الصلاحية
//  يُنفَّذ تلقائياً عند بدء تشغيل السيرفر وعند الطلب
// ══════════════════════════════════════════════════════════
const processAll = async (req, res) => {
  const today = new Date().toISOString().split("T")[0];
  try {
    // جلب كل الدفعات المنتهية غير المشطوبة كلياً
    const pending = await db.query(`
      SELECT
        di.id_DetailsIN,
        di.id_Material_NoM,
        di.AmountIN  AS purchasedQty,
        di.PriceIN   AS costPrice,
        di.ExpairDate,
        COALESCE(
          (SELECT SUM(ex.ExpiredQty) FROM ExpiredStock_tbl ex WHERE ex.id_DetailsIN = di.id_DetailsIN),
          0
        ) AS alreadyWrittenOff
      FROM DetailsIN_tbl di
      WHERE di.ExpairDate IS NOT NULL
        AND di.ExpairDate != ''
        AND di.ExpairDate < ?
    `, [today]);

    const toProcess = pending.filter(r =>
      Math.max(0, r.purchasedQty - r.alreadyWrittenOff) > 0
    );

    if (!toProcess.length) {
      return res.json({
        success: true,
        message: "لا توجد مواد منتهية الصلاحية تحتاج إلى شطب",
        processed: 0,
      });
    }

    await db.run("BEGIN TRANSACTION");
    let processedCount = 0;
    let totalLoss = 0;

    for (const item of toProcess) {
      const qty  = Math.max(0, item.purchasedQty - item.alreadyWrittenOff);
      if (qty <= 0) continue;

      const loss = r2(qty * item.costPrice);

      // 1️⃣ سجّل في ExpiredStock_tbl
      await db.run(
        `INSERT INTO ExpiredStock_tbl
           (id_Material_NoM, id_DetailsIN, ExpiredQty,
            CostPrice, TotalLoss, ExpairDate, ProcessedDate, Notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          item.id_Material_NoM,
          item.id_DetailsIN,
          qty,
          item.costPrice,
          loss,
          item.ExpairDate,
          today,
          "شطب تلقائي — انتهاء الصلاحية",
        ]
      );

      // 2️⃣ اخصم من المخزون (QuantityOUT + QuantityOnHand)
      await db.run(
        `UPDATE Stock_tbl
         SET QuantityOUT    = QuantityOUT    + ?,
             QuantityOnHand = MAX(0, QuantityOnHand - ?),
             LastUpdateDate = datetime('now')
         WHERE id_Material_NoM = ?`,
        [qty, qty, item.id_Material_NoM]
      );

      processedCount++;
      totalLoss += loss;
    }

    await db.run("COMMIT");

    res.json({
      success: true,
      message: `تم شطب ${processedCount} دفعة منتهية الصلاحية`,
      processed: processedCount,
      totalLoss: r2(totalLoss),
    });
  } catch (e) {
    await db.run("ROLLBACK").catch(() => {});
    res.status(500).json({ success: false, message: e.message });
  }
};

// ══════════════════════════════════════════════════════════
//  POST /api/expired-stock/process/:detailsInId
//  شطب يدوي لدفعة واحدة محددة
// ══════════════════════════════════════════════════════════
const processOne = async (req, res) => {
  const { detailsInId } = req.params;
  const { Notes } = req.body;
  const today = new Date().toISOString().split("T")[0];

  try {
    const item = await db.queryOne(
      `SELECT di.*, m.MaterialName,
              COALESCE(
                (SELECT SUM(ex.ExpiredQty) FROM ExpiredStock_tbl ex WHERE ex.id_DetailsIN = di.id_DetailsIN),
                0
              ) AS alreadyWrittenOff
       FROM DetailsIN_tbl di
       JOIN Materials_tbl m ON m.id_Material_NoM = di.id_Material_NoM
       WHERE di.id_DetailsIN = ?`,
      [detailsInId]
    );

    if (!item) return res.status(404).json({ success: false, message: "السجل غير موجود" });

    const qty = Math.max(0, item.AmountIN - item.alreadyWrittenOff);
    if (qty <= 0)
      return res.status(400).json({ success: false, message: "هذه الدفعة مشطوبة بالكامل مسبقاً" });

    const loss = r2(qty * item.PriceIN);

    await db.run("BEGIN TRANSACTION");

    await db.run(
      `INSERT INTO ExpiredStock_tbl
         (id_Material_NoM, id_DetailsIN, ExpiredQty,
          CostPrice, TotalLoss, ExpairDate, ProcessedDate, Notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        item.id_Material_NoM,
        item.id_DetailsIN,
        qty,
        item.PriceIN,
        loss,
        item.ExpairDate,
        today,
        Notes || "شطب يدوي",
      ]
    );

    await db.run(
      `UPDATE Stock_tbl
       SET QuantityOUT    = QuantityOUT    + ?,
           QuantityOnHand = MAX(0, QuantityOnHand - ?),
           LastUpdateDate = datetime('now')
       WHERE id_Material_NoM = ?`,
      [qty, qty, item.id_Material_NoM]
    );

    await db.run("COMMIT");

    res.json({
      success: true,
      message: `تم شطب ${qty} ${item.Band || ""} من "${item.MaterialName}"`,
      qty, loss,
    });
  } catch (e) {
    await db.run("ROLLBACK").catch(() => {});
    res.status(500).json({ success: false, message: e.message });
  }
};

// ══════════════════════════════════════════════════════════
//  GET /api/expired-stock/summary
//  ملخص إجمالي الخسائر حسب الفئة والشهر
// ══════════════════════════════════════════════════════════
const getSummary = async (_req, res) => {
  try {
    const [totals, byCategory, byMonth, pending] = await Promise.all([
      db.queryOne(
        `SELECT
           COUNT(*) AS records,
           COALESCE(SUM(ExpiredQty), 0)  AS totalQty,
           COALESCE(SUM(TotalLoss),  0)  AS totalLoss
         FROM ExpiredStock_tbl`
      ),
      db.query(
        `SELECT
           COALESCE(c.CatiguaryName, 'غير محدد') AS category,
           COUNT(*)                               AS records,
           COALESCE(SUM(e.ExpiredQty), 0)         AS totalQty,
           COALESCE(SUM(e.TotalLoss),  0)         AS totalLoss
         FROM ExpiredStock_tbl e
         JOIN Materials_tbl m ON m.id_Material_NoM = e.id_Material_NoM
         LEFT JOIN Catiguary_tbl c ON c.id_Catiguary = m.id_Catiguary
         GROUP BY m.id_Catiguary
         ORDER BY totalLoss DESC`
      ),
      db.query(
        `SELECT
           strftime('%Y-%m', ProcessedDate) AS month,
           COUNT(*)                         AS records,
           COALESCE(SUM(TotalLoss), 0)      AS totalLoss
         FROM ExpiredStock_tbl
         GROUP BY month
         ORDER BY month DESC
         LIMIT 12`
      ),
      // عدد الدفعات المنتهية التي لم تُشطب بعد
      db.queryOne(`
        SELECT COUNT(*) AS pendingCount,
               COALESCE(SUM(
                 di.AmountIN - COALESCE(
                   (SELECT SUM(ex.ExpiredQty) FROM ExpiredStock_tbl ex WHERE ex.id_DetailsIN = di.id_DetailsIN),
                   0
                 )
               ), 0) AS pendingQty
        FROM DetailsIN_tbl di
        WHERE di.ExpairDate IS NOT NULL
          AND di.ExpairDate != ''
          AND di.ExpairDate < date('now')
          AND di.AmountIN > COALESCE(
            (SELECT SUM(ex.ExpiredQty) FROM ExpiredStock_tbl ex WHERE ex.id_DetailsIN = di.id_DetailsIN),
            0
          )
      `),
    ]);

    res.json({
      success: true,
      data: {
        totals: {
          records   : totals?.records    || 0,
          totalQty  : totals?.totalQty   || 0,
          totalLoss : r2(totals?.totalLoss || 0),
        },
        pending: {
          count : pending?.pendingCount || 0,
          qty   : pending?.pendingQty  || 0,
        },
        byCategory: byCategory.map(r => ({ ...r, totalLoss: r2(r.totalLoss) })),
        byMonth   : byMonth.map(r => ({ ...r, totalLoss: r2(r.totalLoss) })),
      },
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ══════════════════════════════════════════════════════════
//  دالة الشطب التلقائي عند بدء التشغيل
//  تُستدعى من server.js بصمت
// ══════════════════════════════════════════════════════════
const autoProcessOnStartup = async () => {
  const today = new Date().toISOString().split("T")[0];
  try {
    const pending = await db.query(`
      SELECT di.id_DetailsIN, di.id_Material_NoM,
             di.AmountIN AS purchasedQty, di.PriceIN AS costPrice, di.ExpairDate,
             COALESCE(
               (SELECT SUM(ex.ExpiredQty) FROM ExpiredStock_tbl ex WHERE ex.id_DetailsIN = di.id_DetailsIN),
               0
             ) AS alreadyWrittenOff
      FROM DetailsIN_tbl di
      WHERE di.ExpairDate IS NOT NULL AND di.ExpairDate != '' AND di.ExpairDate < ?
    `, [today]);

    const toProcess = pending.filter(r =>
      Math.max(0, r.purchasedQty - r.alreadyWrittenOff) > 0
    );
    if (!toProcess.length) return;

    await db.run("BEGIN TRANSACTION");
    for (const item of toProcess) {
      const qty = Math.max(0, item.purchasedQty - item.alreadyWrittenOff);
      if (qty <= 0) continue;
      await db.run(
        `INSERT INTO ExpiredStock_tbl
           (id_Material_NoM, id_DetailsIN, ExpiredQty, CostPrice, TotalLoss, ExpairDate, ProcessedDate, Notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [item.id_Material_NoM, item.id_DetailsIN, qty,
         item.costPrice, r2(qty * item.costPrice),
         item.ExpairDate, today, "شطب تلقائي عند بدء التشغيل"]
      );
      await db.run(
        `UPDATE Stock_tbl
         SET QuantityOUT = QuantityOUT + ?,
             QuantityOnHand = MAX(0, QuantityOnHand - ?),
             LastUpdateDate = datetime('now')
         WHERE id_Material_NoM = ?`,
        [qty, qty, item.id_Material_NoM]
      );
    }
    await db.run("COMMIT");
    console.log(`✅ تم شطب ${toProcess.length} دفعة منتهية الصلاحية تلقائياً`);
  } catch (e) {
    await db.run("ROLLBACK").catch(() => {});
    console.error("❌ خطأ في الشطب التلقائي:", e.message);
  }
};

module.exports = {
  getAll, getPending, processAll, processOne, getSummary, autoProcessOnStartup,
  materialExpiryAlert,
};
