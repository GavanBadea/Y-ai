// ============================================================
//  controllers/fiscalYear.controller.js
//
//  وظائف إغلاق السنة المالية وتصفير النظام
//  ✅ لا يمس أي ملف آخر موجود
//  ✅ جميع العمليات داخل Transaction لضمان الأمان
// ============================================================
const db   = require("../db");
const path = require("path");
const fs   = require("fs");
const bcrypt = require("bcryptjs");

const ACTIVE_BACKUP_META = "active_backup.json";

const r2 = (n) => Math.round((n || 0) * 100) / 100;

// نفس منطق لوحة القيادة — استثناء قيود «تسوية/سماح» السندات لتجنّب الخصم المزدوج
const SQL_CUSTOMER_NET = `
  COALESCE((
    SELECT SUM(Amount_DionZabon) FROM DionZabon_tbl
    WHERE id_Zabon = z.id_Zabon
      AND Note_DionZabon NOT LIKE 'تسوية سند قبض رقم%'
      AND Note_DionZabon NOT LIKE 'سماح سند قبض رقم%'
  ), 0)
  - COALESCE((SELECT SUM(Amount_CatchDoc) FROM CatchDoc_tbl WHERE id_Zabon = z.id_Zabon), 0)
  - COALESCE((SELECT SUM(AllowanceAmount) FROM CatchDoc_tbl WHERE id_Zabon = z.id_Zabon), 0)`;

const SQL_SUPPLIER_NET = `
  COALESCE((
    SELECT SUM(Amount_DionAmil) FROM DionAmil_tbl
    WHERE id_Amil = a.id_Amil
      AND Note_DionAmil NOT LIKE 'تسوية سند دفع رقم%'
  ), 0)
  - COALESCE((SELECT SUM(Amount_PayDoc) FROM PayDoc_tbl WHERE id_Amil = a.id_Amil), 0)`;

async function verifyAdminPassword(plainPassword) {
  if (!plainPassword) return false;
  const admin = await db.queryOne(
    `SELECT Password FROM Users_tbl WHERE id_Roles = 1 ORDER BY id_User LIMIT 1`
  );
  if (!admin?.Password) return false;
  return bcrypt.compare(String(plainPassword), admin.Password);
}

// ── مسار قاعدة البيانات ───────────────────────────────────
const DB_PATH = process.env.DB_PATH || "./warehouse.db";

const APP_DIR      = path.join(__dirname, "..");
const INSTALL_ROOT = path.dirname(APP_DIR);

/** مسارات نسبية في .env تُحسب من مجلد app وليس من cwd */
function primaryBackupDir() {
  const raw = String(process.env.BACKUP_PATH || "").trim();
  if (!raw) return path.join(INSTALL_ROOT, "backups");
  if (path.isAbsolute(raw)) return path.normalize(raw);
  return path.normalize(path.resolve(APP_DIR, raw));
}

/** مواقع قديمة/خاطئة — كانت تظهر في القائمة ولا تُرى في Y-ai-WMS\backups */
function legacyBackupDirs() {
  const primary = primaryBackupDir();
  const candidates = [
    path.resolve("./BackUp"),
    path.join(APP_DIR, "backups"),
    path.join(path.dirname(INSTALL_ROOT), "backups"),
    path.resolve(process.cwd(), "backups"),
    path.resolve(process.cwd(), "../backups"),
  ];
  return [...new Set(candidates.map((d) => path.normalize(d)))]
    .filter((d) => d !== path.normalize(primary));
}

function getBackupDirs() {
  ensureBackupDir();
  const primary = primaryBackupDir();
  const dirs = [primary];
  for (const leg of legacyBackupDirs()) {
    if (fs.existsSync(leg) && !dirs.includes(leg)) dirs.push(leg);
  }
  return dirs;
}

/** مجلد النسخ الاحتياطية — ينقل النسخ من المواقع القديمة تلقائياً */
function ensureBackupDir() {
  const primary = primaryBackupDir();
  if (!fs.existsSync(primary)) fs.mkdirSync(primary, { recursive: true });

  for (const legacy of legacyBackupDirs()) {
    if (!fs.existsSync(legacy)) continue;
    try {
      fs.readdirSync(legacy)
        .filter((f) => /\.db$/i.test(f))
        .forEach((f) => {
          const src  = path.join(legacy, f);
          const dest = path.join(primary, f);
          if (!fs.existsSync(dest)) fs.copyFileSync(src, dest);
        });
      if (/[/\\]backup$/i.test(legacy) && !/[/\\]backups$/i.test(legacy)) {
        fs.rmSync(legacy, { recursive: true, force: true });
      }
    } catch { /* تجاهل */ }
  }
}

