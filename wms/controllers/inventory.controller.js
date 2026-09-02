// ============================================================
//  controllers/inventory.controller.js
//  لوحة تحكم المخزون — Inventory Dashboard
// ============================================================
const db = require("../db");
const { ensureWACRecalc } = require("../utils/recalcMaterialWAC");
const {
  PURCHASE_LC_SUM_SQL,
  PURCHASE_LINE_STOCK_VALUE_SQL,
  PURCHASE_INV_LINES_SUBQUERY,
} = require("../utils/purchaseLineCost");

const r2 = (n) => Math.round((+n || 0) * 1000) / 1000;

// ── KPI Cards ────────────────────────────────────────────
const getKPIs = async (_req, res) => {
  try {
    await ensureWACRecalc();

    const [totals, lowStock] = await Promise.all([

      // إجمالي الأصناف + قيمة المخزون
      db.queryOne(`
        SELECT
          COUNT(DISTINCT m.id_Material_NoM)                          AS totalItems,
          ROUND(SUM(COALESCE(s.QuantityOnHand,0) * COALESCE(m."Cost Price",0)), 2)
                                                                     AS stockValue,
          SUM(CASE WHEN COALESCE(s.QuantityOnHand,0) <= 0 THEN 1 ELSE 0 END)
                                                                     AS outOfStock
        FROM Materials_tbl m
        LEFT JOIN Stock_tbl s ON s.id_Material_NoM = m.id_Material_NoM
      `),

      // المواد التي أوشكت على النفاذ (مخزون بين 1 و 10)
      db.queryOne(`
        SELECT COUNT(*) AS lowStock
        FROM Stock_tbl
        WHERE QuantityOnHand > 0 AND QuantityOnHand <= 10
      `),
    ]);

    res.json({
      success : true,
      data    : {
        totalItems  : totals?.totalItems  || 0,
        stockValue  : totals?.stockValue  || 0,
        outOfStock  : totals?.outOfStock  || 0,
        lowStock    : lowStock?.lowStock  || 0,
      },
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── أكثر 5 مواد مبيعاً ──────────────────────────────────
const getTopSelling = async (_req, res) => {
  try {
    const rows = await db.query(`
      SELECT
        m.MaterialName,
        c.CatiguaryName,
        ROUND(SUM(d.AmountOUT), 2)                  AS totalSold,
        ROUND(SUM(d.AmountOUT * d.PriceOUT), 2)     AS totalRevenue
      FROM DetailsOUT_tbl d
      JOIN Materials_tbl  m ON m.id_Material_NoM = d.id_Material_NoM
      LEFT JOIN Catiguary_tbl c ON c.id_Catiguary = m.id_Catiguary
      GROUP BY d.id_Material_NoM
      ORDER BY totalSold DESC
      LIMIT 5
    `);
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── توزيع المخزون حسب التصنيف ───────────────────────────
const getByCategory = async (_req, res) => {
  try {
    await ensureWACRecalc();
    const rows = await db.query(`
      SELECT
        COALESCE(c.CatiguaryName, 'غير مصنّف')      AS category,
        COUNT(m.id_Material_NoM)                     AS itemCount,
        ROUND(SUM(COALESCE(s.QuantityOnHand, 0)), 2) AS totalQty,
        ROUND(SUM(COALESCE(s.QuantityOnHand,0) * COALESCE(m."Cost Price",0)), 2)
                                                     AS totalValue
      FROM Materials_tbl m
      LEFT JOIN Catiguary_tbl c ON c.id_Catiguary    = m.id_Catiguary
      LEFT JOIN Stock_tbl     s ON s.id_Material_NoM = m.id_Material_NoM
      GROUP BY m.id_Catiguary
      ORDER BY totalValue DESC
    `);
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── المواد منخفضة المخزون (تنبيهات) ─────────────────────
const getLowStock = async (_req, res) => {
  try {
    const rows = await db.query(`
      SELECT
        m.id_Material_NoM,
        m.MaterialName,
        m.Barcode,
        m.Band,
        COALESCE(c.CatiguaryName, '—')               AS CatiguaryName,
        COALESCE(s.QuantityOnHand, 0)                AS QuantityOnHand,
        COALESCE(m."Cost Price", 0)                  AS CostPrice,
        COALESCE(sp.LastSellPrice, 0)                AS LastSellPrice
      FROM Materials_tbl m
      LEFT JOIN Catiguary_tbl c  ON c.id_Catiguary    = m.id_Catiguary
      LEFT JOIN Stock_tbl     s  ON s.id_Material_NoM  = m.id_Material_NoM
      LEFT JOIN SellPrice_tbl sp ON sp.id_Material_NoM = m.id_Material_NoM
      WHERE COALESCE(s.QuantityOnHand, 0) <= 10
      ORDER BY QuantityOnHand ASC
      LIMIT 50
    `);
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── قائمة كل المواد (بحث + جرد) ─────────────────────────
const getAllStock = async (req, res) => {
  try {
    await ensureWACRecalc();
    const { q = "", page = 1, limit = 50 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    const like   = `%${q}%`;

    const [rows, total] = await Promise.all([
      db.query(`
        SELECT
          m.id_Material_NoM,
          m.MaterialName,
          m.Barcode,
          m.Band,
          COALESCE(c.CatiguaryName, '—')              AS CatiguaryName,
          COALESCE(s.QuantityOnHand, 0)               AS QuantityOnHand,
          COALESCE(m."Cost Price", 0)                 AS CostPrice,
          COALESCE(sp.LastSellPrice, 0)               AS LastSellPrice,
          COALESCE(sp.SellPrice1, 0)                  AS SellPrice1
        FROM Materials_tbl m
        LEFT JOIN Catiguary_tbl c  ON c.id_Catiguary    = m.id_Catiguary
        LEFT JOIN Stock_tbl     s  ON s.id_Material_NoM  = m.id_Material_NoM
        LEFT JOIN SellPrice_tbl sp ON sp.id_Material_NoM = m.id_Material_NoM
        WHERE m.MaterialName LIKE ? OR CAST(m.Barcode AS TEXT) LIKE ?
        ORDER BY m.MaterialName
        LIMIT ? OFFSET ?
      `, [like, like, Number(limit), offset]),

      db.queryOne(`
        SELECT COUNT(*) AS cnt
        FROM Materials_tbl m
        WHERE m.MaterialName LIKE ? OR CAST(m.Barcode AS TEXT) LIKE ?
      `, [like, like]),
    ]);

    res.json({
      success    : true,
      data       : rows,
      total      : total?.cnt || 0,
      page       : Number(page),
      totalPages : Math.ceil((total?.cnt || 0) / Number(limit)),
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── المخزون حسب المستودع (ملخص أو تفاصيل مادة) ─────────
const getByWarehouse = async (req, res) => {
  try {
    const { warehouseId, q = "", page = 1, limit = 50 } = req.query;

    if (!warehouseId) {
      const rows = await db.query(`
        SELECT
          w.id_Warehouse,
          w.WarehouseName,
          w.Location,
          COUNT(DISTINCT CASE WHEN COALESCE(pw.QuantityOnHand, 0) > 0 THEN pw.id_Material_NoM END) AS itemCount,
          ROUND(COALESCE(SUM(pw.QuantityOnHand), 0), 2) AS totalQty,
          ROUND(COALESCE(SUM(pw.QuantityOnHand * COALESCE(m."Cost Price", 0)), 0), 2) AS totalValue
        FROM Warehouses_tbl w
        LEFT JOIN Product_Warehouse_tbl pw ON pw.id_Warehouse = w.id_Warehouse
        LEFT JOIN Materials_tbl m ON m.id_Material_NoM = pw.id_Material_NoM
        WHERE w.IsActive = 1
        GROUP BY w.id_Warehouse
        ORDER BY w.WarehouseName
      `);
      return res.json({ success: true, data: rows });
    }

    const offset = (Number(page) - 1) * Number(limit);
    const like   = `%${q}%`;
    const whId   = Number(warehouseId);

    const [rows, total, wh] = await Promise.all([
      db.query(`
        SELECT
          m.id_Material_NoM,
          m.MaterialName,
          m.Barcode,
          m.Band,
          COALESCE(c.CatiguaryName, '—')              AS CatiguaryName,
          COALESCE(pw.QuantityOnHand, 0)              AS QuantityOnHand,
          COALESCE(m."Cost Price", 0)                 AS CostPrice,
          COALESCE(sp.LastSellPrice, 0)               AS LastSellPrice
        FROM Product_Warehouse_tbl pw
        JOIN Materials_tbl m ON m.id_Material_NoM = pw.id_Material_NoM
        LEFT JOIN Catiguary_tbl c  ON c.id_Catiguary    = m.id_Catiguary
        LEFT JOIN SellPrice_tbl sp ON sp.id_Material_NoM = m.id_Material_NoM
        WHERE pw.id_Warehouse = ?
          AND COALESCE(pw.QuantityOnHand, 0) > 0
          AND (m.MaterialName LIKE ? OR CAST(m.Barcode AS TEXT) LIKE ?)
        ORDER BY m.MaterialName
        LIMIT ? OFFSET ?
      `, [whId, like, like, Number(limit), offset]),

      db.queryOne(`
        SELECT COUNT(*) AS cnt
        FROM Product_Warehouse_tbl pw
        JOIN Materials_tbl m ON m.id_Material_NoM = pw.id_Material_NoM
        WHERE pw.id_Warehouse = ?
          AND COALESCE(pw.QuantityOnHand, 0) > 0
          AND (m.MaterialName LIKE ? OR CAST(m.Barcode AS TEXT) LIKE ?)
      `, [whId, like, like]),

      db.queryOne(
        `SELECT id_Warehouse, WarehouseName, Location FROM Warehouses_tbl WHERE id_Warehouse = ?`,
        [whId]
      ),
    ]);

    res.json({
      success    : true,
      warehouse  : wh || null,
      data       : rows,
      total      : total?.cnt || 0,
      page       : Number(page),
      totalPages : Math.ceil((total?.cnt || 0) / Number(limit)),
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── حركات مادة في مستودع محدد ───────────────────────────
const getWarehouseMovements = async (req, res) => {
  try {
    const { id_Material, warehouseId, from, to } = req.query;
    if (!id_Material || !warehouseId)
      return res.status(400).json({ success: false, message: "المادة والمستودع مطلوبان" });

    const matId = Number(id_Material);
    const whId  = Number(warehouseId);
    const year  = new Date().getFullYear();
    const dateFrom = from || `${year}-01-01`;
    const dateTo   = to   || new Date().toISOString().split("T")[0];

    const material = await db.queryOne(`
      SELECT m.MaterialName AS name, m.Band AS unit, m.Barcode AS barcode,
             COALESCE(pw.QuantityOnHand, 0) AS currentStock,
             w.WarehouseName
      FROM Materials_tbl m
      LEFT JOIN Product_Warehouse_tbl pw
        ON pw.id_Material_NoM = m.id_Material_NoM AND pw.id_Warehouse = ?
      LEFT JOIN Warehouses_tbl w ON w.id_Warehouse = ?
      WHERE m.id_Material_NoM = ?
    `, [whId, whId, matId]);

    if (!material)
      return res.status(404).json({ success: false, message: "المادة غير موجودة" });

    const openRow = await db.queryOne(`
      SELECT (
        COALESCE((
          SELECT SUM(d.AmountIN + COALESCE(d.Gift_IN, 0)) FROM DetailsIN_tbl d
          JOIN FIN_tbl f ON f.id_NoFIN = d.id_NoFIN
          WHERE d.id_Material_NoM = ? AND f.id_Warehouse = ? AND f.Date_FIN < ?
        ), 0)
        - COALESCE((
          SELECT SUM(d.AmountOUT + COALESCE(d.gift_qty, 0)) FROM DetailsOUT_tbl d
          JOIN FOUT_tbl f ON f.id_NoFOUT = d.id_NoFOUT
          WHERE d.id_Material_NoM = ? AND d.id_Warehouse = ? AND f.Date_FOUT < ?
        ), 0)
        + COALESCE((
          SELECT SUM(stl.Quantity) FROM Stock_Transfer_Lines_tbl stl
          JOIN Stock_Transfer_tbl t ON t.id_Transfer = stl.id_Transfer
          WHERE stl.id_Material_NoM = ? AND t.id_Warehouse_To = ? AND t.Date_Transfer < ?
        ), 0)
        - COALESCE((
          SELECT SUM(stl.Quantity) FROM Stock_Transfer_Lines_tbl stl
          JOIN Stock_Transfer_tbl t ON t.id_Transfer = stl.id_Transfer
          WHERE stl.id_Material_NoM = ? AND t.id_Warehouse_From = ? AND t.Date_Transfer < ?
        ), 0)
      ) AS openQty
    `, [
      matId, whId, dateFrom,
      matId, whId, dateFrom,
      matId, whId, dateFrom,
      matId, whId, dateFrom,
    ]);

    const openingQty = r2(openRow?.openQty || 0);

    const rows = await db.query(`
      SELECT
        f.Date_FIN                                     AS txDate,
        'شراء'                                         AS txType,
        a.AmilName                                     AS party,
        f.id_NoFIN                                     AS txRef,
        d.AmountIN                                     AS qty,
        COALESCE(d.Gift_IN, 0)                         AS giftQty,
        d.PriceIN                                      AS price,
        ROUND(CASE WHEN invLt.linesTotal > 0
          THEN (d.AmountIN * d.PriceIN * 1.0 / invLt.linesTotal) * ${PURCHASE_LC_SUM_SQL}
          ELSE 0 END, 0)                               AS lcShare,
        ROUND(CASE WHEN invLt.linesTotal > 0
          THEN (d.AmountIN * d.PriceIN * 1.0 / invLt.linesTotal) * COALESCE(f.Dis_FIN, 0)
          ELSE 0 END, 0)                               AS discountShare,
        ${PURCHASE_LINE_STOCK_VALUE_SQL}               AS lineTotal,
        1                                              AS qtySign
      FROM DetailsIN_tbl d
      JOIN FIN_tbl f ON f.id_NoFIN = d.id_NoFIN
      JOIN Amil_tbl a ON a.id_Amil = f.id_Amil
      JOIN ${PURCHASE_INV_LINES_SUBQUERY}
      WHERE d.id_Material_NoM = ? AND f.id_Warehouse = ? AND f.Date_FIN BETWEEN ? AND ?

      UNION ALL

      SELECT
        f.Date_FOUT,
        'بيع',
        z.ZabonName,
        f.id_NoFOUT,
        d.AmountOUT,
        COALESCE(d.gift_qty, 0),
        d.PriceOUT,
        0,
        0,
        ROUND(d.AmountOUT * d.PriceOUT, 0),
        -1
      FROM DetailsOUT_tbl d
      JOIN FOUT_tbl f ON f.id_NoFOUT = d.id_NoFOUT
      JOIN Zabon_tbl z ON z.id_Zabon = f.id_Zabon
      WHERE d.id_Material_NoM = ? AND d.id_Warehouse = ? AND f.Date_FOUT BETWEEN ? AND ?

      UNION ALL

      SELECT
        t.Date_Transfer,
        'نقل وارد',
        'من: ' || COALESCE(wf.WarehouseName, ''),
        t.id_Transfer,
        stl.Quantity,
        0,
        0,
        0,
        0,
        0,
        1
      FROM Stock_Transfer_Lines_tbl stl
      JOIN Stock_Transfer_tbl t ON t.id_Transfer = stl.id_Transfer
      LEFT JOIN Warehouses_tbl wf ON wf.id_Warehouse = t.id_Warehouse_From
      WHERE stl.id_Material_NoM = ? AND t.id_Warehouse_To = ? AND t.Date_Transfer BETWEEN ? AND ?

      UNION ALL

      SELECT
        t.Date_Transfer,
        'نقل صادر',
        'إلى: ' || COALESCE(wt.WarehouseName, ''),
        t.id_Transfer,
        stl.Quantity,
        0,
        0,
        0,
        0,
        0,
        -1
      FROM Stock_Transfer_Lines_tbl stl
      JOIN Stock_Transfer_tbl t ON t.id_Transfer = stl.id_Transfer
      LEFT JOIN Warehouses_tbl wt ON wt.id_Warehouse = t.id_Warehouse_To
      WHERE stl.id_Material_NoM = ? AND t.id_Warehouse_From = ? AND t.Date_Transfer BETWEEN ? AND ?

      ORDER BY txDate ASC, txType ASC, txRef ASC
    `, [
      matId, whId, dateFrom, dateTo,
      matId, whId, dateFrom, dateTo,
      matId, whId, dateFrom, dateTo,
      matId, whId, dateFrom, dateTo,
    ]);

    let runQty = openingQty;
    const data = rows.map((r) => {
      const moveQty = (r.txType === "بيع" || r.txType === "شراء")
        ? r.qty + (+r.giftQty || 0)
        : r.qty;
      runQty = r2(runQty + r.qtySign * moveQty);
      return { ...r, giftQty: r2(+r.giftQty || 0), runningQty: runQty };
    });

    res.json({
      success: true,
      dateFrom,
      dateTo,
      warehouse: { id: whId, name: material.WarehouseName },
      material: {
        name: material.name,
        unit: material.unit,
        barcode: material.barcode,
        currentStock: material.currentStock,
      },
      openingQty,
      data,
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

module.exports = { getKPIs, getTopSelling, getByCategory, getLowStock, getAllStock, getByWarehouse, getWarehouseMovements };
