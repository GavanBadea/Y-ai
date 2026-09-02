// ============================================================
//  db.js  —  الاتصال بقاعدة البيانات SQLite
//  يُوفّر: query / queryOne / run / runTransaction
//  ✅ لا يحتوي على أي CREATE TABLE — الجداول موجودة مسبقاً
// ============================================================
const sqlite3 = require("sqlite3").verbose();
const path    = require("path");
const fs      = require("fs");
require("dotenv").config({ path: path.join(__dirname, ".env") });

/** مسار القاعدة النشطة — نسبي من مجلد app وليس من cwd (مهم لنسخة العميل) */
function resolveActiveDbPath() {
  const raw = String(process.env.DB_PATH || path.join(__dirname, "warehouse.db")).trim();
  if (path.isAbsolute(raw)) return path.normalize(raw);
  return path.resolve(__dirname, raw);
}

const ACTIVE_DB_PATH = resolveActiveDbPath();
let db;

function getDB() {
  if (db) return db;

  db = new sqlite3.Database(ACTIVE_DB_PATH, (err) => {
    if (err) {
      console.error("❌ فشل الاتصال بقاعدة البيانات:", err.message);
      process.exit(1);
    }
    console.log(`✅ متصل بـ SQLite  →  ${ACTIVE_DB_PATH}`);
  });

  // WAL — قراءة متزامنة أثناء الكتابة وتقليل SQLITE_BUSY
  db.serialize(() => {
    db.run("PRAGMA foreign_keys = ON");
    db.run("PRAGMA journal_mode = WAL");
    db.run("PRAGMA busy_timeout = 15000");
    db.get("PRAGMA journal_mode", (_e, row) => {
      const mode = row?.journal_mode || row || "unknown";
      if (String(mode).toLowerCase() === "wal") {
        console.log("✅ SQLite WAL مفعّل — journal_mode=wal");
      } else {
        console.warn(`⚠️ SQLite journal_mode=${mode} (المتوقع: wal)`);
      }
    });
  });

  // ── ترقيات أعمدة (آمنة — تُتجاهل إذا وُجدت) ─────────────
  db.all("PRAGMA table_info(UserRoles_tbl)", [], (_e, cols) => {
    if (cols && !cols.some((c) => c.name === "can_kiosk_scan"))
      db.run("ALTER TABLE UserRoles_tbl ADD COLUMN can_kiosk_scan INTEGER DEFAULT 0");
  });
  db.all("PRAGMA table_info(CompanyInformation_tbl)", [], (_e, cols) => {
    if (cols && !cols.some((c) => c.name === "CompanyInformation_Logo"))
      db.run("ALTER TABLE CompanyInformation_tbl ADD COLUMN CompanyInformation_Logo TEXT");
    if (cols && !cols.some((c) => c.name === "CurrencySymbol"))
      db.run("ALTER TABLE CompanyInformation_tbl ADD COLUMN CurrencySymbol TEXT DEFAULT 'د.ع'");
    if (cols && !cols.some((c) => c.name === "CompanyInformation_TaxNo"))
      db.run("ALTER TABLE CompanyInformation_tbl ADD COLUMN CompanyInformation_TaxNo TEXT");
  });
  db.all("PRAGMA table_info(DetailsOUT_tbl)", [], (_e, cols) => {
    if (cols && !cols.some((c) => c.name === "gift_qty"))
      db.run("ALTER TABLE DetailsOUT_tbl ADD COLUMN gift_qty REAL DEFAULT 0");
    if (cols && !cols.some((c) => c.name === "id_Warehouse"))
      db.run("ALTER TABLE DetailsOUT_tbl ADD COLUMN id_Warehouse INTEGER");
  });
  db.all("PRAGMA table_info(FIN_tbl)", [], (_e, cols) => {
    if (!cols) return;
    if (!cols.some((c) => c.name === "id_Warehouse"))
      db.run("ALTER TABLE FIN_tbl ADD COLUMN id_Warehouse INTEGER");
    if (!cols.some((c) => c.name === "DriverName"))
      db.run("ALTER TABLE FIN_tbl ADD COLUMN DriverName TEXT");
    if (!cols.some((c) => c.name === "DriverMobile"))
      db.run("ALTER TABLE FIN_tbl ADD COLUMN DriverMobile TEXT");
    if (!cols.some((c) => c.name === "VehicleNumber"))
      db.run("ALTER TABLE FIN_tbl ADD COLUMN VehicleNumber TEXT");
    if (!cols.some((c) => c.name === "SGS"))
      db.run("ALTER TABLE FIN_tbl ADD COLUMN SGS REAL DEFAULT 0");
    if (!cols.some((c) => c.name === "ExportRelease"))
      db.run("ALTER TABLE FIN_tbl ADD COLUMN ExportRelease REAL DEFAULT 0");
    if (!cols.some((c) => c.name === "VehicleManifest"))
      db.run("ALTER TABLE FIN_tbl ADD COLUMN VehicleManifest REAL DEFAULT 0");
    if (!cols.some((c) => c.name === "GeneralTax"))
      db.run("ALTER TABLE FIN_tbl ADD COLUMN GeneralTax REAL DEFAULT 0");
  });
  db.all("PRAGMA table_info(FOUT_tbl)", [], (_e, cols) => {
    if (!cols) return;
    if (!cols.some((c) => c.name === "Add_FOUT"))
      db.run("ALTER TABLE FOUT_tbl ADD COLUMN Add_FOUT REAL DEFAULT 0");
  });
  db.all("PRAGMA table_info(Mandob_tbl)", [], (_e, cols) => {
    if (cols && !cols.some((c) => c.name === "Mobile"))
      db.run("ALTER TABLE Mandob_tbl ADD COLUMN Mobile TEXT");
  });
  db.all("PRAGMA table_info(Materials_tbl)", [], (_e, cols) => {
    if (cols && !cols.some((c) => c.name === "WeightKg"))
      db.run("ALTER TABLE Materials_tbl ADD COLUMN WeightKg REAL DEFAULT 0");
  });

  db.run(`CREATE TABLE IF NOT EXISTS CashBox_tbl (
    id_CashBox   INTEGER PRIMARY KEY AUTOINCREMENT,
    CashBoxName  TEXT    NOT NULL UNIQUE
  )`);

  db.all("PRAGMA table_info(CatchDoc_tbl)", [], (_e, cols) => {
    if (!cols) return;
    if (!cols.some((c) => c.name === "id_CashBox"))
      db.run("ALTER TABLE CatchDoc_tbl ADD COLUMN id_CashBox INTEGER");
    if (!cols.some((c) => c.name === "AllowanceAmount"))
      db.run("ALTER TABLE CatchDoc_tbl ADD COLUMN AllowanceAmount REAL DEFAULT 0");
  });
  db.all("PRAGMA table_info(PayDoc_tbl)", [], (_e, cols) => {
    if (!cols) return;
    if (!cols.some((c) => c.name === "id_CashBox"))
      db.run("ALTER TABLE PayDoc_tbl ADD COLUMN id_CashBox INTEGER");
  });

  // ── المستودعات وربط المخزون بالمستودع ─────────────────
  db.run(`CREATE TABLE IF NOT EXISTS Warehouses_tbl (
    id_Warehouse    INTEGER PRIMARY KEY AUTOINCREMENT,
    WarehouseName   TEXT    NOT NULL,
    Location        TEXT,
    Manager         TEXT,
    IsActive        INTEGER DEFAULT 1
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS Product_Warehouse_tbl (
    id_ProductWarehouse INTEGER PRIMARY KEY AUTOINCREMENT,
    id_Material_NoM     INTEGER NOT NULL,
    id_Warehouse        INTEGER NOT NULL,
    QuantityOnHand      REAL    DEFAULT 0,
    UNIQUE(id_Material_NoM, id_Warehouse)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS Stock_Transfer_tbl (
    id_Transfer         INTEGER PRIMARY KEY AUTOINCREMENT,
    Date_Transfer       TEXT    NOT NULL,
    id_Warehouse_From   INTEGER NOT NULL,
    id_Warehouse_To     INTEGER NOT NULL,
    Note_Transfer       TEXT,
    CreatedAt           TEXT    DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS Stock_Transfer_Lines_tbl (
    id_TransferLine INTEGER PRIMARY KEY AUTOINCREMENT,
    id_Transfer     INTEGER NOT NULL,
    id_Material_NoM INTEGER NOT NULL,
    Quantity        REAL    NOT NULL DEFAULT 0
  )`);

  // ── إنشاء ExpiredStock_tbl إن لم تكن موجودة ──────────
  db.run(`CREATE TABLE IF NOT EXISTS ExpiredStock_tbl (
    id_Expired      INTEGER PRIMARY KEY AUTOINCREMENT,
    id_Material_NoM INTEGER NOT NULL,
    id_DetailsIN    INTEGER,
    ExpiredQty      REAL    NOT NULL DEFAULT 0,
    CostPrice       REAL    DEFAULT 0,
    TotalLoss       REAL    DEFAULT 0,
    ExpairDate      TEXT,
    ProcessedDate   TEXT    DEFAULT (date('now')),
    Notes           TEXT
  )`);

  // ── إنشاء ProjectCapital_tbl إن لم تكن موجودة ────────
  db.run(`CREATE TABLE IF NOT EXISTS ProjectCapital_tbl (
    id_Capital    INTEGER PRIMARY KEY AUTOINCREMENT,
    CapitalAmount REAL    NOT NULL DEFAULT 0,
    DepositDate   TEXT    DEFAULT (date('now')),
    Notes         TEXT
  )`);

  // ── المحاسبة — شجرة الحسابات والاندثار ─────────────────
  db.run(`CREATE TABLE IF NOT EXISTS GL_Accounts (
    id_GL_Account  INTEGER PRIMARY KEY AUTOINCREMENT,
    AccountCode    TEXT    NOT NULL UNIQUE,
    AccountName    TEXT    NOT NULL,
    AccountType    TEXT    NOT NULL,
    ParentCode     TEXT,
    IsSystem       INTEGER DEFAULT 0,
    BalanceSource  TEXT    DEFAULT 'MANUAL',
    IsActive       INTEGER DEFAULT 1,
    Notes          TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS Fixed_Assets_tbl (
    id_Asset         INTEGER PRIMARY KEY AUTOINCREMENT,
    AssetName        TEXT    NOT NULL,
    id_GL_Account    INTEGER NOT NULL,
    AcquisitionCost  REAL    NOT NULL DEFAULT 0,
    AcquisitionDate  TEXT    DEFAULT (date('now')),
    UsefulLifeMonths INTEGER DEFAULT 60,
    SalvageValue     REAL    DEFAULT 0,
    IsActive         INTEGER DEFAULT 1,
    Notes            TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS Depreciation_Entry_tbl (
    id_Entry    INTEGER PRIMARY KEY AUTOINCREMENT,
    id_Asset    INTEGER,
    Amount      REAL    NOT NULL DEFAULT 0,
    EntryDate   TEXT    NOT NULL,
    FiscalYear  INTEGER,
    Note        TEXT,
    IsNonCash   INTEGER DEFAULT 1
  )`);

  db.all("PRAGMA table_info(Spending_tbl)", [], (_e, cols) => {
    if (cols && !cols.some((c) => c.name === "id_GL_Account"))
      db.run("ALTER TABLE Spending_tbl ADD COLUMN id_GL_Account INTEGER");
  });

  // ── إنشاء PriceHistory_tbl إن لم تكن موجودة ──────────
  db.run(`CREATE TABLE IF NOT EXISTS PriceHistory_tbl (
    id_PriceHistory  INTEGER PRIMARY KEY AUTOINCREMENT,
    id_Material_NoM  INTEGER,
    SellPrice        REAL    DEFAULT 0,
    CostPrice        REAL    DEFAULT 0,
    EffectiveDate    TEXT    DEFAULT (date('now')),
    EffectiveTime    TEXT    DEFAULT (time('now')),
    IsCurrentPrice   INTEGER DEFAULT 1,
    ChangedByUser    INTEGER,
    ChangeNotes      TEXT
  )`);

  // ── سجل العمليات ─────────────────────────────────────
  db.run(`CREATE TABLE IF NOT EXISTS AuditLog_tbl (
    id_AuditLog  INTEGER PRIMARY KEY AUTOINCREMENT,
    id_User      INTEGER,
    UserName     TEXT,
    TableName    TEXT,
    RecordID     INTEGER,
    FieldName    TEXT,
    OldValue     TEXT,
    NewValue     TEXT,
    Notes        TEXT,
    ChangeDate   TEXT DEFAULT (date('now')),
    ChangeTime   TEXT DEFAULT (time('now'))
  )`);

  db.all("PRAGMA table_info(AuditLog_tbl)", [], (_e, cols) => {
    if (!cols || !cols.length) return;
    const names = cols.map((c) => c.name);
    if (names.includes("UserId") && !names.includes("id_User")) {
      db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS AuditLog_tbl_new (
          id_AuditLog INTEGER PRIMARY KEY AUTOINCREMENT,
          id_User INTEGER, UserName TEXT, TableName TEXT, RecordID INTEGER,
          FieldName TEXT, OldValue TEXT, NewValue TEXT, Notes TEXT,
          ChangeDate TEXT DEFAULT (date('now')),
          ChangeTime TEXT DEFAULT (time('now'))
        )`);
        db.run(
          `INSERT INTO AuditLog_tbl_new (id_User, TableName, RecordID, FieldName, Notes, ChangeDate, ChangeTime)
           SELECT UserId, TableName, RecordId, Action, Details,
                  date(COALESCE(Timestamp, datetime('now'))),
                  time(COALESCE(Timestamp, datetime('now')))
           FROM AuditLog_tbl`
        );
        db.run("DROP TABLE AuditLog_tbl");
        db.run("ALTER TABLE AuditLog_tbl_new RENAME TO AuditLog_tbl");
      });
      return;
    }
    const add = (col, def) => {
      if (!names.includes(col)) db.run(`ALTER TABLE AuditLog_tbl ADD COLUMN ${col} ${def}`);
    };
    add("id_User", "INTEGER");
    add("UserName", "TEXT");
    add("RecordID", "INTEGER");
    add("FieldName", "TEXT");
    add("OldValue", "TEXT");
    add("NewValue", "TEXT");
    add("Notes", "TEXT");
    add("ChangeDate", "TEXT");
    add("ChangeTime", "TEXT");
  });

  db.run(`CREATE TABLE IF NOT EXISTS AdminRecovery_tbl (
    id       INTEGER PRIMARY KEY CHECK (id = 1),
    UserName TEXT NOT NULL,
    Payload  TEXT NOT NULL,
    Iv       TEXT NOT NULL,
    Tag      TEXT NOT NULL,
    UpdatedAt TEXT DEFAULT (datetime('now'))
  )`);

  return db;
}

function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDB().all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

function queryOne(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDB().get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDB().run(sql, params, function (err) {
      err ? reject(err) : resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function runTransaction(queries) {
  return new Promise((resolve, reject) => {
    const conn = getDB();
    conn.serialize(() => {
      conn.run("BEGIN TRANSACTION");
      const results = [];
      const next = (i) => {
        if (i >= queries.length)
          return conn.run("COMMIT", (e) => (e ? reject(e) : resolve(results)));
        const { sql, params = [] } = queries[i];
        conn.run(sql, params, function (err) {
          if (err) return conn.run("ROLLBACK", () => reject(err));
          results.push({ lastID: this.lastID, changes: this.changes });
          next(i + 1);
        });
      };
      next(0);
    });
  });
}

function closeDB() {
  return new Promise((resolve, reject) => {
    if (!db) return resolve();
    const conn = db;
    db = null;
    conn.close((err) => (err ? reject(err) : resolve()));
  });
}

/** دمج ملف WAL في القاعدة الرئيسية (اختياري — النسخ عبر backup API يدمج WAL تلقائياً) */
async function checkpointDatabase() {
  try {
    await run("PRAGMA wal_checkpoint(TRUNCATE)");
  } catch {
    /* تجاهل — قد يكون الجدول مقفلاً أثناء التهيئة */
  }
}

/** نسخ احتياطي آمن — اتصال قراءة منفصل حتى لا يُجمّد طلبات الـ API */
function backupDatabaseToFile(destPath) {
  return new Promise((resolve, reject) => {
    const dest   = path.resolve(destPath);
    const source = ACTIVE_DB_PATH;
    try {
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
    } catch { /* ignore */ }
    const srcConn = new sqlite3.Database(source, sqlite3.OPEN_READONLY, (openErr) => {
      if (openErr) return reject(openErr);
      const backup = srcConn.backup(dest);
      backup.step(-1, (err) => {
        srcConn.close(() => (err ? reject(err) : resolve()));
      });
    });
  });
}

/** استعادة ملف .db إلى القاعدة النشطة عبر SQLite backup API (أدق من copyFileSync) */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function removeWalShm(basePath) {
  for (const suffix of ["-wal", "-shm"]) {
    try { fs.unlinkSync(basePath + suffix); } catch { /* ignore */ }
  }
}

function backupFileToPath(sourcePath, destPath) {
  return new Promise((resolve, reject) => {
    const source = path.resolve(sourcePath);
    const dest   = path.resolve(destPath);
    try {
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
    } catch { /* ignore */ }
    const srcConn = new sqlite3.Database(source, sqlite3.OPEN_READONLY, (openErr) => {
      if (openErr) return reject(openErr);
      const backup = srcConn.backup(dest);
      backup.step(-1, (err) => {
        srcConn.close(() => (err ? reject(err) : resolve()));
      });
    });
  });
}

async function replaceActiveDbFile(tempPath, targetPath, attempts = 10) {
  const target = path.resolve(targetPath);
  const temp   = path.resolve(tempPath);

  for (let i = 0; i < attempts; i++) {
    removeWalShm(target);
    try {
      if (fs.existsSync(target)) fs.unlinkSync(target);
      fs.renameSync(temp, target);
      removeWalShm(target);
      return;
    } catch (e) {
      if (i === attempts - 1) {
        throw new Error(`تعذّر استبدال القاعدة النشطة: ${e.message}`);
      }
      await sleep(400 + i * 250);
    }
  }
}

async function restoreDatabaseToFile(sourcePath, targetPath) {
  const source = path.resolve(sourcePath);
  const target = path.resolve(targetPath);
  const dir    = path.dirname(target);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const tempPath = path.join(dir, `.restore-${Date.now()}-${path.basename(target)}`);
  try {
    await backupFileToPath(source, tempPath);
    await replaceActiveDbFile(tempPath, target);
  } catch (e) {
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch { /* ignore */ }
    throw e;
  }
}

function countInFileDb(conn, table) {
  return new Promise((resolve) => {
    conn.get(`SELECT COUNT(*) AS n FROM ${table}`, [], (err, row) => {
      resolve(err ? 0 : (row?.n || 0));
    });
  });
}

/** فحص سريع لملف نسخة احتياطية قبل الاستعادة */
function inspectDatabaseFile(filePath) {
  return new Promise((resolve, reject) => {
    const src = path.resolve(filePath);
    const conn = new sqlite3.Database(src, sqlite3.OPEN_READONLY, async (err) => {
      if (err) return reject(err);
      try {
        const tables = await new Promise((res, rej) => {
          conn.get(
            `SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'`,
            [],
            (e, row) => (e ? rej(e) : res(row?.n || 0))
          );
        });
        const [users, materials, customers, suppliers, mandobs] = await Promise.all([
          countInFileDb(conn, "Users_tbl"),
          countInFileDb(conn, "Materials_tbl"),
          countInFileDb(conn, "Zabon_tbl"),
          countInFileDb(conn, "Amil_tbl"),
          countInFileDb(conn, "Mandob_tbl"),
        ]);
        conn.close();
        resolve({ tables, users, materials, customers, suppliers, mandobs });
      } catch (e) {
        conn.close(() => reject(e));
      }
    });
  });
}

