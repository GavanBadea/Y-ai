// ============================================================
//  controllers/whatsapp.controller.js
//  خدمة واتساب — مبنية على whatsapp-web.js
//
//  المسارات:
//   GET  /api/whatsapp/status  → حالة الاتصال
//   GET  /api/whatsapp/qr      → كود QR للمسح
//   POST /api/whatsapp/send    → إرسال رسالة يدوياً
//   POST /api/whatsapp/logout  → قطع الاتصال
//
//  الدالة العامة:
//   sendWhatsApp(phone, message) → تُستخدم من أي controller آخر
//
//  ملاحظة تقنية:
//   whatsapp-web.js تُشغّل متصفح Chromium خفياً (Puppeteer).
//   عند أول تشغيل → يُولَّد QR، المدير يمسحه ببيومتريه.
//   بعد المسح → الجلسة تُحفَظ في مجلد .wwebjs_auth
//   يمكن إعادة الاتصال بدون مسح QR من جديد.
// ============================================================
const fs   = require("fs");
const os   = require("os");
const path = require("path");
const { execSync } = require("child_process");

const { Client, LocalAuth, MessageMedia } = (() => {
  try {
    return require("whatsapp-web.js");
  } catch {
    // إذا لم تُثبَّت المكتبة → أرجع stubs آمنة
    console.warn("⚠ whatsapp-web.js غير مثبّتة. شغّل: npm install whatsapp-web.js qrcode");
    return {
      Client      : null,
      LocalAuth   : null,
      MessageMedia: null,
    };
  }
})();

// ──────────────────────────────────────────────────────────
//  الحالة الداخلية (Singleton)
// ──────────────────────────────────────────────────────────
let waClient       = null;   // كائن العميل
let qrCodeData     = null;   // base64 صورة QR
let status         = "idle"; // idle | initializing | qr_ready | connected | disconnected | error
let statusMsg      = "لم يبدأ الاتصال بعد";
let isLibReady     = !!Client;
let initInProgress = false;

const WA_CLIENT_ID = "yvg-wms";

function resolveDataDir() {
  if (process.env.LICENSE_FILE) return path.dirname(path.resolve(process.env.LICENSE_FILE));
  if (process.env.DB_PATH) return path.dirname(path.resolve(process.env.DB_PATH));
  return path.resolve(__dirname, "..");
}

const WA_DATA_PATH   = path.join(resolveDataDir(), ".wwebjs_auth");
const WA_SESSION_DIR = path.join(WA_DATA_PATH, `session-${WA_CLIENT_ID}`);