function listAllBackupFiles() {
  const seen = new Set();
  const files = [];
  getBackupDirs().forEach((dir) => {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir)
      .filter((f) => /\.db$/i.test(f))
      .forEach((f) => {
        if (seen.has(f)) return;
        seen.add(f);
        const full = path.join(dir, f);
        const stat = fs.statSync(full);
        files.push({
          name  : f,
          path  : full,
          size  : stat.size,
          date  : stat.mtime,
          folder: path.basename(dir),
        });
      });
  });
  return files.sort((a, b) => b.date - a.date);
}

function resolveBackupPath(filename) {
  if (!filename || filename.includes("..") || /[\\/]/.test(filename)) return null;
  for (const dir of getBackupDirs()) {
    const full = path.join(dir, filename);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

function readActiveBackupMeta() {
  try {
    const metaPath = path.join(primaryBackupDir(), ACTIVE_BACKUP_META);
    if (!fs.existsSync(metaPath)) return null;
    return JSON.parse(fs.readFileSync(metaPath, "utf8"));
  } catch {
    return null;
  }
}

function writeActiveBackupMeta(filename) {
  writeFiscalMeta({ filename, switchedAt: new Date().toISOString() });
}

function writeFiscalMeta(patch) {
  const metaPath = path.join(primaryBackupDir(), ACTIVE_BACKUP_META);
  const prev = readActiveBackupMeta() || {};
  fs.writeFileSync(
    metaPath,
    JSON.stringify({ ...prev, ...patch, updatedAt: new Date().toISOString() }, null, 2),
    "utf8"
  );
}

/** استخراج سنة من اسم ملف النسخة (مثل مستودع_2025.db → 2025) */
function parseYearFromFilename(filename) {
  if (!filename) return null;
  const base = String(filename).replace(/\.db$/i, "");
  const anchored = base.match(/(?:^|[_\-\s])((?:19|20)\d{2})(?:[_\-\s.]|$)/);
  if (anchored) return Number(anchored[1]);
  const any = base.match(/(19|20)\d{2}/);
  return any ? Number(any[0]) : null;
}

/** تسمية الشارة من القاعدة النشطة فعلياً (filename) وليس من newYear القديمة */
function fiscalLabelFromMeta(meta) {
  if (!meta) return { label: null, displayYear: null };
  const activeFile = meta.filename || null;
  const displayYear = parseYearFromFilename(activeFile) ?? meta.newYear ?? null;
  if (displayYear) return { label: `السنة ${displayYear}`, displayYear };
  if (activeFile) {
    return {
      label     : activeFile.replace(/\.db$/i, "").replace(/_/g, " "),
      displayYear: null,
    };
  }
  return { label: null, displayYear: null };
}

function sanitizeDbFilename(name) {
  let base = String(name || "").trim().replace(/\.db$/i, "").trim();
  if (!base) return null;

  base = base
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\.{2,}/g, ".")
    .replace(/\s+/g, " ")
    .trim();

  if (!base || base.includes("..")) return null;

  const filename = `${base}.db`;
  if (/[\\/]/.test(filename)) return null;
  return filename;
}

async function prepareDatabaseRestore(req) {
  const stopYai = req.app?.get?.("stopYaiForDatabaseRestore");
  if (typeof stopYai === "function") await stopYai();
}

async function finalizeDatabaseRestore(req) {
  const restartYai = req.app?.get?.("restartYaiAfterDatabaseRestore");
  if (typeof restartYai === "function") await restartYai();
}

/** نسخة باسم محدد من المستخدم */
async function createNamedBackup(filename) {
  const safe = sanitizeDbFilename(filename);
  if (!safe) throw new Error("تسمية النسخة غير صالحة — تجنّب الرموز: \\ / : * ? \" < > |");
  ensureBackupDir();
  const dest = path.join(primaryBackupDir(), safe);
  await db.checkpointDatabase();
  await db.backupDatabaseToFile(dest);
  const info = await db.inspectDatabaseFile(dest).catch(() => ({}));
  return {
    filename: safe,
    path    : dest,
    size    : fs.statSync(dest).size,
    stats   : {
      users    : info.users     || 0,
      materials: info.materials || 0,
      customers: info.customers || 0,
      suppliers: info.suppliers || 0,
      mandobs  : info.mandobs   || 0,
    },
  };
}

// جداول العمليات اليومية فقط — لا تُمسّ بيانات التعريف (زبائن، موردون، مواد، مندوبون…)
const YEAR_CLOSE_OP_TABLES = [
  "DetailsOUT_tbl",
  "FOUT_tbl",
  "DetailsIN_tbl",
  "FIN_tbl",
  "DetailsRetern_tbl",
  "FRetern_tbl",
  "CatchDoc_tbl",
  "PayDoc_tbl",
  "SpendingDetails_tbl",
  "DionZabon_tbl",
  "DionAmil_tbl",
  "AuditLog_tbl",
];

// ── نسخة احتياطية ─────────────────────────────────────────
async function createBackup(label = "manual") {
  ensureBackupDir();
  const stamp    = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
  const filename = `backup_${label}_${stamp}.db`;
  const dest     = path.join(primaryBackupDir(), filename);
  await db.checkpointDatabase();
  await db.backupDatabaseToFile(dest);
  const size = fs.statSync(dest).size;
  const info = await db.inspectDatabaseFile(dest).catch(() => ({}));
  return {
    filename,
    path : dest,
    size,
    stats: {
      users    : info.users     || 0,
      materials: info.materials || 0,
      customers: info.customers || 0,
      suppliers: info.suppliers || 0,
    },
  };
}

// ── جلب قائمة النسخ الاحتياطية ───────────────────────────
const listBackups = async (_req, res) => {
  try {
    ensureBackupDir();
    res.json({
      success  : true,
      backupDir: primaryBackupDir(),
      backups  : listAllBackupFiles(),
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── نسخة احتياطية يدوية ───────────────────────────────────
const manualBackup = async (req, res) => {
  try {
    const label = String(req.body?.label || req.body?.filename || "").trim();
    const info = label
      ? await createNamedBackup(label)
      : await createBackup("manual");
    res.json({
      success: true,
      message: `تم إنشاء النسخة الاحتياطية: ${info.filename}`,
      backup : info,
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── نسخة احتياطية باسم يدوي (تبويب النسخ الاحتياطية) ─────
const createManualBackup = async (req, res) => {
  try {
    const label = String(req.body?.label ?? req.body?.name ?? "").trim();
    if (!label) {
      return res.status(400).json({ success: false, message: "يرجى إدخال تسمية للنسخة الاحتياطية" });
    }
    const info = await createNamedBackup(label);
    res.json({
      success: true,
      message: `تم حفظ النسخة الاحتياطية باسم: ${info.filename}`,
      backup : info,
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── معاينة إغلاق السنة (بدون تنفيذ) ─────────────────────
const previewYearClose = async (_req, res) => {
  try {
    const [
      customers, suppliers, stock,
      materials, mandobs,
      invoicesOut, invoicesIn, returns,
      catchDocs, payDocs, spending,
    ] = await Promise.all([
      // أرصدة الزبائن
      db.query(`
        SELECT z.id_Zabon, z.ZabonName, (${SQL_CUSTOMER_NET}) AS NetBalance
        FROM Zabon_tbl z ORDER BY z.ZabonName
      `),
      // أرصدة الموردين
      db.query(`
        SELECT a.id_Amil, a.AmilName, (${SQL_SUPPLIER_NET}) AS NetBalance
        FROM Amil_tbl a ORDER BY a.AmilName
      `),
      // كميات المخزون
      db.query(`
        SELECT m.MaterialName, m.Band,
               COALESCE(s.QuantityOnHand,0) AS qty
        FROM Materials_tbl m
        LEFT JOIN Stock_tbl s ON s.id_Material_NoM=m.id_Material_NoM
        WHERE COALESCE(s.QuantityOnHand,0) > 0
        ORDER BY m.MaterialName
      `),
      db.queryOne(`SELECT COUNT(*) AS n FROM Materials_tbl`),
      db.queryOne(`SELECT COUNT(*) AS n FROM Mandob_tbl`),
      db.queryOne(`SELECT COUNT(*) AS n FROM FOUT_tbl`),
      db.queryOne(`SELECT COUNT(*) AS n FROM FIN_tbl`),
      db.queryOne(`SELECT COUNT(*) AS n FROM FRetern_tbl`),
      db.queryOne(`SELECT COUNT(*) AS n FROM CatchDoc_tbl`),
      db.queryOne(`SELECT COUNT(*) AS n FROM PayDoc_tbl`),
      db.queryOne(`SELECT COUNT(*) AS n FROM SpendingDetails_tbl`),
    ]);

    res.json({
      success: true,
      preview: {
        customers: { count: customers.length, withBalance: customers.filter(c=>c.NetBalance!==0).length, data: customers },
        suppliers: { count: suppliers.length, withBalance: suppliers.filter(s=>s.NetBalance!==0).length, data: suppliers },
        stock    : { count: stock.length, data: stock },
        willKeep: {
          materials : materials?.n  || 0,
          customers : customers.length,
          suppliers : suppliers.length,
          mandobs   : mandobs?.n    || 0,
          stockItems: stock.length,
        },
        willDelete: {
          invoicesOut : invoicesOut?.n || 0,
          invoicesIn  : invoicesIn?.n  || 0,
          returns     : returns?.n     || 0,
          catchDocs   : catchDocs?.n   || 0,
          payDocs     : payDocs?.n     || 0,
          spending    : spending?.n    || 0,
        },
      },
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ══════════════════════════════════════════════════════════
//  إغلاق السنة المالية (العملية الحقيقية)
//
//  الخطوات:
//  1. نسخة احتياطية تلقائية
//  2. حفظ أرصدة الزبائن والموردين
//  3. نقل كميات المخزون
//  4. حذف جداول العمليات اليومية فقط
//  5. تسجيل الأرصدة الافتتاحية
//  6. التحقق النهائي
// ══════════════════════════════════════════════════════════
const closeYear = async (req, res) => {
  const { password, newYear, confirm, archiveDbName, workingDbName } = req.body;

  // ── التحقق من المدخلات ────────────────────────────────
  if (!password || !newYear || !confirm)
    return res.status(400).json({ success:false, message:"يرجى إدخال كلمة المرور والسنة الجديدة" });

  if (!archiveDbName?.trim() || !workingDbName?.trim())
    return res.status(400).json({ success:false, message:"يرجى إدخال اسم قاعدة السنة المغلقة واسم قاعدة السنة الجديدة" });

  const archiveFile = sanitizeDbFilename(archiveDbName);
  const workingFile = sanitizeDbFilename(workingDbName);
  if (!archiveFile || !workingFile)
    return res.status(400).json({ success:false, message:"اسم ملف قاعدة البيانات غير صالح" });
  if (archiveFile === workingFile)
    return res.status(400).json({ success:false, message:"اسم قاعدة الأرشيف وقاعدة العمل يجب أن يكونا مختلفين" });

  if (confirm !== "أوافق على إغلاق السنة المالية")
    return res.status(400).json({ success:false, message:"نص التأكيد غير صحيح" });

  // ── التحقق من كلمة مرور المدير ─────────────────────────
  if (!(await verifyAdminPassword(password))) {
    return res.status(403).json({ success:false, message:"كلمة مرور المدير غير صحيحة" });
  }

  try {
    // ── الخطوة 1: أرشيف السنة المغلقة (كامل — قبل أي حذف) ─
    const archiveBackup = await createNamedBackup(archiveFile);

    // ── الخطوة 2: قراءة الأرصدة النهائية ────────────────
    const [customers, suppliers, stockItems, keptCounts] = await Promise.all([
      db.query(`
        SELECT z.id_Zabon, (${SQL_CUSTOMER_NET}) AS NetBalance
        FROM Zabon_tbl z
      `),
      db.query(`
        SELECT a.id_Amil, (${SQL_SUPPLIER_NET}) AS NetBalance
        FROM Amil_tbl a
      `),
      db.query(`SELECT id_Material_NoM, QuantityOnHand FROM Stock_tbl`),
      Promise.all([
        db.queryOne(`SELECT COUNT(*) AS n FROM Materials_tbl`),
        db.queryOne(`SELECT COUNT(*) AS n FROM Zabon_tbl`),
        db.queryOne(`SELECT COUNT(*) AS n FROM Amil_tbl`),
        db.queryOne(`SELECT COUNT(*) AS n FROM Mandob_tbl`),
        db.queryOne(`SELECT COUNT(*) AS n FROM SellPrice_tbl`),
      ]),
    ]);

    // ── الخطوة 3: التحقق من صحة القراءة ─────────────────
    if (customers === null || suppliers === null || stockItems === null) {
      throw new Error("فشل قراءة البيانات قبل الحذف — تم إلغاء العملية");
    }

    const openDate = `${newYear}-01-01`;

    // ── الخطوة 4: بدء Transaction ──────────────────────
    await db.run("BEGIN TRANSACTION");

    try {
      // ── حذف جداول العمليات اليومية فقط ───────────────
      // يُحتفظ بـ: Materials_tbl, Zabon_tbl, Amil_tbl, Mandob_tbl,
      // Stock_tbl, SellPrice_tbl, Catiguary_tbl, Type_tbl, PayType_tbl…
      for (const t of YEAR_CLOSE_OP_TABLES) {
        await db.run(`DELETE FROM ${t}`).catch(() => {});
      }

      // ── الخطوة 5: تسجيل الأرصدة الافتتاحية للزبائن ──
      for (const c of customers) {
        if (c.NetBalance !== 0) {
          await db.run(
            `INSERT INTO DionZabon_tbl (Date_DionZabon, Amount_DionZabon, id_Zabon, Note_DionZabon)
             VALUES (?, ?, ?, ?)`,
            [openDate, r2(c.NetBalance), c.id_Zabon, `رصيد مرحّل من سنة ${newYear-1}`]
          );
        }
      }

      // ── تسجيل الأرصدة الافتتاحية للموردين ───────────
      for (const s of suppliers) {
        if (s.NetBalance !== 0) {
          await db.run(
            `INSERT INTO DionAmil_tbl (Date_DionAmil, Amount_DionAmil, id_Amil, Note_DionAmil)
             VALUES (?, ?, ?, ?)`,
            [openDate, r2(s.NetBalance), s.id_Amil, `رصيد مرحّل من سنة ${newYear-1}`]
          );
        }
      }

      // ── الخطوة 6: المخزون يبقى كما هو (لا يُمسح) ────
      // Stock_tbl تحتوي على QuantityOnHand الحالية
      // هي تلقائياً رصيد أول المدة للسنة الجديدة
      // لا نحتاج لتغيير شيء

      // ── تسجيل إغلاق السنة في سجل التدقيق ────────────
      await db.run(
        `INSERT INTO AuditLog_tbl (Action, TableName, RecordId, UserId, Timestamp, Details)
         VALUES (?, ?, ?, ?, ?, ?)`.replace("AuditLog_tbl",
         // تجرب الجدول المحتمل
         "AuditLog_tbl"),
        ["YEAR_CLOSE", "SYSTEM", 0, req.user?.id || 1, new Date().toISOString(),
         `إغلاق سنة ${newYear-1} — أرشيف: ${archiveFile} — عمل: ${workingFile}`]
      ).catch(() => {});

      await db.run("COMMIT");
      await db.checkpointDatabase();

      // ── الخطوة 7: حفظ قاعدة السنة الجديدة للعمل والتبديل ─
      const workingBackup = await createNamedBackup(workingFile);

      writeFiscalMeta({
        filename       : workingFile,
        activeWorkingDb: workingFile,
        archiveDb      : archiveFile,
        closedYear     : newYear - 1,
        newYear,
        switchedAt     : new Date().toISOString(),
      });

      // ── التحقق النهائي ────────────────────────────────
      const verify = await Promise.all([
        db.queryOne(`SELECT COUNT(*) AS n FROM FOUT_tbl`),
        db.queryOne(`SELECT COUNT(*) AS n FROM FIN_tbl`),
        db.queryOne(`SELECT COUNT(*) AS n FROM DionZabon_tbl`),
        db.queryOne(`SELECT COUNT(*) AS n FROM DionAmil_tbl`),
      ]);

      const custWithBal = customers.filter(c => c.NetBalance !== 0).length;
      const suppWithBal = suppliers.filter(s => s.NetBalance !== 0).length;

      res.json({
        success: true,
        message: `✅ تم إغلاق السنة المالية ${newYear - 1} — الأرشيف: ${archiveFile} — العمل: ${workingFile}`,
        summary: {
          archiveDb       : archiveFile,
          workingDb       : workingFile,
          backup          : archiveFile,
          newYear,
          customersCarried: custWithBal,
          suppliersCarried: suppWithBal,
          stockItemsKept  : stockItems.length,
          materialsKept   : keptCounts[0]?.n || 0,
          customersKept   : keptCounts[1]?.n || 0,
          suppliersKept   : keptCounts[2]?.n || 0,
          mandobsKept     : keptCounts[3]?.n || 0,
          pricesKept      : keptCounts[4]?.n || 0,
          invoicesDeleted : "(تم الحذف)",
          verification    : {
            salesInvoices    : verify[0]?.n,
            purchaseInvoices : verify[1]?.n,
            customerBalances : verify[2]?.n,
            supplierBalances : verify[3]?.n,
          },
          archiveStats: archiveBackup.stats,
          workingStats: workingBackup.stats,
        },
      });

    } catch (txErr) {
      await db.run("ROLLBACK");
      throw txErr;
    }

  } catch (e) {
    res.status(500).json({ success: false, message: `فشلت العملية: ${e.message}` });
  }
};

// جداول التصفير الكامل — البرنامج يبدأ من الصفر كأول تشغيل
const FACTORY_RESET_TABLES = [
  "DetailsOUT_tbl", "FOUT_tbl", "DetailsIN_tbl", "FIN_tbl",
  "DetailsRetern_tbl", "FRetern_tbl",
  "CatchDoc_tbl", "PayDoc_tbl",
  "CashBox_tbl",
  "SpendingDetails_tbl", "Spending_tbl",
  "DionZabon_tbl", "DionAmil_tbl",
  "AuditLog_tbl", "PriceHistory_tbl",
  "SellPrice_tbl", "Stock_tbl", "Materials_tbl",
  "Zabon_tbl", "Zabon_Location", "Amil_tbl", "Mandob_tbl",
  "Catiguary_tbl", "Type_tbl", "PayType_Tbl", "PayType_tbl",
  "Product_Warehouse_tbl", "Stock_Transfer_Lines_tbl", "Stock_Transfer_tbl",
  "ExpiredStock_tbl", "ProjectCapital_tbl", "Warehouses_tbl",
  "CompanyInformation_tbl",
  "AdminRecovery_tbl", "Users_tbl", "UserRoles_tbl",
];

const FACTORY_RESET_REQUIRED_EMPTY_TABLES = new Set([
  "CompanyInformation_tbl",
  "AdminRecovery_tbl",
  "Users_tbl",
  "UserRoles_tbl",
]);

function quoteSqliteIdentifier(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

async function tableExists(tableName) {
  const row = await db.queryOne(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
    [tableName]
  );
  return !!row;
}

// ══════════════════════════════════════════════════════════
//  التصفير الكامل (Factory Reset)
//  يمسح كل شيء بما فيها الأسماء والأصناف
// ══════════════════════════════════════════════════════════
const factoryReset = async (req, res) => {
  const { password, confirm } = req.body;

  if (confirm !== "أوافق على حذف كافة البيانات نهائياً")
    return res.status(400).json({ success:false, message:"نص التأكيد غير صحيح" });

  if (!(await verifyAdminPassword(password)))
    return res.status(403).json({ success:false, message:"كلمة مرور المدير غير صحيحة" });

  let txStarted = false;
  try {
    await db.run("PRAGMA foreign_keys = OFF").catch(() => {});
    await db.run("BEGIN TRANSACTION");
    txStarted = true;
    try {
      const cleared = new Set();
      for (const t of FACTORY_RESET_TABLES) {
        if (cleared.has(t)) continue;
        cleared.add(t);
        if (!(await tableExists(t))) continue;

        try {
          await db.run(`DELETE FROM ${quoteSqliteIdentifier(t)}`);
        } catch (err) {
          if (FACTORY_RESET_REQUIRED_EMPTY_TABLES.has(t)) {
            throw new Error(`فشل حذف جدول ${t}: ${err.message}`);
          }
        }
      }

      for (const t of cleared) {
        await db.run(`DELETE FROM sqlite_sequence WHERE name=?`, [t]).catch(() => {});
      }

      for (const t of FACTORY_RESET_REQUIRED_EMPTY_TABLES) {
        if (!(await tableExists(t))) continue;
        const row = await db.queryOne(`SELECT COUNT(*) AS n FROM ${quoteSqliteIdentifier(t)}`);
        if (Number(row?.n || 0) > 0) {
          throw new Error(`لم يتم تصفير جدول ${t} بالكامل`);
        }
      }

      await db.run("COMMIT");
      txStarted = false;
      await db.run("PRAGMA foreign_keys = ON").catch(() => {});
      await db.checkpointDatabase();

      try {
        const metaPath = path.join(primaryBackupDir(), ACTIVE_BACKUP_META);
        if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
      } catch { /* ignore */ }

      res.json({
        success : true,
        message : "✅ تم التصفير الكامل — البرنامج جاهز للبدء من الصفر",
        warning : "حُذفت جميع المواد والزبائن والموردين والمندوبين والفواتير. لاستعادة نسخة سابقة استخدم «تبديل السنة المالية» أو «استعادة» من النسخ الاحتياطية",
      });

    } catch (txErr) {
      if (txStarted) await db.run("ROLLBACK").catch(() => {});
      await db.run("PRAGMA foreign_keys = ON").catch(() => {});
      throw txErr;
    }

  } catch (e) {
    res.status(500).json({ success:false, message: `فشل التصفير: ${e.message}` });
  }
};

// ── إحصائيات الحالة الراهنة ───────────────────────────────
const getSystemStats = async (_req, res) => {
  try {
    const [
      materials, customers, suppliers,
      salesInv, purchaseInv, returns,
      catchDocs, payDocs,
      firstSale, lastSale,
      dbSize,
    ] = await Promise.all([
      db.queryOne(`SELECT COUNT(*) AS n FROM Materials_tbl`),
      db.queryOne(`SELECT COUNT(*) AS n FROM Zabon_tbl`),
      db.queryOne(`SELECT COUNT(*) AS n FROM Amil_tbl`),
      db.queryOne(`SELECT COUNT(*) AS n FROM FOUT_tbl`),
      db.queryOne(`SELECT COUNT(*) AS n FROM FIN_tbl`),
      db.queryOne(`SELECT COUNT(*) AS n FROM FRetern_tbl`),
      db.queryOne(`SELECT COUNT(*) AS n FROM CatchDoc_tbl`),
      db.queryOne(`SELECT COUNT(*) AS n FROM PayDoc_tbl`),
      db.queryOne(`SELECT MIN(Date_FOUT) AS d FROM FOUT_tbl`),
      db.queryOne(`SELECT MAX(Date_FOUT) AS d FROM FOUT_tbl`),
      Promise.resolve(null),
    ]);

    // حجم قاعدة البيانات
    let dbSizeBytes = 0;
    try { dbSizeBytes = fs.statSync(path.resolve(DB_PATH)).size; } catch {}

    // قائمة النسخ الاحتياطية
    ensureBackupDir();
    const backupCount = listAllBackupFiles().length;

    res.json({
      success: true,
      stats: {
        records: {
          materials    : materials?.n  || 0,
          customers    : customers?.n  || 0,
          suppliers    : suppliers?.n  || 0,
          salesInvoices: salesInv?.n   || 0,
          purchaseInv  : purchaseInv?.n|| 0,
          returns      : returns?.n    || 0,
          catchDocs    : catchDocs?.n  || 0,
          payDocs      : payDocs?.n    || 0,
        },
        dateRange: {
          first: firstSale?.d || null,
          last : lastSale?.d  || null,
        },
        database: {
          sizeBytes : dbSizeBytes,
          sizeMB    : (dbSizeBytes / 1024 / 1024).toFixed(2),
          backups   : backupCount,
        },
      },
    });
  } catch (e) { res.status(500).json({ success:false, message:e.message }); }
};

// ── تحميل نسخة احتياطية ───────────────────────────────────
const downloadBackup = (req, res) => {
  const { filename } = req.params;
  // أمان: منع directory traversal
  if (filename.includes("..") || filename.includes("/")) {
    return res.status(400).json({ success:false, message:"اسم ملف غير صالح" });
  }
  const filePath = resolveBackupPath(filename);
  if (!filePath)
    return res.status(404).json({ success:false, message:"الملف غير موجود" });
  res.download(filePath);
};

// ── تبديل قاعدة البيانات إلى نسخة احتياطية (للمدير) ─────
const switchToBackup = async (req, res) => {
  const { filename } = req.body || {};
  if (!filename) {
    return res.status(400).json({ success: false, message: "يرجى اختيار نسخة احتياطية" });
  }

  const sourcePath = resolveBackupPath(filename);
  if (!sourcePath) {
    return res.status(404).json({ success: false, message: "النسخة الاحتياطية غير موجودة" });
  }

  try {
    await prepareDatabaseRestore(req);
    const { inspection, restored } = await db.replaceDatabaseFromFile(sourcePath);
    writeActiveBackupMeta(filename);

    const businessRecords =
      (inspection.materials || 0) +
      (inspection.customers || 0) +
      (inspection.suppliers || 0);

    await finalizeDatabaseRestore(req);

    res.json({
      success : true,
      message : businessRecords === 0
        ? "تم التبديل — تنبيه: هذه النسخة لا تحتوي على مواد أو أطراف (قد تكون أُنشئت بعد التصفير)"
        : "تم التبديل الى السنة المالية المطلوبة",
      filename,
      active  : readActiveBackupMeta(),
      restored: {
        users    : restored.users     || 0,
        materials: restored.materials || 0,
        customers: restored.customers || 0,
      },
      backupStats: {
        users    : inspection.users     || 0,
        materials: inspection.materials || 0,
        customers: inspection.customers || 0,
        suppliers: inspection.suppliers || 0,
      },
    });
  } catch (e) {
    try { await finalizeDatabaseRestore(req); } catch { /* ignore */ }
    res.status(500).json({ success: false, message: `فشل التبديل: ${e.message}` });
  }
};

const getCurrentFiscalInfo = async (_req, res) => {
  try {
    ensureBackupDir();
    const meta = readActiveBackupMeta();
    const { label, displayYear } = fiscalLabelFromMeta(meta);

    res.json({
      success: true,
      fiscal : {
        label,
        newYear  : displayYear,
        workingDb: meta?.activeWorkingDb || null,
        activeDb : meta?.filename || null,
        archiveDb: meta?.archiveDb || null,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

const getActiveBackup = async (_req, res) => {
  try {
    ensureBackupDir();
    res.json({
      success  : true,
      backupDir: primaryBackupDir(),
      active   : readActiveBackupMeta(),
      backups  : listAllBackupFiles(),
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── إعدادات النسخ اليومي إلى Google Drive ─────────────────
const dailyBackupUtil = require("../utils/dailyBackup");

const getAutoBackupSettings = async (_req, res) => {
  try {
    ensureBackupDir();
    const settings = dailyBackupUtil.readSettings();
    res.json({
      success   : true,
      backupDir : primaryBackupDir(),
      driveRoot : dailyBackupUtil.findDriveSyncRoot(),
      driveFolder: dailyBackupUtil.driveBackupDir(),
      settings,
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

const saveAutoBackupSettings = async (req, res) => {
  try {
    const email     = String(req.body?.email || "").trim();
    const enabled   = !!req.body?.enabled;
    const drivePath = String(req.body?.drivePath || "").trim();
    if (enabled && !email) {
      return res.status(400).json({ success: false, message: "يرجى إدخال البريد الإلكتروني" });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: "صيغة البريد غير صالحة" });
    }
    if (drivePath && !fs.existsSync(drivePath)) {
      return res.status(400).json({ success: false, message: "مسار Google Drive غير موجود على هذا الجهاز" });
    }
    const settings = dailyBackupUtil.writeSettings({ email, enabled, drivePath });
    res.json({
      success: true,
      message: enabled
        ? "تم تفعيل النسخ اليومي التلقائي إلى Google Drive"
        : "تم إيقاف النسخ اليومي التلقائي",
      settings,
      driveFolder: dailyBackupUtil.driveBackupDir(),
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

const runAutoBackupNow = async (_req, res) => {
  try {
    const settings = dailyBackupUtil.readSettings();
    const info = await createBackup("auto_daily");
    const driveDir = dailyBackupUtil.driveBackupDir();
    let driveCopyPath = null;

    if (driveDir) {
      driveCopyPath = path.join(driveDir, info.filename);
      fs.copyFileSync(info.path, driveCopyPath);
    }

    const saved = dailyBackupUtil.writeSettings({
      ...settings,
      lastRun      : new Date().toISOString(),
      lastFile     : info.filename,
      lastLocalPath: info.path,
      lastDrivePath: driveCopyPath,
      driveRoot    : dailyBackupUtil.findDriveSyncRoot(),
    });

    res.json({
      success: true,
      message: driveCopyPath
        ? `تم إنشاء النسخة ونسخها إلى Google Drive: ${driveCopyPath}`
        : `تم إنشاء النسخة محلياً في: ${info.path} — لم يُعثر على Google Drive`,
      backupDir: primaryBackupDir(),
      backup   : info,
      settings : saved,
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

async function runScheduledAutoBackup() {
  return dailyBackupUtil.runDailyBackup((label) => createBackup(label));
}

// ── رفع نسخة احتياطية واستعادتها ─────────────────────────
const uploadAndRestoreBackup = async (req, res) => {
  let raw = String(req.body?.fileBase64 || "").trim();
  if (!raw) {
    return res.status(400).json({ success: false, message: "يرجى اختيار ملف النسخة الاحتياطية (.db)" });
  }
  if (raw.includes(",")) raw = raw.split(",").pop();

  let buf;
  try {
    buf = Buffer.from(raw, "base64");
  } catch {
    return res.status(400).json({ success: false, message: "تعذّر قراءة الملف" });
  }
  if (!buf.length || buf.length < 512) {
    return res.status(400).json({ success: false, message: "ملف النسخة غير صالح أو صغير جداً" });
  }

  const uploadName = String(req.body?.filename || "").trim();
  const safeName   = sanitizeDbFilename(uploadName.replace(/\.db$/i, "") || `استعادة_${Date.now()}`);

  try {
    ensureBackupDir();
    const dest = path.join(primaryBackupDir(), safeName);
    fs.writeFileSync(dest, buf);

    await prepareDatabaseRestore(req);
    const { inspection, restored } = await db.replaceDatabaseFromFile(dest);
    writeActiveBackupMeta(safeName);

    const businessRecords =
      (inspection.materials || 0) +
      (inspection.customers || 0) +
      (inspection.suppliers || 0);

    await finalizeDatabaseRestore(req);

    res.json({
      success  : true,
      message  : businessRecords === 0
        ? "تم استعادة النسخة — تنبيه: قد لا تحتوي على بيانات تشغيل كاملة"
        : "تم استعادة النسخة الاحتياطية بنجاح — أعد تحميل الصفحة",
      filename : safeName,
      path     : dest,
      backupDir: primaryBackupDir(),
      restored,
      backupStats: inspection,
    });
  } catch (e) {
    try { await finalizeDatabaseRestore(req); } catch { /* ignore */ }
    res.status(500).json({ success: false, message: `فشل الاستعادة: ${e.message}` });
  }
};

module.exports = {
  listBackups,
  manualBackup,
  createManualBackup,
  previewYearClose,
  closeYear,
  factoryReset,
  getSystemStats,
  downloadBackup,
  switchToBackup,
  getActiveBackup,
  getCurrentFiscalInfo,
  getAutoBackupSettings,
  saveAutoBackupSettings,
  runAutoBackupNow,
  runScheduledAutoBackup,
  uploadAndRestoreBackup,
  createBackup,
};