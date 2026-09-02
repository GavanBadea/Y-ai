// ============================================================
//  server.js  —  نقطة الدخول الرئيسية
//  نظام إدارة المستودعات — Node.js / Express / SQLite
// ============================================================
const path    = require("path");
const fs      = require("fs");
const crypto  = require("crypto");

const ENV_PATH = path.join(__dirname, ".env");
require("dotenv").config({ path: ENV_PATH });

function ensureJwtSecret() {
  const current = String(process.env.JWT_SECRET || "").trim();
  if (current) return current;

  const secret = crypto.randomBytes(32).toString("hex");
  process.env.JWT_SECRET = secret;

  try {
    let content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
    if (/^JWT_SECRET\s*=/m.test(content)) {
      content = content.replace(/^JWT_SECRET\s*=.*$/m, `JWT_SECRET=${secret}`);
    } else {
      content = (content.trimEnd() ? content.trimEnd() + "\r\n" : "") + `JWT_SECRET=${secret}\r\n`;
    }
    fs.writeFileSync(ENV_PATH, content, "utf8");
    console.log("✅ تم إنشاء JWT_SECRET تلقائياً في app\\.env");
  } catch (e) {
    console.warn("⚠️ JWT_SECRET:", e.message);
  }
  return secret;
}

ensureJwtSecret();

const express = require("express");
const cors    = require("cors");
const helmet  = require("helmet");
const morgan  = require("morgan");
const http    = require("http");
const { spawn, exec } = require("child_process");

const app  = express();
const PORT = process.env.PORT || 3000;

// ── منع تعطل الخادم عند الاستثناءات غير المتوقعة ──────────
process.on("uncaughtException", (err) => {
  console.error("❌ uncaughtException:", err.message);
});
process.on("unhandledRejection", (reason) => {
  console.error("❌ unhandledRejection:", reason);
});

const uploadsDir = process.env.UPLOADS_PATH || path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// ── Middlewares العامة ─────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: false,
}));
app.use("/uploads", express.static(uploadsDir));

// ── خدمة واجهة React (الواجهة المبنية) ───────────────────
const distDir   = path.join(__dirname, "wms-frontend", "dist");
const indexHtml = path.join(distDir, "index.html");
const hasFrontendBuild = fs.existsSync(indexHtml);

if (hasFrontendBuild) {
  app.use(express.static(distDir, { index: false }));
}
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// ── رأس Keep-Alive ─────────────────────────────────────────
app.use((_req, res, next) => {
  res.setHeader("Connection", "keep-alive");
  next();
});

// ── وكيل Y-ai (منفذ 3001) — للواجهة بدون Vite ─────────────
const YAI_PORT    = Number(process.env.YAI_PORT || 3001);
const DB_PATH_ABS = path.resolve(process.env.DB_PATH || "./warehouse.db");

app.use("/yai", (req, res) => {
  const targetPath = (req.url || "/").replace(/^\/yai/, "") || "/";
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const headers = { ...req.headers };
    headers.host = `127.0.0.1:${YAI_PORT}`;
    // منع ضغط الاستجابة — يفسد بث SSE ويُظهر الدردشة معلّقة بلا رد
    delete headers["accept-encoding"];
    delete headers["Accept-Encoding"];
    delete headers["content-length"];
    delete headers["Content-Length"];
    if (body.length) headers["content-length"] = String(body.length);

    const proxyReq = http.request(
      {
        hostname: "127.0.0.1",
        port    : YAI_PORT,
        path    : targetPath.startsWith("/") ? targetPath : `/${targetPath}`,
        method  : req.method,
        headers,
        timeout : 180000,
      },
      (proxyRes) => {
        const outHeaders = { ...proxyRes.headers };
        delete outHeaders["content-length"];
        outHeaders["cache-control"] = "no-cache, no-transform";
        outHeaders["x-accel-buffering"] = "no";
        res.writeHead(proxyRes.statusCode || 502, outHeaders);
        proxyRes.pipe(res);
      }
    );
    proxyReq.setTimeout(180000);
    proxyReq.on("timeout", () => {
      proxyReq.destroy();
      if (!res.headersSent) {
        res.status(504).json({ success: false, message: "انتهت مهلة Y-ai" });
      } else {
        try { res.end(); } catch { /* ignore */ }
      }
    });
    proxyReq.on("error", () => {
      if (!res.headersSent) {
        res.status(502).json({
          success: false,
          message: "Y-ai غير متاح — أعد تشغيل الخادم أو نفّذ: python Y-ai.py",
        });
      }
    });
    if (body.length) proxyReq.write(body);
    proxyReq.end();
  });
});

