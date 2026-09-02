// ============================================================
//  adminRecovery.js — استرجاع بيانات المدير الأول (Hint)
//  يُشفّر بكلمة تحقيق المبرمج فقط — لا يُخزَّن بصيغة plain
// ============================================================
"use strict";

const crypto = require("crypto");

const VERIFY_PASSWORD = "Yara2020";
const KEY = crypto.scryptSync(VERIFY_PASSWORD, "yai-wms-recovery-v1", 32);

function encryptPlain(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([cipher.update(String(text), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    payload: enc.toString("base64"),
    iv     : iv.toString("base64"),
    tag    : tag.toString("base64"),
  };
}

function decryptPayload(row) {
  if (!row?.Payload || !row?.Iv || !row?.Tag) return null;
  const iv = Buffer.from(row.Iv, "base64");
  const tag = Buffer.from(row.Tag, "base64");
  const enc = Buffer.from(row.Payload, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

function isVerifyPassword(input) {
  return String(input || "") === VERIFY_PASSWORD;
}

/** حفظ/تحديث كلمة مرور المدير للاسترجاع عبر Hint */
async function saveAdminRecovery(db, userName, plainPassword) {
  const enc = encryptPlain(plainPassword);
  await db.run(
    `INSERT OR REPLACE INTO AdminRecovery_tbl (id, UserName, Payload, Iv, Tag, UpdatedAt)
     VALUES (1, ?, ?, ?, ?, datetime('now'))`,
    [userName, enc.payload, enc.iv, enc.tag]
  );
}

module.exports = {
  encryptPlain,
  decryptPayload,
  isVerifyPassword,
  saveAdminRecovery,
  VERIFY_PASSWORD,
};
