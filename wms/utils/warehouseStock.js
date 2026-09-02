// utils/warehouseStock.js — كميات المخزون لكل مستودع
const db = require("../db");

const r2 = (n) => Math.round((+n || 0) * 1000) / 1000;

async function getWarehouseQty(id_Material_NoM, id_Warehouse) {
  const row = await db.queryOne(
    `SELECT COALESCE(QuantityOnHand, 0) AS qty
     FROM Product_Warehouse_tbl
     WHERE id_Material_NoM = ? AND id_Warehouse = ?`,
    [id_Material_NoM, id_Warehouse]
  );
  return r2(row?.qty || 0);
}

async function addWarehouseQty(id_Material_NoM, id_Warehouse, qty) {
  const q = r2(qty);
  if (!id_Warehouse || q <= 0) return;
  await db.run(
    `INSERT INTO Product_Warehouse_tbl (id_Material_NoM, id_Warehouse, QuantityOnHand)
     VALUES (?, ?, ?)
     ON CONFLICT(id_Material_NoM, id_Warehouse) DO UPDATE SET
       QuantityOnHand = QuantityOnHand + excluded.QuantityOnHand`,
    [id_Material_NoM, id_Warehouse, q]
  );
}

async function subtractWarehouseQty(id_Material_NoM, id_Warehouse, qty, allowNegative = false) {
  const q = r2(qty);
  if (!id_Warehouse || q <= 0) return;
  const have = await getWarehouseQty(id_Material_NoM, id_Warehouse);
  if (!allowNegative && have < q)
    throw new Error(`الكمية غير كافية في المستودع (متوفر: ${have})`);
  await db.run(
    `UPDATE Product_Warehouse_tbl SET QuantityOnHand = QuantityOnHand - ?
     WHERE id_Material_NoM = ? AND id_Warehouse = ?`,
    [q, id_Material_NoM, id_Warehouse]
  );
}

module.exports = { r2, getWarehouseQty, addWarehouseQty, subtractWarehouseQty };