/** استبدال قاعدة البيانات النشطة بنسخة احتياطية ثم إعادة الاتصال */
async function replaceDatabaseFromFile(sourcePath) {
  const source = path.resolve(sourcePath);
  const target = ACTIVE_DB_PATH;

  if (!fs.existsSync(source)) {
    throw new Error("ملف النسخة الاحتياطية غير موجود");
  }

  const srcSize = fs.statSync(source).size;
  if (srcSize < 512) {
    throw new Error("ملف النسخة الاحتياطية تالف أو فارغ");
  }

  let inspection;
  try {
    inspection = await inspectDatabaseFile(source);
  } catch (e) {
    throw new Error(`ملف النسخة الاحتياطية غير صالح: ${e.message}`);
  }

  if (!inspection.tables) {
    throw new Error("ملف النسخة الاحتياطية لا يحتوي على جداول");
  }

  await checkpointDatabase();
  await closeDB();
  await sleep(500);

  await restoreDatabaseToFile(source, target);

  getDB();
  await checkpointDatabase();

  const restored = await inspectDatabaseFile(target);

  const srcBusiness =
    (inspection.materials || 0) +
    (inspection.customers || 0) +
    (inspection.suppliers || 0);
  const dstBusiness =
    (restored.materials || 0) +
    (restored.customers || 0) +
    (restored.suppliers || 0);

  if (srcBusiness > 0 && dstBusiness === 0) {
    throw new Error(
      `فشل كتابة البيانات إلى القاعدة النشطة (${target}) — أعد تشغيل البرنامج ثم حاول مرة أخرى`
    );
  }

  console.log(`✅ استُبدلت القاعدة النشطة من: ${source}`);
  console.log(`   → ${target} (مواد: ${restored.materials || 0}, زبائن: ${restored.customers || 0})`);

  return { inspection, restored, activeDbPath: target };
}

module.exports = {
  query, queryOne, run, runTransaction,
  closeDB, checkpointDatabase, backupDatabaseToFile,
  inspectDatabaseFile, replaceDatabaseFromFile,
};
