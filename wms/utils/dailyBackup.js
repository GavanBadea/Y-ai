// ============================================================
//  dailyBackup.js — نسخة احتياطية يومية إلى مجلد Google Drive
// ============================================================
"use strict";

const fs   = require("fs");
const path = require("path");
const os   = require("os");
const { execSync } = require("child_process");

const APP_DIR       = path.join(__dirname, "..");
const INSTALL_ROOT  = path.dirname(APP_DIR);
const SETTINGS_FILE = "backup_auto.json";
const DRIVE_FOLDER  = "Y-ai-WMS-Backups";
const DAY_MS        = 24 * 60 * 60 * 1000;

function resolveBackupDir() {
  const raw = String(process.env.BACKUP_PATH || "").trim();
  if (!raw) return path.join(INSTALL_ROOT, "backups");
  if (path.isAbsolute(raw)) return path.normalize(raw);
  return path.normalize(path.resolve(APP_DIR, raw));
}

function settingsPath() {
  return path.join(resolveBackupDir(), SETTINGS_FILE);
}

function readSettings() {
  try {
    const p = settingsPath();
    if (!fs.existsSync(p)) return { email: "", enabled: false, drivePath: "" };
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return { email: "", enabled: false, drivePath: "" };
  }
}

function writeSettings(patch) {
  const dir = resolveBackupDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const prev = readSettings();
  const next = { ...prev, ...patch, updatedAt: new Date().toISOString() };
  fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2), "utf8");
  return next;
}

function expandEnvPath(p) {
  let s = String(p || "").trim();
  if (!s) return "";
  const user = path.basename(os.homedir());
  s = s.replace(/%USERNAME%/gi, user).replace(/%USERPROFILE%/gi, os.homedir());
  return path.normalize(s);
}

function existsDir(p) {
  try {
    return !!p && fs.existsSync(p) && fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function readWinRegString(keyPath, valueName) {
  if (process.platform !== "win32") return null;
  try {
    const out = execSync(`reg query "${keyPath}" /v "${valueName}"`, {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["pipe", "pipe", "ignore"],
    });
    const line = out.split(/\r?\n/).find((l) => l.includes(valueName));
    if (!line) return null;
    const val = line.replace(new RegExp(`.*${valueName}\\s+REG_(?:SZ|EXPAND_SZ)\\s+`, "i"), "").trim();
    return val || null;
  } catch {
    return null;
  }
}

function readPerAccountMountPoint() {
  const raw = readWinRegString("HKCU\\Software\\Google\\DriveFS", "PerAccountPreferences");
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    const list = data?.per_account_preferences || [];
    for (const item of list) {
      const mp = item?.value?.mount_point_path;
      if (mp) return String(mp).trim();
    }
  } catch { /* ignore */ }
  return null;
}

function normalizeMountPoint(mp) {
  const raw = expandEnvPath(mp);
  if (!raw) return null;
  if (/^[a-zA-Z]$/.test(raw)) return `${raw.toUpperCase()}:\\`;
  if (/^[a-zA-Z]:$/.test(raw)) return `${raw}\\`;
  if (/^[a-zA-Z]:\\/.test(raw)) return raw;
  return raw;
}

function resolveDriveRoot(candidate) {
  if (!existsDir(candidate)) return null;
  const myDrive = path.join(candidate, "My Drive");
  if (existsDir(myDrive)) return myDrive;
  const base = path.basename(candidate).toLowerCase();
  if (["my drive", "google drive", "googledrive"].includes(base)) return candidate;
  return candidate;
}

function scanWindowsDriveLetters() {
  if (process.platform !== "win32") return null;
  for (let code = 71; code <= 90; code += 1) {
    const letter = String.fromCharCode(code);
    const root = `${letter}:\\`;
    if (!existsDir(root)) continue;
    const myDrive = path.join(root, "My Drive");
    if (existsDir(myDrive)) return myDrive;
  }
  for (const letter of ["G", "H"]) {
    const root = `${letter}:\\`;
    if (existsDir(root)) return root;
  }
  return null;
}

function findDriveSyncRoot() {
  const settings = readSettings();
  const custom = expandEnvPath(settings.drivePath);
  if (custom && existsDir(custom)) return resolveDriveRoot(custom) || custom;

  const envPath = expandEnvPath(process.env.GOOGLE_DRIVE_PATH || "");
  if (envPath && existsDir(envPath)) return resolveDriveRoot(envPath) || envPath;

  if (process.platform === "win32") {
    const regKeys = [
      "HKCU\\Software\\Google\\DriveFS",
      "HKLM\\Software\\Google\\DriveFS",
      "HKLM\\Software\\Policies\\Google\\DriveFS",
      "HKCU\\Software\\Google\\Drive",
    ];
    for (const key of regKeys) {
      const mp = readWinRegString(key, "DefaultMountPoint");
      const resolved = resolveDriveRoot(normalizeMountPoint(mp));
      if (resolved) return resolved;
    }
    const perAccount = resolveDriveRoot(normalizeMountPoint(readPerAccountMountPoint()));
    if (perAccount) return perAccount;

    const letterScan = scanWindowsDriveLetters();
    if (letterScan) return letterScan;
  }

  const home = os.homedir();
  const candidates = [
    path.join(home, "Google Drive"),
    path.join(home, "GoogleDrive"),
    path.join(home, "My Drive"),
  ];
  for (const c of candidates) {
    const resolved = resolveDriveRoot(c);
    if (resolved) return resolved;
  }
  return null;
}

function driveBackupDir() {
  const root = findDriveSyncRoot();
  if (!root) return null;
  const dest = path.join(root, DRIVE_FOLDER);
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  return dest;
}

async function runDailyBackup(createBackupFn) {
  const settings = readSettings();
  if (!settings.enabled) return { skipped: true, reason: "disabled" };

  const now = Date.now();
  const last = settings.lastRun ? new Date(settings.lastRun).getTime() : 0;
  if (last && now - last < DAY_MS - 60000) {
    return { skipped: true, reason: "not_due" };
  }

  const info = await createBackupFn("auto_daily");
  const driveDir = driveBackupDir();
  let driveCopyPath = null;

  if (driveDir) {
    driveCopyPath = path.join(driveDir, info.filename);
    fs.copyFileSync(info.path, driveCopyPath);
  }

  const saved = writeSettings({
    lastRun      : new Date().toISOString(),
    lastFile     : info.filename,
    lastLocalPath: info.path,
    lastDrivePath: driveCopyPath,
    driveRoot    : findDriveSyncRoot(),
  });

  return {
    skipped: false,
    backup : info,
    driveCopyPath,
    settings: saved,
  };
}

function startDailyBackupScheduler(createBackupFn) {
  const tick = () => {
    runDailyBackup(createBackupFn).catch((e) => {
      console.warn("⚠️ النسخ الاحتياطي اليومي:", e.message);
    });
  };
  setTimeout(tick, 3 * 60 * 1000);
  setInterval(tick, DAY_MS);
}

module.exports = {
  resolveBackupDir,
  readSettings,
  writeSettings,
  findDriveSyncRoot,
  driveBackupDir,
  runDailyBackup,
  startDailyBackupScheduler,
};
