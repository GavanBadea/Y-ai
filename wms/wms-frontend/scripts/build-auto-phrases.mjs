/**
 * يولّد autoPhrases.js من extracted-ar.json مع ترجمة EN/TR عبر MyMemory.
 * تشغيل: node scripts/build-auto-phrases.mjs
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const extractedPath = path.join(root, "src/i18n/extracted-ar.json");
const outPath = path.join(root, "src/i18n/locales/autoPhrases.js");

function walkStrings(obj, set) {
  for (const v of Object.values(obj)) {
    if (typeof v === "string") {
      const t = v.trim();
      if (t.length >= 2) set.add(t);
    } else if (v && typeof v === "object") walkStrings(v, set);
  }
}

function keyFor(text) {
  return "a" + crypto.createHash("md5").update(text).digest("hex").slice(0, 10);
}

async function translateOne(text, langpair) {
  const url =
    "https://api.mymemory.translated.net/get?q=" +
    encodeURIComponent(text.slice(0, 450)) +
    "&langpair=" +
    langpair;
  const res = await fetch(url);
  if (!res.ok) return text;
  const j = await res.json();
  const out = j?.responseData?.translatedText;
  if (!out || out === text) return text;
  if (j.responseStatus === 429) throw new Error("RATE_LIMIT");
  return out;
}

async function translate(text) {
  await new Promise((r) => setTimeout(r, 120));
  try {
    const en = await translateOne(text, "ar|en");
    await new Promise((r) => setTimeout(r, 120));
    const tr = await translateOne(text, "ar|tr");
    return { en, tr };
  } catch (e) {
    if (e.message === "RATE_LIMIT") {
      console.warn("rate limit, pausing 8s...");
      await new Promise((r) => setTimeout(r, 8000));
      return translate(text);
    }
    return { en: text, tr: text };
  }
}

const existing = new Set();
for (const f of ["ar.js", "en.js", "tr.js", "uiPack.js"]) {
  const t = fs.readFileSync(path.join(root, "src/i18n/locales", f), "utf8");
  for (const m of t.matchAll(/"([^"\\]*[\u0600-\u06FF][^"\\]*)"/g)) {
    const s = m[1].trim();
    if (s.length >= 2) existing.add(s);
  }
}
function isCleanUiPhrase(s) {
  if (s.length < 2 || s.length > 80) return false;
  if (/["'`\\]/.test(s)) return false;
  if (/[\${}();]|=>|\?\.|\/\/|\/\*|\*\/|import |export |className|onClick|style=/.test(s)) return false;
  if (/^[\s,."'+\-:]+$/.test(s)) return false;
  if (!/[\u0600-\u06FF]/.test(s)) return false;
  const ar = (s.match(/[\u0600-\u06FF]/g) || []).length;
  if (ar / s.length < 0.35) return false;
  if (!/^[\u0600-\u06FF0-9\s\.,\-()%+:#!?*'"،؟\u060C\u061B]+$/u.test(s)) return false;
  return true;
}

const extracted = JSON.parse(fs.readFileSync(extractedPath, "utf8"));
const candidates = extracted.filter((s) => {
  if (existing.has(s)) return false;
  if (!isCleanUiPhrase(s)) return false;
  return true;
});

const MAX = Number(process.env.MAX || 0) || candidates.length;
console.log("candidates", candidates.length, "max", MAX);

let ar = {};
let en = {};
let tr = {};
if (fs.existsSync(outPath)) {
  try {
    const prev = fs.readFileSync(outPath, "utf8");
    const mAr = prev.match(/export const autoPhrasesAr = (\{[\s\S]*?\});/);
    const mEn = prev.match(/export const autoPhrasesEn = (\{[\s\S]*?\});/);
    const mTr = prev.match(/export const autoPhrasesTr = (\{[\s\S]*?\});/);
    if (mAr) ar = JSON.parse(mAr[1]);
    if (mEn) en = JSON.parse(mEn[1]);
    if (mTr) tr = JSON.parse(mTr[1]);
    for (const k of Object.keys(ar)) existing.add(ar[k]);
    console.log("merged existing", Object.keys(ar).length);
  } catch (_) {}
}

let i = 0;
for (const text of candidates.slice(0, MAX)) {
  const k = keyFor(text);
  if (ar[k]) continue;
  ar[k] = text;
  const { en: e, tr: t } = await translate(text);
  en[k] = e;
  tr[k] = t;
  i++;
  if (i % 25 === 0) console.log(i, "/", candidates.length, text.slice(0, 40));
}

const body = `/** مُولَّد تلقائياً — لا تعدّل يدوياً. أعد التشغيل: node scripts/build-auto-phrases.mjs */
export const autoPhrasesAr = ${JSON.stringify(ar, null, 2)};
export const autoPhrasesEn = ${JSON.stringify(en, null, 2)};
export const autoPhrasesTr = ${JSON.stringify(tr, null, 2)};
`;

fs.writeFileSync(outPath, body, "utf8");
console.log("written", outPath, "entries", Object.keys(ar).length);