// ── مسار الترخيص (يعمل دائماً بدون فحص الترخيص) ──────────
app.use("/api/license", require("./routes/license.routes"));

// ── middleware فحص الترخيص لبقية الـ API ─────────────────
const licenseModule = require("./license");
app.use("/api", (req, res, next) => {
  // السماح دائماً لمسارات الترخيص والصحة والأول-تشغيل
  const freePaths = [
    "/health",
    "/license",
    "/system/shutdown",
    "/users/check-first-run",
    "/users/login",
    "/users/setup-admin",
    "/users/admin-hint",
  ];
  const isFree = freePaths.some((p) => req.path === p || req.path.startsWith(p));
  if (isFree) return next();

  // التطوير المحلي (start-wms.bat / npm run dev) — بدون تفعيل
  const isDevMode =
    process.env.NODE_ENV === "development" ||
    process.env.SKIP_LICENSE === "1";
  if (isDevMode) return next();

  if (!licenseModule.isActivated()) {
    return res.status(402).json({
      success        : false,
      licenseRequired: true,
      hash           : licenseModule.getMachineHash(),
      message        : "البرنامج يحتاج إلى تفعيل — تواصل مع المبرمج",
    });
  }
  next();
});

// ── جميع المسارات ─────────────────────────────────────────
const routes = {

  // ── المصادقة والمستخدمون ─────────────────────────────────
  "/api/users"            : require("./routes/users.routes"),
  "/api/roles"            : require("./routes/userRoles.routes"),

  // ── البيانات المرجعية ────────────────────────────────────
  "/api/common"           : require("./routes/commonData.routes"),

  // ── الأطراف التجارية ─────────────────────────────────────
  "/api/party"            : require("./routes/party.routes"),

  // ── المواد ───────────────────────────────────────────────
  "/api/materials"        : require("./routes/materials.routes"),

  // ── فواتير الشراء ────────────────────────────────────────
  "/api/invoices-in"      : require("./routes/fin.routes"),

  // ── فواتير المبيعات ───────────────────────────────────────
  "/api/invoices-out"     : require("./routes/fout.routes"),

  // ── نقطة البيع السريعة (POS) ─────────────────────────────
  "/api/pos"              : require("./routes/pos.routes"),

  // ── فواتير الإرجاع ───────────────────────────────────────
  "/api/returns"          : require("./routes/fRetern.routes"),

  // ── ديون الموردين / الزبائن ──────────────────────────────
  "/api/dion-amil"        : require("./routes/dionAmil.routes"),
  "/api/dion-zabon"       : require("./routes/dionZabon.routes"),

  // ── سندات الدفع والقبض ───────────────────────────────────
  "/api/pay-doc"          : require("./routes/payDoc.routes"),
  "/api/catch-doc"        : require("./routes/catchDoc.routes"),

  // ── المصاريف ─────────────────────────────────────────────
  "/api/spending"         : require("./routes/spending.routes"),
  "/api/spending-details" : require("./routes/spendingDetails.routes"),

  // ── رأس المال ─────────────────────────────────────────────
  "/api/capital"          : require("./routes/projectCapital.routes"),

  // ── المواد منتهية الصلاحية ────────────────────────────────
  "/api/expired-stock"    : require("./routes/expiredStock.routes"),

  // ── المخزون ──────────────────────────────────────────────
  "/api/stock"            : require("./routes/stock.routes"),
  "/api/inventory"        : require("./routes/inventory.routes"),
  "/api/warehouses"       : require("./routes/warehouse.routes"),
  "/api/stock-transfers"  : require("./routes/stockTransfer.routes"),

  // ── الأسعار التاريخية ────────────────────────────────────
  "/api/sell-prices"      : require("./routes/sellPrice.routes"),
  "/api/price-history"    : require("./routes/priceHistory.routes"),

  // ── معلومات الشركة ───────────────────────────────────────
  "/api/company"          : require("./routes/company.routes"),

  // ── سجل التدقيق ──────────────────────────────────────────
  "/api/audit"            : require("./routes/auditLog.routes"),

  // ── سندات القبض والدفع + محرك الطباعة ────────────────────
  "/api/documents"        : require("./routes/documents.routes"),

  // ── واتساب ───────────────────────────────────────────────
  "/api/whatsapp"         : require("./routes/whatsapp.routes"),

  // ── محرك التقارير ────────────────────────────────────────
  "/api/reports"          : require("./routes/reports.routes"),

  // ── تعديل إداري محمي ─────────────────────────────────────
  "/api/admin/edit"       : require("./routes/adminEdit.routes"),

  // ── التصفير ──────────────────────────────────────────────
  "/api/fiscal"           : require("./routes/fiscalYear.routes"),
  "/api/fiscal-switch"    : require("./routes/fiscalSwitch.routes"),

  // ── كشوفات الحسابات ──────────────────────────────────────
  "/api/statements"       : require("./routes/accountStatement.routes"),

  // ── حزمة المحاسب الضريبية ─────────────────────────────────
  "/api/tax-package"      : require("./routes/taxPackage.routes"),

  // ── المحاسبة ─────────────────────────────────────────────
  "/api/accounting"       : require("./routes/accounting.routes"),

  // ── التقارير التفصيلية ────────────────────────────────────
  "/api/advanced-reports" : require("./routes/advancedReports.routes"),

  // ── إيقاف البرنامج (إغلاق المتصفح) ───────────────────────
  "/api/system"           : require("./routes/system.routes"),
};