/** Chrome/Edge المثبت على الجهاز — لا يعتمد على ذاكرة Puppeteer المؤقتة */
function findBrowserExecutable() {
  const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

  const localAppData = process.env.LOCALAPPDATA || "";
  const programFiles = process.env.PROGRAMFILES || "C:\\Program Files";
  const programFilesX86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";

  const candidates = [
    path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe"),
    // مسارات شائعة إضافية
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function buildClientOptions() {
  if (!LocalAuth) return null;

  const executablePath = findBrowserExecutable();
  const puppeteer = {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--disable-gpu",
      "--disable-extensions",
    ],
  };

  if (executablePath) {
    puppeteer.executablePath = executablePath;
  }

  // مجلد كاش قابل للكتابة داخل data (وليس مجلد المستخدم الافتراضي)
  const cacheDir = path.join(resolveDataDir(), "puppeteer-cache");
  try { fs.mkdirSync(cacheDir, { recursive: true }); } catch { /* ignore */ }
  process.env.PUPPETEER_CACHE_DIR = cacheDir;

  return {
    authStrategy: new LocalAuth({ clientId: WA_CLIENT_ID, dataPath: WA_DATA_PATH }),
    puppeteer,
  };
}

// ──────────────────────────────────────────────────────────
//  تنظيف متصفح عالق / ملفات قفل الجلسة
// ──────────────────────────────────────────────────────────
function clearStaleBrowserLocks() {
  const lockFiles = ["lockfile", "SingletonLock", "SingletonCookie", "SingletonSocket", "DevToolsActivePort"];
  for (const name of lockFiles) {
    try {
      const filePath = path.join(WA_SESSION_DIR, name);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch { /* قد يكون الملف مقفولاً من عملية نشطة */ }
  }
}

function killOrphanedSessionBrowsers() {
  const sessionMarker = `session-${WA_CLIENT_ID}`;
  try {
    if (process.platform === "win32") {
      const ps = [
        "Get-CimInstance Win32_Process",
        "-Filter \"Name='chrome.exe' OR Name='chromium.exe' OR Name='msedge.exe'\"",
        `| Where-Object { $_.CommandLine -like '*${sessionMarker}*' }`,
        "| ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
      ].join(" ");
      execSync(`powershell -NoProfile -Command "${ps}"`, { stdio: "ignore" });
    } else {
      execSync(`pkill -f '${sessionMarker}'`, { stdio: "ignore" });
    }
  } catch { /* لا توجد عملية عالقة */ }
  clearStaleBrowserLocks();
}

async function destroyWaClient() {
  const client = waClient;
  waClient = null;
  if (!client) return;
  try {
    await client.destroy();
  } catch {
    try {
      const browser = client.pupBrowser;
      if (browser) await browser.close();
    } catch { /* تجاهل */ }
  }
}

function attachClientEvents(client) {
  client.on("qr", async (qr) => {
    try {
      const QRCode = require("qrcode");
      qrCodeData = await QRCode.toDataURL(qr);
      status    = "qr_ready";
      statusMsg = "كود QR جاهز — امسحه بتطبيق واتساب";
      console.log("📱 QR Code جاهز للمسح");
    } catch {
      qrCodeData = qr;
      status    = "qr_ready";
      statusMsg = "كود QR جاهز (نص خام)";
    }
  });

  client.on("ready", () => {
    status    = "connected";
    statusMsg = "✅ متصل بواتساب بنجاح";
    qrCodeData = null;
    console.log("✅ واتساب متصل");
  });

  client.on("authenticated", () => {
    console.log("🔐 تمت المصادقة — جاري تحميل الجلسة");
    status    = "initializing";
    statusMsg = "تمت المصادقة — جاري تحميل البيانات...";
  });

  client.on("disconnected", async (reason) => {
    status    = "disconnected";
    statusMsg = `انقطع الاتصال: ${reason}`;
    qrCodeData = null;
    await destroyWaClient();
    console.warn("⚠ واتساب: انقطع الاتصال —", reason);
  });

  client.on("auth_failure", async (msg) => {
    status    = "error";
    statusMsg = `فشل المصادقة: ${msg}`;
    await destroyWaClient();
    console.error("❌ واتساب: فشل المصادقة —", msg);
  });
}

async function initializeClient(retry = false) {
  killOrphanedSessionBrowsers();

  const options = buildClientOptions();
  if (!options) {
    status    = "error";
    statusMsg = "المكتبة غير مثبّتة — شغّل: npm install whatsapp-web.js qrcode";
    throw new Error(statusMsg);
  }

  if (!options.puppeteer.executablePath) {
    status    = "error";
    statusMsg = "لم يُعثر على Chrome أو Edge على الجهاز. ثبّت Google Chrome أو Microsoft Edge ثم أعد المحاولة.";
    throw new Error(statusMsg);
  }

  try { fs.mkdirSync(WA_DATA_PATH, { recursive: true }); } catch { /* ignore */ }

  const client = new Client(options);
  attachClientEvents(client);
  waClient = client;

  try {
    await client.initialize();
  } catch (err) {
    await destroyWaClient();

    if (!retry && /already running/i.test(err.message)) {
      killOrphanedSessionBrowsers();
      await new Promise((resolve) => setTimeout(resolve, 800));
      return initializeClient(true);
    }

    const hint = /Could not find Chrome|Failed to launch/i.test(err.message)
      ? " — ثبّت Google Chrome أو Microsoft Edge على جهاز العميل"
      : "";
    status    = "error";
    statusMsg = `خطأ في التهيئة: ${err.message}${hint}`;
    console.error("❌ واتساب:", err.message);
    throw err;
  }
}

// ──────────────────────────────────────────────────────────
//  إنشاء وتهيئة العميل
// ──────────────────────────────────────────────────────────
function createClient() {
  if (!Client) {
    status    = "error";
    statusMsg = "المكتبة غير مثبّتة — شغّل: npm install whatsapp-web.js qrcode";
    return;
  }

  if (waClient || initInProgress) return;

  initInProgress = true;
  status    = "initializing";
  statusMsg = "جاري تهيئة عميل واتساب...";
  qrCodeData = null;

  initializeClient(false)
    .catch(() => {})
    .finally(() => { initInProgress = false; });
}

// ──────────────────────────────────────────────────────────
//  الدالة العامة: sendWhatsApp(phone, message)
//
//  phone  : رقم الهاتف بصيغة دولية (بدون +) مثال: 9647701234567
//  message: نص الرسالة
//  returns: { success, messageId? }
// ──────────────────────────────────────────────────────────
function cleanWhatsAppPhone(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("964")) return digits;
  if (digits.startsWith("0")) return "964" + digits.slice(1);
  if (digits.length === 10 && digits.startsWith("7")) return "964" + digits;
  return digits;
}

function asWhatsAppId(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value._serialized) return value._serialized;
  if (value.user && value.server) return `${value.user}@${value.server}`;
  return String(value);
}

