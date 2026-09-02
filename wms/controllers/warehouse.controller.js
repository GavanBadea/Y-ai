// controllers/warehouse.controller.js — إدارة المستودعات
const db = require("../db");
const { getWarehouseQty } = require("../utils/warehouseStock");

const listActive = async (_req, res) => {
  try {
    const rows = await db.query(
      `SELECT id_Warehouse AS id, WarehouseName AS name, Location AS location,
              Manager AS manager, IsActive AS isActive
       FROM Warehouses_tbl
       WHERE IsActive = 1
       ORDER BY WarehouseName`
    );
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

const listAll = async (_req, res) => {
  try {
    const rows = await db.query(
      `SELECT id_Warehouse AS id, WarehouseName AS name, Location AS location,
              Manager AS manager, IsActive AS isActive
       FROM Warehouses_tbl
       ORDER BY IsActive DESC, WarehouseName`
    );
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

const create = async (req, res) => {
  const { name, location = "", manager = "", isActive = 1 } = req.body;
  if (!String(name || "").trim())
    return res.status(400).json({ success: false, message: "اسم المستودع مطلوب" });
  try {
    const r = await db.run(
      `INSERT INTO Warehouses_tbl (WarehouseName, Location, Manager, IsActive)
       VALUES (?, ?, ?, ?)`,
      [String(name).trim(), String(location).trim(), String(manager).trim(), isActive ? 1 : 0]
    );
    res.status(201).json({ success: true, message: "تم إنشاء المستودع", id: r.lastID });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

const update = async (req, res) => {
  const { name, location, manager, isActive } = req.body;
  try {
    const exists = await db.queryOne(
      `SELECT id_Warehouse FROM Warehouses_tbl WHERE id_Warehouse = ?`,
      [req.params.id]
    );
    if (!exists) return res.status(404).json({ success: false, message: "المستودع غير موجود" });

    await db.run(
      `UPDATE Warehouses_tbl SET
         WarehouseName = COALESCE(?, WarehouseName),
         Location      = COALESCE(?, Location),
         Manager       = COALESCE(?, Manager),
         IsActive      = COALESCE(?, IsActive)
       WHERE id_Warehouse = ?`,
      [
        name != null ? String(name).trim() : null,
        location != null ? String(location).trim() : null,
        manager != null ? String(manager).trim() : null,
        isActive != null ? (isActive ? 1 : 0) : null,
        req.params.id,
      ]
    );
    res.json({ success: true, message: "تم تحديث المستودع" });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

const getMaterialQty = async (req, res) => {
  try {
    const qty = await getWarehouseQty(req.params.materialId, req.params.id);
    res.json({ success: true, qty });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

const remove = async (req, res) => {
  try {
    const id = req.params.id;
    const exists = await db.queryOne(
      `SELECT id_Warehouse FROM Warehouses_tbl WHERE id_Warehouse = ?`,
      [id]
    );
    if (!exists)
      return res.status(404).json({ success: false, message: "المستودع غير موجود" });

    const [fin, fout, transfers, stock] = await Promise.all([
      db.queryOne(`SELECT COUNT(*) AS cnt FROM FIN_tbl WHERE id_Warehouse = ?`, [id]),
      db.queryOne(`SELECT COUNT(*) AS cnt FROM DetailsOUT_tbl WHERE id_Warehouse = ?`, [id]),
      db.queryOne(
        `SELECT COUNT(*) AS cnt FROM Stock_Transfer_tbl
         WHERE id_Warehouse_From = ? OR id_Warehouse_To = ?`,
        [id, id]
      ),
      db.queryOne(
        `SELECT COUNT(*) AS cnt FROM Product_Warehouse_tbl
         WHERE id_Warehouse = ? AND QuantityOnHand > 0`,
        [id]
      ),
    ]);

    const blocks = [];
    if (fin.cnt > 0)       blocks.push(`فواتير شراء (${fin.cnt})`);
    if (fout.cnt > 0)      blocks.push(`حركات مبيعات (${fout.cnt})`);
    if (transfers.cnt > 0) blocks.push(`تحويلات مخزنية (${transfers.cnt})`);
    if (stock.cnt > 0)     blocks.push(`مواد بمخزون (${stock.cnt})`);

    if (blocks.length) {
      return res.status(409).json({
        success : false,
        message : `لا يمكن حذف المستودع لارتباطه ببيانات: ${blocks.join("، ")}`,
      });
    }

    await db.run(`DELETE FROM Product_Warehouse_tbl WHERE id_Warehouse = ?`, [id]);
    const r = await db.run(`DELETE FROM Warehouses_tbl WHERE id_Warehouse = ?`, [id]);
    if (!r.changes)
      return res.status(404).json({ success: false, message: "المستودع غير موجود" });

    res.json({ success: true, message: "تم حذف المستودع" });
  } catch (e) {
    if (e.message?.includes("FOREIGN KEY")) {
      return res.status(409).json({
        success : false,
        message : "لا يمكن حذف المستودع لارتباطه ببيانات أخرى في النظام",
      });
    }
    res.status(500).json({ success: false, message: e.message });
  }
};

module.exports = { listActive, listAll, create, update, remove, getMaterialQty };
