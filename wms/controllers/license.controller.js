// ============================================================
//  controllers/license.controller.js
//  واجهة برمجية لنظام الترخيص
// ============================================================
"use strict";

const license = require("../license");

// ── getStatus — حالة الترخيص + الهاش ─────────────────────
const getStatus = (req, res) => {
  const activated = license.isActivated();
  const hash      = license.getMachineHash();
  const ips       = license.getLocalIPs();
  const port      = process.env.PORT || 3000;

  res.json({
    success  : true,
    activated,
    hash,
    networkUrls: ips.map((ip) => `http://${ip}:${port}`),
  });
};

// ── activate — تفعيل الترخيص بمفتاح ──────────────────────
const activateLicense = (req, res) => {
  const { key } = req.body;
  if (!key)
    return res.status(400).json({ success: false, message: "مفتاح التفعيل مطلوب" });

  const hash   = license.getMachineHash();
  const result = license.activate(hash, key);
  if (!result.success)
    return res.status(400).json({ success: false, message: result.message });

  res.json({ success: true, message: "تم تفعيل البرنامج بنجاح" });
};

module.exports = { getStatus, activateLicense };