/** تجهيز معرّفات المحادثة (LID / PN) — يحل خطأ No LID for user */
async function resolveWhatsAppChatTargets(phone) {
  const digits = cleanWhatsAppPhone(phone);
  if (!digits) throw new Error("رقم الهاتف فارغ أو غير صالح");

  const jid = `${digits}@c.us`;
  const registered = await waClient.getNumberId(digits);
  if (!registered?._serialized) {
    throw new Error("هذا الرقم غير مسجّل على واتساب — تحقق من صحة الرقم");
  }

  const candidates = new Set();

  // LID أولاً — إصدارات واتساب الحديثة ترفض @c.us بدون LID
  try {
    const rows = await waClient.getContactLidAndPhone([
      registered._serialized,
      jid,
      digits,
    ]);
    for (const row of rows || []) {
      const lid = asWhatsAppId(row?.lid);
      const pn = asWhatsAppId(row?.pn);
      if (lid) candidates.add(lid);
      if (pn) candidates.add(pn);
    }
  } catch { /* يُعاد المحاولة بالمعرّفات الأخرى */ }

  try {
    const contact = await waClient.getContactById(registered._serialized);
    const contactId = asWhatsAppId(contact?.id);
    if (contactId) candidates.add(contactId);
  } catch { /* ignore */ }

  candidates.add(registered._serialized);
  candidates.add(jid);

  return [...candidates].filter(Boolean).sort((a, b) => {
    const rank = (id) => {
      const s = String(id);
      if (s.includes("@lid")) return 0;
      if (s.endsWith("@c.us")) return 1;
      return 2;
    };
    return rank(a) - rank(b);
  });
}

async function deliverWhatsAppPayload(candidates, payload, options = {}) {
  let lastError = null;
  for (const targetId of candidates) {
    try {
      const msg = await waClient.sendMessage(targetId, payload, options);
      return { success: true, messageId: msg?.id?._serialized || null };
    } catch (err) {
      lastError = err;
      // إن فشل الإرسال المباشر جرّب عبر كائن المحادثة
      try {
        const chat = await waClient.getChatById(targetId);
        if (chat) {
          const msg = await chat.sendMessage(payload, options);
          return { success: true, messageId: msg?.id?._serialized || null };
        }
      } catch (err2) {
        lastError = err2;
      }
    }
  }
  throw lastError || new Error("تعذّر إرسال الرسالة");
}

