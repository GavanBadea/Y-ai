// controllers/stock.controller.js  —  جدول تتبع المخزون Stock_tbl
const db = require("../db");

// ─── كامل المخزون مع فلترة ─────────────────────────────────
const getAll = async (req, res) => {
  try {
    const { search, low, id_Catiguary } = req.query;
    let sql = `
      SELECT s.*, m.MaterialName, m.Band, m."Cost Price", m.id_Catiguary,
             c.CatiguaryName, t.TypeName,
             sp.SellPrice1, sp.LastSellPrice,
             (s.QuantityOnHand * m."Cost Price") AS StockValue
      FROM Stock_tbl s
      JOIN Materials_tbl m ON m.id_Material_NoM = s.id_Material_NoM
      LEFT JOIN Catiguary_tbl c ON c.id_Catiguary=m.id_Catiguary
      LEFT JOIN Type_tbl      t ON t.id_Type=m.id_Type
      LEFT JOIN SellPrice_tbl sp ON sp.id_Material_NoM=m.id_Material_NoM
      WHERE 1=1`;
    const p = [];
    if (search)      { sql += " AND m.MaterialName LIKE ?"; p.push(`%${search}%`); }
    if (low)         { sql += " AND s.QuantityOnHand<=?";   p.push(Number(low)); }
    if (id_Catiguary){ sql += " AND m.id_Catiguary=?";      p.push(id_Catiguary); }
    sql += " ORDER BY m.MaterialName";
    const rows = await db.query(sql, p);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ─── ملخص المخزون (للداشبورد) ──────────────────────────────
const getSummary = async (_req, res) => {
  try {
    const summary = await db.queryOne(`
      SELECT
        COUNT(*)                                          AS TotalItems,
        SUM(s.QuantityIN)                                AS TotalIN,
        SUM(s.QuantityOUT)                               AS TotalOUT,
        SUM(s.QuantityReturn)                            AS TotalReturn,
        SUM(s.QuantityOnHand)                            AS TotalOnHand,
        SUM(s.QuantityOnHand * m."Cost Price")           AS TotalCostValue
      FROM Stock_tbl s
      JOIN Materials_tbl m ON m.id_Material_NoM=s.id_Material_NoM`);
    res.json({ success: true, data: summary });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ─── مخزون مادة واحدة ──────────────────────────────────────
const getOne = async (req, res) => {
  try {
    const row = await db.queryOne(`
      SELECT s.*, m.MaterialName, m.Band, m."Cost Price", sp.LastSellPrice
      FROM Stock_tbl s
      JOIN Materials_tbl m ON m.id_Material_NoM=s.id_Material_NoM
      LEFT JOIN SellPrice_tbl sp ON sp.id_Material_NoM=m.id_Material_NoM
      WHERE s.id_Material_NoM=?`, [req.params.materialId]);
    if (!row) return res.status(404).json({ success: false, message: "لا يوجد مخزون لهذه المادة" });
    res.json({ success: true, data: row });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ─── حركة مادة (شراء + بيع + إرجاع) ──────────────────────
const getMovement = async (req, res) => {
  try {
    const id = req.params.materialId;
    const [ins, outs, rets] = await Promise.all([
      db.query(
        `SELECT 'شراء' AS MovType, d.AmountIN AS Qty, d.PriceIN AS Price,
                f.Date_FIN AS Date, a.AmilName AS Party, f.id_NoFIN AS DocNo
         FROM DetailsIN_tbl d
         JOIN FIN_tbl f ON f.id_NoFIN=d.id_NoFIN
         LEFT JOIN Amil_tbl a ON a.id_Amil=f.id_Amil
         WHERE d.id_Material_NoM=?`, [id]),
      db.query(
        `SELECT 'بيع' AS MovType, d.AmountOUT AS Qty, d.PriceOUT AS Price,
                f.Date_FOUT AS Date, z.ZabonName AS Party, f.id_NoFOUT AS DocNo
         FROM DetailsOUT_tbl d
         JOIN FOUT_tbl f ON f.id_NoFOUT=d.id_NoFOUT
         LEFT JOIN Zabon_tbl z ON z.id_Zabon=f.id_Zabon
         WHERE d.id_Material_NoM=?`, [id]),
      db.query(
        `SELECT 'إرجاع' AS MovType, d.AmountOUT AS Qty, d.PriceOUT AS Price,
                f.Date_FRetern AS Date, '' AS Party, f.id_NoFRetern AS DocNo
         FROM DetailsRetern_tbl d
         JOIN FRetern_tbl f ON f.id_NoFRetern=d.id_NoFRetern
         WHERE d.id_Material_NoM=?`, [id]),
    ]);
    const all = [...ins, ...outs, ...rets].sort((a, b) => new Date(b.Date) - new Date(a.Date));
    res.json({ success: true, count: all.length, data: all });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ─── تعديل يدوي (جرد) ─────────────────────────────────────
const manualAdjust = async (req, res) => {
  const { id_Material_NoM, newQuantity } = req.body;
  if (!id_Material_NoM || newQuantity === undefined)
    return res.status(400).json({ success: false, message: "المادة والكمية مطلوبتان" });
  try {
    await db.run(
      `UPDATE Stock_tbl SET QuantityOnHand=?, LastUpdateDate=datetime('now') WHERE id_Material_NoM=?`,
      [newQuantity, id_Material_NoM]);
    res.json({ success: true, message: "تم تعديل المخزون يدوياً" });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

module.exports = { getAll, getSummary, getOne, getMovement, manualAdjust };
