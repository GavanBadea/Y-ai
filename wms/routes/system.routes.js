// routes/system.routes.js — إيقاف الخادم + معلومات النظام
const express = require("express");
const os      = require("os");
const fs      = require("fs");
const path    = require("path");
const router  = express.Router();

const LOCAL_VERSION_FILE = path.join(__dirname, "..", "version.json");
const DEFAULT_UPDATE_MANIFEST_URL =
  "https://raw.githubusercontent.com/GavanBadea/Y-ai/main/version.json";

function readLocalVersionManifest() {
  const fallback = {
    version: "2.5.3",
    releaseDate: "",
    notes: [],
    installerUrl: "",
    mandatory: false,
  };

  try {
    if (!fs.existsSync(LOCAL_VERSION_FILE)) return fallback;
    const parsed = JSON.parse(fs.readFileSync(LOCAL_VERSION_FILE, "utf8"));
    return {
      version: String(parsed?.version || fallback.version),
      releaseDate: String(parsed?.releaseDate || ""),
      notes: Array.isArray(parsed?.notes) ? parsed.notes.map((n) => String(n)) : [],
      installerUrl: String(parsed?.installerUrl || ""),
      mandatory: !!parsed?.mandatory,
    };
  } catch {
    return fallback;
  }
}

function isLocalRequest(req) {
  const raw = req.socket?.remoteAddress || req.ip || "";
  const ip = raw.replace(/^::ffff:/, "");
  if (ip === "127.0.0.1" || ip === "::1") return true;

  const local = new Set(["127.0.0.1"]);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const item of list || []) {
      if (item.family === "IPv4" && !item.internal) local.add(item.address);
    }
  }
  return local.has(ip);
}

router.post("/shutdown", (req, res) => {
  if (!isLocalRequest(req)) {
    return res.status(403).json({ success: false, message: "مسموح من الجهاز المحلي فقط" });
  }

  res.json({ success: true, message: "جاري إيقاف البرنامج..." });

  const shutdown = req.app.get("shutdownWms");
  if (typeof shutdown === "function") {
    setTimeout(() => shutdown("browser-close"), 80);
  } else {
    setTimeout(() => process.exit(0), 80);
  }
});

router.get("/update-meta", (_req, res) => {
  const current = readLocalVersionManifest();
  const manifestUrl = String(
    process.env.UPDATE_MANIFEST_URL || DEFAULT_UPDATE_MANIFEST_URL
  ).trim();

  res.json({
    success: true,
    data: {
      enabled: !!manifestUrl,
      manifestUrl,
      current,
      currentVersion: current.version,
    },
  });
});

module.exports = router;