async function sendWhatsApp(phone, message) {
  if (status !== "connected" || !waClient) {
    throw new Error("واتساب غير متصل. يرجى مسح QR أولاً.");
  }

  const text = String(message || "").trim();
  if (!text) throw new Error("الرسالة فارغة");

  // واتساب يقطع الرسائل الطويلة — نقسم بأمان
  const chunks = [];
  const maxLen = 3500;
  for (let i = 0; i < text.length; i += maxLen) {
    chunks.push(text.slice(i, i + maxLen));
  }

  try {
    const targets = await withWhatsAppTimeout(resolveWhatsAppChatTargets(phone), 20000);
    let lastMsg = null;
    let activeTarget = null;

    for (const chunk of chunks) {
      let sent = false;
      let lastError = null;
      const tryOrder = activeTarget
        ? [activeTarget, ...targets.filter((t) => t !== activeTarget)]
        : targets;

      for (const chatId of tryOrder) {
        try {
          lastMsg = await withWhatsAppTimeout(waClient.sendMessage(chatId, chunk), 30000);
          activeTarget = chatId;
          sent = true;
          break;
        } catch (err) {
          lastError = err;
        }
      }

      // مسار احتياطي عبر getChatById عند خطأ LID
      if (!sent) {
        for (const chatId of tryOrder) {
          try {
            const chat = await withWhatsAppTimeout(waClient.getChatById(chatId), 12000);
            if (!chat) continue;
            lastMsg = await withWhatsAppTimeout(chat.sendMessage(chunk), 30000);
            activeTarget = chatId;
            sent = true;
            break;
          } catch (err) {
            lastError = err;
          }
        }
      }

      if (!sent) throw lastError || new Error("تعذّر إرسال الرسالة");
    }

    return { success: true, messageId: lastMsg?.id?._serialized || null };
  } catch (err) {
    const errText = String(err?.message || err);
    if (/No LID/i.test(errText)) {
      throw new Error(
        "فشل إرسال الرسالة: واتساب لم يربط الرقم بمحادثة. افتح محادثة مع هذا الرقم من هاتفك مرة واحدة، ثم أعد ربط واتساب من الإعدادات وأعد المحاولة."
      );
    }
    throw new Error(`فشل إرسال الرسالة: ${errText}`);
  }
}

function withWhatsAppTimeout(promise, ms = 55000) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("انتهت مهلة إرسال واتساب — أعد المحاولة")),
        ms
      );
    }),
  ]);
}

