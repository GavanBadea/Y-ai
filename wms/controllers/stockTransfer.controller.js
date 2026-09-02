// controllers/stockTransfer.controller.js — نقل مخزني بين المستودعات
const db = require("../db");
const { addWarehouseQty, subtractWarehouseQty, r2 } = require("../utils/warehouseStock");

const list = async (req, res) => {
  const { from, to } = req.query;
  const dateFrom = from || "2000-01-01";
  const dateTo   = to   || new Date().toISOString().split("T")[0];
  try {
    const rows = await db.query(
      `SELECT t.id_Transfer AS id, t.Date_Transfer AS date, t.Note_Transfer AS note,
              wf.WarehouseName AS fromName, wt.WarehouseName AS toName,
              (SELECT COUNT(*) FROM Stock_Transfer_Lines_tbl l WHERE l.id_Transfer = t.id_Transfer) AS lineCount,
              (SELECT COALESCE(SUM(l.Quantity), 0) FROM Stock_Transfer_Lines_tbl l WHERE l.id_Transfer = t.id_Transfer) AS totalQty
       FROM Stock_Transfer_tbl t
       JOIN Warehouses_tbl wf ON wf.id_Warehouse = t.id_Warehouse_From
       JOIN Warehouses_tbl wt ON wt.id_Warehouse = t.id_Warehouse_To
       WHERE t.Date_Transfer BETWEEN ? AND ?
       ORDER BY t.Date_Transfer DESC, t.id_Transfer DESC`,
      [dateFrom, dateTo]
    );
    res.json({ success: true, data: rows, dateFrom, dateTo });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

const getOne = async (req, res) => {
  try {
    const hdr = await db.queryOne(
      `SELECT t.*, wf.WarehouseName AS fromName, wt.WarehouseName AS toName
       FROM Stock_Transfer_tbl t
       JOIN Warehouses_tbl wf ON wf.id_Warehouse = t.id_Warehouse_From
       JOIN Warehouses_tbl wt ON wt.id_Warehouse = t.id_Warehouse_To
       WHERE t.id_Transfer = ?`,
      [req.params.id]
    );
    if (!hdr) return res.status(404).json({ success: false, message: "إذن النقل غير موجود" });

    const lines = await db.query(
      `SELECT l.*, m.MaterialName, m.Band
       FROM Stock_Transfer_Lines_tbl l
       JOIN Materials_tbl m ON m.id_Material_NoM = l.id_Material_NoM
       WHERE l.id_Transfer = ?`,
      [req.params.id]
    );
    res.json({ success: true, data: { ...hdr, lines } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

const create = async (req, res) => {
  const {
    Date_Transfer,
    id_Warehouse_From,
    id_Warehouse_To,
    Note_Transfer = "",
    lines = [],
  } = req.body;

  const fromId = Number(id_Warehouse_From);
  const toId   = Number(id_Warehouse_To);
  if (!fromId || !toId)
    return res.status(400).json({ success: false, message: "المستودع المصدر والوجهة مطلوبان" });
  if (fromId === toId)
    return res.status(400).json({ success: false, message: "لا يمكن النقل لنفس المستودع" });
  if (!Array.isArray(lines) || !lines.length)
    return res.status(400).json({ success: false, message: "أضف مادة واحدة على الأقل" });

  const today = new Date().toISOString().split("T")[0];
  const txDate = Date_Transfer || today;

  try {
    const wf = await db.queryOne(
      `SELECT * FROM Warehouses_tbl WHERE id_Warehouse = ? AND IsActive = 1`, [fromId]
    );
    const wt = await db.queryOne(
      `SELECT * FROM Warehouses_tbl WHERE id_Warehouse = ? AND IsActive = 1`, [toId]
    );
    if (!wf || !wt)
      return res.status(400).json({ success: false, message: "المستودع غير موجود أو غير نشط" });

    const prepared = [];
    for (const ln of lines) {
      const id_Material_NoM = Number(ln.id_Material_NoM);
      const qty = r2(ln.Quantity);
      if (!id_Material_NoM || qty <= 0)
        return res.status(400).json({ success: false, message: "كل سطر يحتاج مادة وكمية أكبر من صفر" });
      const mat = await db.queryOne(
        `SELECT MaterialName, Band FROM Materials_tbl WHERE id_Material_NoM = ?`,
        [id_Material_NoM]
      );
      if (!mat) return res.status(400).json({ success: false, message: `المادة ${id_Material_NoM} غير موجودة` });
      prepared.push({ id_Material_NoM, qty, MaterialName: mat.MaterialName, Band: mat.Band });
    }

    await db.run("BEGIN TRANSACTION");

    const hdr = await db.run(
      `INSERT INTO Stock_Transfer_tbl (Date_Transfer, id_Warehouse_From, id_Warehouse_To, Note_Transfer)
       VALUES (?, ?, ?, ?)`,
      [txDate, fromId, toId, Note_Transfer]
    );
    const transferId = hdr.lastID;

    for (const ln of prepared) {
      await subtractWarehouseQty(ln.id_Material_NoM, fromId, ln.qty);
      await addWarehouseQty(ln.id_Material_NoM, toId, ln.qty);
      await db.run(
        `INSERT INTO Stock_Transfer_Lines_tbl (id_Transfer, id_Material_NoM, Quantity)
         VALUES (?, ?, ?)`,
        [transferId, ln.id_Material_NoM, ln.qty]
      );
    }

    await db.run("COMMIT");

    res.status(201).json({
      success: true,
      message: "تم حفظ حركة النقل",
      transferId,
      printData: {
        transferId,
        date: txDate,
        fromName: wf.WarehouseName,
        toName: wt.WarehouseName,
        note: Note_Transfer,
        lines: prepared,
      },
    });
  } catch (e) {
    await db.run("ROLLBACK").catch(() => {});
    res.status(500).json({ success: false, message: e.message });
  }
};

module.exports = { list, getOne, create };