// ── تسجيل جميع المسارات ───────────────────────────────────
Object.entries(routes).forEach(([p, router]) => app.use(p, router));

// ── صفحة الصحة ────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({
    success  : true,
    message  : "✅ الخادم يعمل",
    timestamp: new Date().toISOString(),
    endpoints: Object.keys(routes).length,
    version  : "2.5.3",
  });
});

// ── دليل الـ API ───────────────────────────────────────────
app.get("/api", (_req, res) => {
  res.json({
    success: true,
    version: "2.5.3",
    routes : Object.keys(routes),
  });
});

// ── SPA Fallback — أي مسار واجهة (/, /login, /activate …) ─
app.use((req, res) => {
  if (
    hasFrontendBuild &&
    req.method === "GET" &&
    !req.path.startsWith("/api") &&
    !req.path.startsWith("/yai") &&
    !req.path.startsWith("/uploads")
  ) {
    return res.sendFile(path.resolve(indexHtml));
  }
  res.status(404).json({ success: false, message: "المسار غير موجود" });
});

// ── Global Error Handler ───────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error("❌", err.message);
  res.status(500).json({
    success : false,
    message : "خطأ داخلي في الخادم",
    ...(process.env.NODE_ENV === "development" && { detail: err.message }),
  });
});

// ── تشغيل الخادم ──────────────────────────────────────────
let yaiChild = null;
let server;

function resolvePythonExecutable() {
  if (process.env.PYTHON_EXE && fs.existsSync(process.env.PYTHON_EXE)) {
    return process.env.PYTHON_EXE;
  }
  const bundled = path.join(__dirname, "..", "runtime", "python", "python.exe");
  if (fs.existsSync(bundled)) return bundled;
  const bundledUnix = path.join(__dirname, "..", "runtime", "python", "python");
  if (fs.existsSync(bundledUnix)) return bundledUnix;
  return process.platform === "win32" ? "python" : "python3";
}

function killProcessTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    exec(`taskkill /F /PID ${pid} /T`, () => {});
  } else {
    try { process.kill(-pid, "SIGTERM"); } catch {
      try { process.kill(pid, "SIGTERM"); } catch { /* ignore */ }
    }
  }
}