function sanitizeWhatsAppPdfName(filename) {
  let safe = String(filename || "statement.pdf")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/[<>:"/\\|?*]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 60);
  if (!safe.toLowerCase().endsWith(".pdf")) safe = `${safe || "statement"}.pdf`;
  if (safe === ".pdf" || !safe) safe = "statement.pdf";
  return safe;
}

/** إرسال ملف PDF — يُستخدم من كشوف الحسابات فقط */
async function sendWhatsAppDocument(phone, base64, filename = "document.pdf", caption = "") {
  if (status !== "connected" || !waClient) {
    throw new Error("واتساب غير متصل. يرجى مسح QR أولاً من إعدادات ربط واتساب.");
  }
  if (!MessageMedia) {
    throw new Error("whatsapp-web.js غير مثبّتة");
  }

  const cleanBase64 = String(base64 || "")
    .replace(/^data:[^;]+;base64,/i, "")
    .replace(/\s+/g, "");
  if (!cleanBase64) {
    throw new Error("ملف PDF فارغ أو غير صالح");
  }
  // ~8MB ملف خام تقريباً — أكبر من ذلك يعلّق Puppeteer وقد يُسقط العملية
  if (cleanBase64.length > 11 * 1024 * 1024) {
    throw new Error("حجم ملف PDF كبير جداً — قلّل فترة الكشف ثم أعد المحاولة");
  }

  const digits = cleanWhatsAppPhone(phone);
  if (!digits) throw new Error("رقم الهاتف فارغ أو غير صالح");

  const safeName = sanitizeWhatsAppPdfName(filename);
  const tmpPath = path.join(os.tmpdir(), `wms-wa-${Date.now()}-${process.pid}.pdf`);
  const options = {
    caption: String(caption || "").slice(0, 900),
    sendMediaAsDocument: true,
    linkPreview: false,
  };

  let media;
  try {
    fs.writeFileSync(tmpPath, Buffer.from(cleanBase64, "base64"));
    media = MessageMedia.fromFilePath(tmpPath);
    media.filename = safeName;
    media.mimetype = "application/pdf";
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw new Error(`تعذّر تجهيز ملف PDF: ${err.message}`);
  }

  try {
    // مسار مباشر بدون getChatById (كان يعلّق الطلب ويُسقط المتصفح أحياناً)
    const registered = await withWhatsAppTimeout(waClient.getNumberId(digits), 20000);
    const chatIds = [];
    if (registered?._serialized) chatIds.push(registered._serialized);
    chatIds.push(`${digits}@c.us`);

    let lastError = null;
    for (const chatId of [...new Set(chatIds)]) {
      try {
        const msg = await withWhatsAppTimeout(
          waClient.sendMessage(chatId, media, options),
          55000
        );
        return { success: true, messageId: msg?.id?._serialized || null };
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error("تعذّر إرسال الملف");
  } catch (err) {
    throw new Error(`فشل إرسال الملف: ${err.message || err}`);
  } finally {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  }
}

// ══════════════════════════════════════════════════════════
//  Route Handlers
// ══════════════════════════════════════════════════════════

// GET /api/whatsapp/status
const getStatus = (req, res) => {
  res.json({
    success   : true,
    status,
    statusMsg,
    isLibReady,
    isConnected: status === "connected",
    hasQR      : status === "qr_ready" && !!qrCodeData,
  });
};

// GET /api/whatsapp/qr
//  يُشغّل العميل إذا لم يكن يعمل، ثم يُرجع QR
const getQR = async (req, res) => {
  if (!isLibReady) {
    return res.status(503).json({
      success: false,
      message: "whatsapp-web.js غير مثبّتة",
      install: "npm install whatsapp-web.js qrcode",
    });
  }

  // إذا لم يبدأ العميل بعد → شغّله
  if (!waClient && !initInProgress && status !== "connected") {
    createClient();
  }

  // انتظر حتى يصبح QR جاهزاً (max 30 ثانية)
  if (status === "initializing") {
    let waited = 0;
    await new Promise((resolve) => {
      const interval = setInterval(() => {
        waited += 500;
        if (status !== "initializing" || waited >= 30000) {
          clearInterval(interval);
          resolve();
        }
      }, 500);
    });
  }

  if (status === "connected") {
    return res.json({ success: true, status: "connected", message: "واتساب متصل بالفعل ✅" });
  }

  if (status === "qr_ready" && qrCodeData) {
    return res.json({
      success: true,
      status : "qr_ready",
      qr     : qrCodeData,   // base64 dataURL
      message: "امسح الكود من تطبيق واتساب",
    });
  }

  res.status(503).json({ success: false, status, message: statusMsg });
};

// POST /api/whatsapp/send
//  Body: { phone, message }
const sendMessage = async (req, res) => {
  const { phone, message } = req.body;

  if (!phone || !message)
    return res.status(400).json({ success: false, message: "phone و message مطلوبان" });

  try {
    const result = await sendWhatsApp(phone, message);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/whatsapp/connect  → تشغيل يدوي
const connect = (req, res) => {
  if (status === "connected")
    return res.json({ success: true, message: "متصل بالفعل" });

  if (!isLibReady)
    return res.status(503).json({ success: false, message: "المكتبة غير مثبّتة — npm install whatsapp-web.js qrcode" });

  if (!waClient && !initInProgress) createClient();
  res.json({ success: true, message: "جاري بدء الاتصال... راجع /api/whatsapp/qr" });
};

// POST /api/whatsapp/logout  → قطع الاتصال
const logout = async (req, res) => {
  if (!waClient)
    return res.json({ success: true, message: "لا يوجد اتصال نشط" });

  try {
    await waClient.logout();
    await destroyWaClient();
    killOrphanedSessionBrowsers();
    qrCodeData = null;
    status     = "idle";
    statusMsg  = "تم قطع الاتصال";
    res.json({ success: true, message: "تم قطع الاتصال بنجاح" });
  } catch (err) {
    await destroyWaClient();
    killOrphanedSessionBrowsers();
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  // Route Handlers
  getStatus,
  getQR,
  sendMessage,
  connect,
  logout,
  // الدالة العامة للاستخدام من Controllers أخرى
  sendWhatsApp,
  sendWhatsAppDocument,
};
