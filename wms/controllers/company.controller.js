// controllers/company.controller.js  —  جدول معلومات الشركة CompanyInformation_tbl
const fs   = require("fs");
const path = require("path");
const db   = require("../db");

// يستخدم UPLOADS_PATH من البيئة (يُضبط في launcher.bat) — نفس مسار server.js
const UPLOADS_DIR = process.env.UPLOADS_PATH
  ? path.resolve(process.env.UPLOADS_PATH)
  : path.join(__dirname, "../uploads");

function ensureUploadsDir() {
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function removeLogoFile(logoPath) {
  if (!logoPath) return;
  const file = path.join(UPLOADS_DIR, path.basename(logoPath));
  if (fs.existsSync(file)) {
    try { fs.unlinkSync(file); } catch { /* ignore */ }
  }
}

function pickField(body, key, existing) {
  if (!Object.prototype.hasOwnProperty.call(body, key)) return existing ?? "";
  const val = body[key];
  return val == null ? (existing ?? "") : String(val);
}

const get = async (_req, res) => {
  try {
    const row = await db.queryOne(`SELECT * FROM CompanyInformation_tbl LIMIT 1`);
    res.json({ success: true, data: row || {} });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// INSERT إذا لم توجد، UPDATE إذا وُجدت — لا يُمسح الشعار ولا تُمحى الحقول غير المرسلة
const upsert = async (req, res) => {
  const body = req.body || {};
  const symIn = body.CurrencySymbol === "$" ? "$" : "د.ع";
  try {
    const existing = await db.queryOne(`SELECT * FROM CompanyInformation_tbl LIMIT 1`);
    if (existing) {
      const name    = pickField(body, "CompanyInformation_Name", existing.CompanyInformation_Name);
      const mobile  = pickField(body, "CompanyInformation_Mobile", existing.CompanyInformation_Mobile);
      const info1   = pickField(body, "CompanyInformation_Info1", existing.CompanyInformation_Info1);
      const info2   = pickField(body, "CompanyInformation_Info2", existing.CompanyInformation_Info2);
      const address = pickField(body, "CompanyInformation_Adress", existing.CompanyInformation_Adress);
      const taxNo   = pickField(body, "CompanyInformation_TaxNo", existing.CompanyInformation_TaxNo);
      const sym     = Object.prototype.hasOwnProperty.call(body, "CurrencySymbol")
        ? symIn
        : (existing.CurrencySymbol === "$" ? "$" : "د.ع");

      await db.run(
        `UPDATE CompanyInformation_tbl
         SET CompanyInformation_Name=?, CompanyInformation_Mobile=?,
             CompanyInformation_Info1=?, CompanyInformation_Info2=?, CompanyInformation_Adress=?,
             CompanyInformation_TaxNo=?, CurrencySymbol=?
         WHERE id_CompanyInformation=?`,
        [name, mobile, info1, info2, address, taxNo || "", sym, existing.id_CompanyInformation]
      );
    } else {
      await db.run(
        `INSERT INTO CompanyInformation_tbl
           (CompanyInformation_Name,CompanyInformation_Mobile,
            CompanyInformation_Info1,CompanyInformation_Info2,CompanyInformation_Adress,
            CompanyInformation_TaxNo,CurrencySymbol)
         VALUES (?,?,?,?,?,?,?)`,
        [
          pickField(body, "CompanyInformation_Name", ""),
          pickField(body, "CompanyInformation_Mobile", ""),
          pickField(body, "CompanyInformation_Info1", ""),
          pickField(body, "CompanyInformation_Info2", ""),
          pickField(body, "CompanyInformation_Adress", ""),
          pickField(body, "CompanyInformation_TaxNo", "") || "",
          symIn,
        ]
      );
    }
    const row = await db.queryOne(`SELECT * FROM CompanyInformation_tbl LIMIT 1`);
    res.json({ success: true, message: "تم حفظ معلومات الشركة", data: row || {} });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// POST /api/company/logo  —  Body: { image: "data:image/png;base64,..." }
const uploadLogo = async (req, res) => {
  const { image } = req.body;
  if (!image)
    return res.status(400).json({ success: false, message: "صورة الشعار مطلوبة" });

  const match = String(image).match(/^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,(.+)$/i);
  if (!match)
    return res.status(400).json({ success: false, message: "صيغة الصورة غير مدعومة" });

  const extMap = { "image/png": ".png", "image/jpeg": ".jpg", "image/jpg": ".jpg", "image/webp": ".webp", "image/gif": ".gif" };
  const ext    = extMap[match[1].toLowerCase()] || ".png";
  const data   = match[2];

  try {
    ensureUploadsDir();
    const existing = await db.queryOne(
      `SELECT id_CompanyInformation, CompanyInformation_Logo FROM CompanyInformation_tbl LIMIT 1`
    );
    removeLogoFile(existing?.CompanyInformation_Logo);

    const fileName = `company-logo${ext}`;
    fs.writeFileSync(path.join(UPLOADS_DIR, fileName), Buffer.from(data, "base64"));
    const logoUrl = `/uploads/${fileName}`;

    if (existing) {
      await db.run(
        `UPDATE CompanyInformation_tbl SET CompanyInformation_Logo = ? WHERE id_CompanyInformation = ?`,
        [logoUrl, existing.id_CompanyInformation]
      );
    } else {
      await db.run(
        `INSERT INTO CompanyInformation_tbl (CompanyInformation_Name, CompanyInformation_Logo)
         VALUES (?, ?)`,
        ["", logoUrl]
      );
    }

    const row = await db.queryOne(`SELECT * FROM CompanyInformation_tbl LIMIT 1`);
    res.json({ success: true, message: "تم رفع الشعار", logo: logoUrl, data: row || {} });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// DELETE /api/company/logo
const deleteLogo = async (req, res) => {
  try {
    const existing = await db.queryOne(
      `SELECT id_CompanyInformation, CompanyInformation_Logo FROM CompanyInformation_tbl LIMIT 1`
    );
    if (!existing?.CompanyInformation_Logo)
      return res.json({ success: true, message: "لا يوجد شعار" });

    removeLogoFile(existing.CompanyInformation_Logo);
    await db.run(
      `UPDATE CompanyInformation_tbl SET CompanyInformation_Logo = NULL WHERE id_CompanyInformation = ?`,
      [existing.id_CompanyInformation]
    );
    res.json({ success: true, message: "تم حذف الشعار" });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

module.exports = { get, upsert, uploadLogo, deleteLogo };
