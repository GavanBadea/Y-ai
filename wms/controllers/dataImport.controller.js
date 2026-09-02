// استيراد دفعات من Excel — الأقسام: مناطق، أصناف، أنواع، زبائن، موردون، مواد
const db = require("../db");
const { str, num, normalizeRow, pick, importResult } = require("../utils/dataImportHelpers");

function generateBarcode() {
  const ts     = Date.now().toString().slice(-9);
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, "0");
  return `MAT${ts}${random}`;
}

function validateRows(req, res) {
  const rows = req.body?.rows;
  if (!Array.isArray(rows) || !rows.length) {
    res.status(400).json({ success: false, message: "لا توجد صفوف للاستيراد — تأكد من ملف Excel" });
    return null;
  }
  return rows.map(normalizeRow);
}

// ── أصناف ─────────────────────────────────────────────────
const importCategories = async (req, res) => {
  const rows = validateRows(req, res);
  if (!rows) return;

  let added = 0, skipped = 0;
  const errors = [];

  for (let i = 0; i < rows.length; i++) {
    const name = pick(rows[i], "اسم_الصنف", "CatiguaryName", "الصنف", "name");
    if (!name) { errors.push({ row: i + 2, message: "اسم الصنف فارغ" }); continue; }

    const exists = await db.queryOne(
      `SELECT id_Catiguary FROM Catiguary_tbl WHERE CatiguaryName = ?`, [name]
    );
    if (exists) { skipped++; continue; }

    try {
      await db.run(`INSERT INTO Catiguary_tbl (CatiguaryName) VALUES (?)`, [name]);
      added++;
    } catch (e) {
      errors.push({ row: i + 2, message: e.message });
    }
  }

  res.json(importResult(added, skipped, errors));
};

// ── أنواع ─────────────────────────────────────────────────
const importTypes = async (req, res) => {
  const rows = validateRows(req, res);
  if (!rows) return;

  let added = 0, skipped = 0;
  const errors = [];

  for (let i = 0; i < rows.length; i++) {
    const name = pick(rows[i], "اسم_النوع", "TypeName", "النوع", "name");
    if (!name) { errors.push({ row: i + 2, message: "اسم النوع فارغ" }); continue; }

    const exists = await db.queryOne(`SELECT id_Type FROM Type_tbl WHERE TypeName = ?`, [name]);
    if (exists) { skipped++; continue; }

    try {
      await db.run(`INSERT INTO Type_tbl (TypeName) VALUES (?)`, [name]);
      added++;
    } catch (e) {
      errors.push({ row: i + 2, message: e.message });
    }
  }

  res.json(importResult(added, skipped, errors));
};

// ── مناطق الزبائن ─────────────────────────────────────────
const importLocations = async (req, res) => {
  const rows = validateRows(req, res);
  if (!rows) return;

  let added = 0, skipped = 0;
  const errors = [];

  for (let i = 0; i < rows.length; i++) {
    const name = pick(rows[i], "اسم_المنطقة", "Location_ZabonLocation", "المنطقة", "name");
    if (!name) { errors.push({ row: i + 2, message: "اسم المنطقة فارغ" }); continue; }

    const exists = await db.queryOne(
      `SELECT id_ZabonLocation FROM Zabon_Location WHERE Location_ZabonLocation = ?`, [name]
    );
    if (exists) { skipped++; continue; }

    try {
      await db.run(`INSERT INTO Zabon_Location (Location_ZabonLocation) VALUES (?)`, [name]);
      added++;
    } catch (e) {
      errors.push({ row: i + 2, message: e.message });
    }
  }

  res.json(importResult(added, skipped, errors));
};

// ── زبائن ─────────────────────────────────────────────────
const importCustomers = async (req, res) => {
  const rows = validateRows(req, res);
  if (!rows) return;

  let added = 0, skipped = 0;
  const errors = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const ZabonName = pick(row, "اسم_الزبون", "ZabonName", "الاسم");
    const Mobail    = pick(row, "الموبايل", "Mobail", "الهاتف");
    const Adress    = pick(row, "العنوان", "Adress");
    const locName   = pick(row, "المنطقة", "Location_ZabonLocation");
    const CreditLimit = num(pick(row, "حد_الائتمان", "Credit Limit", "CreditLimit"));

    if (!ZabonName || !Mobail || !Adress) {
      errors.push({ row: i + 2, message: "الحقول الإلزامية: اسم_الزبون، الموبايل، العنوان" });
      continue;
    }

    let id_ZabonLocation = 0;
    if (locName) {
      const loc = await db.queryOne(
        `SELECT id_ZabonLocation FROM Zabon_Location WHERE Location_ZabonLocation = ?`, [locName]
      );
      if (!loc) {
        errors.push({ row: i + 2, message: `المنطقة غير موجودة: ${locName}` });
        continue;
      }
      id_ZabonLocation = loc.id_ZabonLocation;
    }

    try {
      await db.run(
        `INSERT INTO Zabon_tbl (ZabonName, Mobail, Adress, id_ZabonLocation, "Credit Limit")
         VALUES (?, ?, ?, ?, ?)`,
        [ZabonName, Mobail, Adress, id_ZabonLocation, CreditLimit]
      );
      added++;
    } catch (e) {
      errors.push({ row: i + 2, message: e.message });
    }
  }

  res.json(importResult(added, skipped, errors));
};