function killListenersOnPort(port) {
  if (process.platform !== "win32") return;
  exec(
    `for /f "tokens=5" %a in ('netstat -aon ^| findstr ":${port} " ^| findstr "LISTENING"') do taskkill /F /PID %a /T`,
    () => {}
  );
}

let ensureYaiRunningRef = null;

async function stopYaiForDatabaseRestore() {
  try {
    if (yaiChild?.pid) killProcessTree(yaiChild.pid);
  } catch { /* ignore */ }
  yaiChild = null;
  killListenersOnPort(YAI_PORT);
  await new Promise((r) => setTimeout(r, 1500));
}

async function restartYaiAfterDatabaseRestore() {
  if (typeof ensureYaiRunningRef === "function") {
    try { await ensureYaiRunningRef("restore"); } catch { /* ignore */ }
  }
}

function allowFirewallPort(port) {
  if (process.platform !== "win32") return;
  const ruleName = `Y-ai WMS TCP ${port}`;
  exec(`netsh advfirewall firewall show rule name="${ruleName}"`, (err, stdout) => {
    if (!err && stdout && stdout.includes(ruleName)) return;
    exec(
      `netsh advfirewall firewall add rule name="${ruleName}" dir=in action=allow protocol=TCP localport=${port} profile=private,domain`,
      (addErr) => {
        if (addErr) {
          console.warn(`⚠️ جدار الحماية: شغّل allow-network.bat كمسؤول لفتح المنفذ ${port}`);
        }
      }
    );
  });
}

function writeNetworkAccessFile(ips, port) {
  if (!ips.length) return;
  try {
    const dbPath = path.resolve(process.env.DB_PATH || path.join(__dirname, "warehouse.db"));
    const installRoot = path.dirname(path.dirname(dbPath));
    const outPath = path.join(installRoot, "network-access.txt");
    const lines = [
      "Y-ai WMS — الوصول من أجهزة الشبكة",
      "================================",
      "",
      "من جهاز آخر على نفس الواي فاي، افتح:",
      ...ips.map((ip) => `  http://${ip}:${port}`),
      "",
      "إذا لم يفتح: شغّل allow-network.bat كمسؤول من مجلد التثبيت.",
    ].join("\r\n");
    fs.writeFileSync(outPath, lines, "utf8");
  } catch { /* ignore */ }
}

function shutdownWms(reason = "manual") {
  console.log(`\n🛑 إيقاف Y-ai WMS (${reason})...\n`);

  (async () => {
    try {
      const dbMod = require("./db");
      await dbMod.checkpointDatabase();
      await dbMod.closeDB();
    } catch { /* ignore */ }
  })();

  if (yaiChild?.pid) killProcessTree(yaiChild.pid);
  if (process.platform === "win32") {
    exec(
      `for /f "tokens=5" %a in ('netstat -aon ^| findstr ":${YAI_PORT} " ^| findstr "LISTENING"') do taskkill /F /PID %a /T`,
      () => {}
    );
  }
  if (server) {
    server.close(() => process.exit(0));
  }
  setTimeout(() => process.exit(0), 1200).unref();
}

app.set("shutdownWms", shutdownWms);
app.set("stopYaiForDatabaseRestore", stopYaiForDatabaseRestore);
app.set("restartYaiAfterDatabaseRestore", restartYaiAfterDatabaseRestore);

