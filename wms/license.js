// ============================================================
//  license.js — نظام ترخيص Y-ai WMS
//
//  المهام:
//   • توليد هاش 14-رقماً مرتبط بالجهاز (ثابت عبر إعادة التشغيل)
//   • التحقق من مفتاح التفعيل
//   • حفظ/قراءة حالة الترخيص في license.dat
// ============================================================
"use strict";

const crypto = require("crypto");
const os     = require("os");
const fs     = require("fs");
const path   = require("path");
const { execSync } = require("child_process");

// ── المسارات ──────────────────────────────────────────────
// يدعم متغير LICENSE_FILE من البيئة (يُضبط في launcher.bat)
// للتخزين في مجلد قابل للكتابة بدلاً من مجلد التطبيق
const LICENSE_FILE = process.env.LICENSE_FILE
  ? path.resolve(process.env.LICENSE_FILE)
  : path.join(__dirname, "license.dat");

const MACHINE_ID_FILE = path.join(path.dirname(LICENSE_FILE), "machine.id");

// ── سر التوقيع (للتحقق من المفتاح) ───────────────────────
// يُضمَّن هنا فقط للتحقق — المولِّد في أداة المبرمج
const SIGN_SECRET = "YAI-WMS-GAVAN-2024-LIC-7G3K9X";

// ══════════════════════════════════════════════════════════
//  معرّف جهاز ثابت — لا يعتمد على MAC/الشبكة
// ══════════════════════════════════════════════════════════
function ensureDir(filePath) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  } catch { /* قد يكون المجلد موجوداً */ }
}

function getWindowsMachineGuid() {
  if (process.platform !== "win32") return "";
  try {
    const out = execSync(
      'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
      { encoding: "utf8", windowsHide: true, timeout: 3000 }
    );
    const m = out.match(/MachineGuid\s+REG_SZ\s+([0-9A-Fa-f-]+)/i);
    return m ? m[1].trim().toLowerCase() : "";
  } catch {
    return "";
  }
}

function buildStableSeed() {
  const parts = [
    getWindowsMachineGuid(),
    os.hostname().toLowerCase(),
    os.platform(),
    os.arch(),
  ].filter(Boolean);
  return parts.join("||") || (os.hostname() + os.platform() + os.arch());
}

function getOrCreateMachineId() {
  try {
    if (fs.existsSync(MACHINE_ID_FILE)) {
      const existing = fs.readFileSync(MACHINE_ID_FILE, "utf8").trim();
      if (existing.length >= 32) return existing;
    }
  } catch { /* إعادة إنشاء */ }

  const id = crypto.createHash("sha256").update(buildStableSeed()).digest("hex");
  try {
    ensureDir(MACHINE_ID_FILE);
    fs.writeFileSync(MACHINE_ID_FILE, id, "utf8");
  } catch { /* القراءة التالية ستعيد المحاولة */ }
  return id;
}

function digitsFromSeed(seed) {
  const hex = crypto.createHash("sha256").update(seed).digest("hex");
  let digits = "";
  for (const c of hex) {
    digits += (parseInt(c, 16) % 10).toString();
    if (digits.length >= 14) break;
  }
  return digits.padEnd(14, "0").slice(0, 14);
}

// ══════════════════════════════════════════════════════════
//  getMachineHash — هاش 14 رقماً مرتبط بالجهاز (ثابت)
// ══════════════════════════════════════════════════════════
function getMachineHash() {
  try {
    return digitsFromSeed(getOrCreateMachineId());
  } catch {
    return digitsFromSeed(buildStableSeed());
  }
}

// ══════════════════════════════════════════════════════════
//  verifyKey — التحقق من مفتاح التفعيل
// ══════════════════════════════════════════════════════════
function verifyKey(hash, key) {
  if (!hash || !key) return false;
  const expected = crypto
    .createHmac("sha256", SIGN_SECRET)
    .update(hash)
    .digest("hex")
    .slice(0, 16)
    .toUpperCase();
  return key.trim().toUpperCase() === expected;
}

// ══════════════════════════════════════════════════════════
//  isActivated — هل البرنامج مُفعَّل؟
// ══════════════════════════════════════════════════════════
function isActivated() {
  try {
    if (!fs.existsSync(LICENSE_FILE)) return false;
    const data = JSON.parse(fs.readFileSync(LICENSE_FILE, "utf8"));
    if (!data.hash || !data.key) return false;
    if (!verifyKey(data.hash, data.key)) return false;

    const currentHash = getMachineHash();
    const machineId = getOrCreateMachineId();

    // الربط الثابت (الإصدارات الجديدة)
    if (data.machineId && data.machineId === machineId) return true;

    // تطابق الهاش الحالي
    if (data.hash === currentHash) {
      // ترقية صامتة: حفظ machineId حتى لا يُطلب التفعيل لاحقاً
      if (!data.machineId) {
        try {
          ensureDir(LICENSE_FILE);
          fs.writeFileSync(
            LICENSE_FILE,
            JSON.stringify({
              hash: data.hash,
              key: data.key,
              machineId,
              activatedAt: data.activatedAt || new Date().toISOString(),
            }, null, 2),
            "utf8"
          );
        } catch { /* تجاهل */ }
      }
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

// ══════════════════════════════════════════════════════════
//  activate — حفظ ملف الترخيص بعد التحقق
// ══════════════════════════════════════════════════════════
function activate(hash, key) {
  const currentHash = getMachineHash();
  if (hash !== currentHash) return { success: false, message: "الهاش لا يتطابق مع هذا الجهاز" };
  if (!verifyKey(hash, key))   return { success: false, message: "مفتاح التفعيل غير صحيح" };

  try {
    ensureDir(LICENSE_FILE);
    const machineId = getOrCreateMachineId();
    fs.writeFileSync(
      LICENSE_FILE,
      JSON.stringify({
        hash,
        key: key.trim().toUpperCase(),
        machineId,
        activatedAt: new Date().toISOString(),
      }, null, 2),
      "utf8"
    );

    // تأكيد فوري أن الملف يُقرأ بنجاح
    if (!isActivated()) {
      return { success: false, message: "تم الحفظ لكن التحقق فشل — تحقق من صلاحيات مجلد البيانات" };
    }

    return { success: true };
  } catch (e) {
    return { success: false, message: "فشل حفظ ملف الترخيص: " + e.message };
  }
}

// ══════════════════════════════════════════════════════════
//  getLocalIPs — عناوين IP على الشبكة المحلية
// ══════════════════════════════════════════════════════════
function getLocalIPs() {
  const ifaces = os.networkInterfaces();
  const ips = [];
  for (const list of Object.values(ifaces)) {
    for (const item of list) {
      if (!item.internal && item.family === "IPv4") {
        ips.push(item.address);
      }
    }
  }
  return ips;
}

module.exports = { getMachineHash, verifyKey, isActivated, activate, getLocalIPs };