// ── موردون ────────────────────────────────────────────────
const importSuppliers = async (req, res) => {
  const rows = validateRows(req, res);
  if (!rows) return;

  let added = 0, skipped = 0;
  const errors = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const AmilName = pick(row, "اسم_المورد", "AmilName", "الاسم");
    const Mobil    = pick(row, "الموبايل", "Mobil", "الهاتف");
    const Adress   = pick(row, "العنوان", "Adress");

    if (!Mobil || !Adress) {
      errors.push({ row: i + 2, message: "الحقول الإلزامية: الموبايل، العنوان" });
      continue;
    }

    try {
      await db.run(
        `INSERT INTO Amil_tbl (AmilName, Mobil, Adress) VALUES (?, ?, ?)`,
        [AmilName || null, Mobil, Adress]
      );
      added++;
    } catch (e) {
      errors.push({ row: i + 2, message: e.message });
    }
  }

  res.json(importResult(added, skipped, errors));
};

// ── مواد ──────────────────────────────────────────────────
const importMaterials = async (req, res) => {
  const rows = validateRows(req, res);
  if (!rows) return;

  let added = 0, skipped = 0;
  const errors = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const MaterialName = pick(row, "اسم_المادة", "MaterialName", "المادة");
    const Band         = pick(row, "الوحدة", "Band") || "كارتون";
    let Barcode        = pick(row, "الباركود", "Barcode");
    const catName      = pick(row, "الصنف", "CatiguaryName");
    const typeName     = pick(row, "النوع", "TypeName");
    const CostPrice    = num(pick(row, "سعر_الشراء", "CostPrice", "Cost Price"));
    const SellPrice1   = num(pick(row, "سعر_بيع1", "SellPrice1"));
    const SellPrice2   = num(pick(row, "سعر_بيع2", "SellPrice2"));
    const SellPrice3   = num(pick(row, "سعر_بيع3", "SellPrice3"));
    const SellPrice4   = num(pick(row, "سعر_بيع4", "SellPrice4"));
    const SellPrice5   = num(pick(row, "سعر_بيع5", "SellPrice5"));
    const openingQty   = num(pick(row, "كمية_افتتاحية", "QuantityOnHand", "openingQty"));

    if (!MaterialName) {
      errors.push({ row: i + 2, message: "اسم المادة مطلوب" });
      continue;
    }

    if (!Barcode) Barcode = generateBarcode();

    const dup = await db.queryOne(
      `SELECT id_Material_NoM FROM Materials_tbl WHERE Barcode = ?`, [Barcode]
    );
    if (dup) {
      errors.push({ row: i + 2, message: `الباركود مستخدم: ${Barcode}` });
      continue;
    }

    let id_Catiguary = 0;
    if (catName) {
      const cat = await db.queryOne(
        `SELECT id_Catiguary FROM Catiguary_tbl WHERE CatiguaryName = ?`, [catName]
      );
      if (!cat) {
        errors.push({ row: i + 2, message: `الصنف غير موجود: ${catName}` });
        continue;
      }
      id_Catiguary = cat.id_Catiguary;
    }

    let id_Type = 0;
    if (typeName) {
      const typ = await db.queryOne(`SELECT id_Type FROM Type_tbl WHERE TypeName = ?`, [typeName]);
      if (!typ) {
        errors.push({ row: i + 2, message: `النوع غير موجود: ${typeName}` });
        continue;
      }
      id_Type = typ.id_Type;
    }

    try {
      const mat = await db.run(
        `INSERT INTO Materials_tbl
           (MaterialName, Barcode, Band, id_Catiguary, id_Type, "Cost Price")
         VALUES (?, ?, ?, ?, ?, ?)`,
        [MaterialName, Barcode, Band, id_Catiguary, id_Type, CostPrice]
      );
      const id = mat.lastID;

      await db.run(`INSERT INTO Stock_tbl (id_Material_NoM) VALUES (?)`, [id]);

      if (openingQty > 0) {
        await db.run(
          `UPDATE Stock_tbl
           SET QuantityOnHand = ?, QuantityIN = ?, LastUpdateDate = datetime('now')
           WHERE id_Material_NoM = ?`,
          [openingQty, openingQty, id]
        );
      }

      const lastSell = SellPrice1 || SellPrice2 || SellPrice3 || SellPrice4 || SellPrice5 || 0;
      await db.run(
        `INSERT INTO SellPrice_tbl
           (id_Material_NoM, SellPrice1, SellPrice2, SellPrice3, SellPrice4, SellPrice5, LastSellPrice)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, SellPrice1, SellPrice2, SellPrice3, SellPrice4, SellPrice5, lastSell]
      );

      added++;
    } catch (e) {
      if (e.message?.includes("UNIQUE") && e.message?.includes("Barcode")) {
        errors.push({ row: i + 2, message: `الباركود مكرر: ${Barcode}` });
      } else {
        errors.push({ row: i + 2, message: e.message });
      }
    }
  }

  res.json(importResult(added, skipped, errors));
};

module.exports = {
  importCategories,
  importTypes,
  importLocations,
  importCustomers,
  importSuppliers,
  importMaterials,
};