server = app.listen(PORT, "0.0.0.0", () => {
  // تأخير المهام الثقيلة حتى يكتمل تسجيل الدخول / check-first-run
  const { ensureWACRecalc } = require("./utils/recalcMaterialWAC");
  setTimeout(() => {
    ensureWACRecalc()
      .then(() => console.log("✅ تمت مزامنة أسعار التكلفة (WAC)"))
      .catch(() => {});
  }, 45000);

  const ips   = licenseModule.getLocalIPs();
  const activated = licenseModule.isActivated();

  console.log("\n╔══════════════════════════════════════════════╗");
  console.log(`║  🚀  الخادم يعمل على المنفذ : ${PORT}             ║`);
  console.log(`║  🌐  http://localhost:${PORT}                   ║`);
  ips.forEach((ip) => {
    console.log(`║  📡  http://${ip}:${PORT}`.padEnd(48) + "║");
  });
  console.log(`║  📦  Y-ai للمستودعات  v2.5.3                 ║`);
  console.log(`║  🔐  الترخيص: ${activated ? "✅ مُفعَّل" : "❌ غير مُفعَّل — انتظار التفعيل"}`.padEnd(48) + "║");
  console.log("╚══════════════════════════════════════════════╝\n");

  // السماح بالاتصال من الأجهزة الأخرى على الشبكة (Windows Firewall)
  allowFirewallPort(PORT);
  allowFirewallPort(YAI_PORT);
  writeNetworkAccessFile(ips, PORT);

  // ── تشغيل Y-ai تلقائياً إن لم يكن يعمل ───────────────
  const yaiScript = path.join(__dirname, "Y-ai.py");
  const yaiLogPath = path.join(
    path.dirname(path.resolve(process.env.DB_PATH || path.join(__dirname, "warehouse.db"))),
    "yai.log"
  );

  const pingYai = () =>
    new Promise((resolve) => {
      const req = http.get(`http://127.0.0.1:${YAI_PORT}/health`, (r) => {
        r.resume();
        resolve(r.statusCode === 200);
      });
      req.on("error", () => resolve(false));
      req.setTimeout(2500, () => { req.destroy(); resolve(false); });
    });

  function buildYaiEnv() {
    const clean = (v, fallback = "") => String(v ?? fallback).trim().replace(/^['"]|['"]$/g, "");
    const keepAliveRaw = clean(process.env.OLLAMA_KEEP_ALIVE, "30m");
    const keepAliveMatch = keepAliveRaw.match(/^(\d+)\s*([smhSMH])\s*$/);
    // Ollama يرفض "3m " (مسافة بعد الوحدة)
    const keepAlive = keepAliveMatch
      ? `${keepAliveMatch[1]}${keepAliveMatch[2].toLowerCase()}`
      : "30m";
    const ollamaUrl = clean(process.env.OLLAMA_URL, "http://127.0.0.1:11434")
      .replace("localhost", "127.0.0.1");
    return {
      ...process.env,
      WMS_DB_PATH        : DB_PATH_ABS,
      YAI_PORT           : String(YAI_PORT),
      OLLAMA_URL         : ollamaUrl,
      OLLAMA_MODEL       : clean(process.env.OLLAMA_MODEL, "qwen2:1.5b"),
      OLLAMA_KEEP_ALIVE  : keepAlive,
      OLLAMA_NUM_PREDICT : clean(process.env.OLLAMA_NUM_PREDICT, "160"),
      OLLAMA_NUM_CTX     : clean(process.env.OLLAMA_NUM_CTX, "1024"),
      OLLAMA_TEMPERATURE : clean(process.env.OLLAMA_TEMPERATURE, "0.35"),
      OLLAMA_CHAT_TIMEOUT: clean(process.env.OLLAMA_CHAT_TIMEOUT, "90"),
      PYTHONUTF8         : "1",
      PYTHONIOENCODING   : "utf-8",
    };
  }

  function startYaiProcess() {
    if (!fs.existsSync(yaiScript)) {
      console.warn("⚠️ ملف Y-ai.py غير موجود");
      return false;
    }
    const py = resolvePythonExecutable();
    if (!py || (py.includes("python") && py.includes("runtime") && !fs.existsSync(py))) {
      console.warn("⚠️ Python غير موجود — لا يمكن تشغيل Y-ai");
      return false;
    }

    try {
      if (yaiChild?.pid) {
        try { killProcessTree(yaiChild.pid); } catch { /* ignore */ }
        yaiChild = null;
      }

      let logFd;
      try {
        logFd = fs.openSync(yaiLogPath, "a");
        fs.writeSync(logFd, `\n---- Y-ai start ${new Date().toISOString()} | ${py} ----\n`);
      } catch {
        logFd = "ignore";
      }

      const stdio = logFd === "ignore"
        ? ["ignore", "ignore", "ignore"]
        : ["ignore", logFd, logFd];

      console.log(`🤖 تشغيل Y-ai (${py} Y-ai.py)...`);
      const child = spawn(py, [yaiScript], {
        cwd        : __dirname,
        env        : buildYaiEnv(),
        stdio,
        detached   : true,
        windowsHide: true,
      });
      child.on("error", (err) => {
        console.warn("⚠️ فشل تشغيل Y-ai:", err.message);
        yaiChild = null;
      });
      child.unref();
      yaiChild = child;
      return true;
    } catch (e) {
      console.warn("⚠️ فشل تشغيل Y-ai:", e.message);
      return false;
    }
  }

  function warmYaiModel() {
    return new Promise((resolve) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port    : YAI_PORT,
          path    : "/warm",
          method  : "POST",
          timeout : 120000,
        },
        (r) => {
          r.resume();
          resolve(r.statusCode === 200);
        }
      );
      req.on("error", () => resolve(false));
      req.setTimeout(120000, () => { req.destroy(); resolve(false); });
      req.end();
    });
  }

  async function ensureYaiRunning(label = "start") {
    // عند الإقلاع: أعد تشغيل Y-ai دائماً حتى تُحمَّل آخر تعديلات Y-ai.py
    if (label === "start") {
      console.log(`🤖 إعادة تشغيل Y-ai على المنفذ ${YAI_PORT}...`);
      try {
        if (yaiChild?.pid) killProcessTree(yaiChild.pid);
      } catch { /* ignore */ }
      yaiChild = null;
      killListenersOnPort(YAI_PORT);
      await new Promise((r) => setTimeout(r, 1200));
      if (!startYaiProcess()) return false;
      for (let i = 0; i < 25; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        if (await pingYai()) {
          console.log(`✅ Y-ai جاهز على http://127.0.0.1:${YAI_PORT}`);
          if (label === "start") {
            warmYaiModel()
              .then((ok) => console.log(ok ? "🔥 Ollama مُسخَّن وجاهز للدردشة" : "⚠️ تعذّر تسخين Ollama — أول سؤال قد يتأخر"))
              .catch(() => {});
          }
          return true;
        }
      }
      console.warn("⚠️ Y-ai لم يستجب (start) — راجع yai.log بجانب قاعدة البيانات");
      return false;
    }

    // إعادة المحاولة الدورية: فقط إن توقّف
    if (await pingYai()) return true;
    if (!startYaiProcess()) return false;

    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (await pingYai()) {
        console.log(`✅ Y-ai جاهز على http://127.0.0.1:${YAI_PORT}`);
        return true;
      }
    }
    console.warn(`⚠️ Y-ai لم يستجب (${label}) — راجع yai.log أو شغّل check-yai.bat`);
    return false;
  }

  ensureYaiRunningRef = ensureYaiRunning;

  // تشغيل فوري + إعادة محاولة دورية (Ollama/Python قد يتأخران على جهاز العميل)
  ensureYaiRunning("start").catch(() => {});
  setInterval(() => {
    ensureYaiRunning("retry").catch(() => {});
  }, 20000);

  // ── شطب تلقائي للمواد منتهية الصلاحية عند البدء ──────
  setTimeout(async () => {
    try {
      const { autoProcessOnStartup } = require("./controllers/expiredStock.controller");
      await autoProcessOnStartup();
    } catch (e) { console.error("⚠️ الشطب التلقائي:", e.message); }
  }, 30000);

  // ── نسخة احتياطية يومية إلى Google Drive ─────────────
  try {
    const fiscalBackup = require("./controllers/fiscalYear.controller");
    const { startDailyBackupScheduler } = require("./utils/dailyBackup");
    startDailyBackupScheduler((label) => fiscalBackup.createBackup(label));
  } catch (e) { console.warn("⚠️ جدولة النسخ اليومي:", e.message); }
});

// ── إعدادات Keep-Alive لمنع انقطاع الاتصال ───────────────
server.keepAliveTimeout = 65000;   // 65 ثانية
server.headersTimeout   = 66000;   // أكثر من keepAliveTimeout بثانية

module.exports = app;
