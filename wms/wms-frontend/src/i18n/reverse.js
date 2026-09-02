import ar from "./locales/ar";

const LOCALES = { ar };

/** @type {Map<string, string>} */
let reverseMap = null;

function walk(obj, prefix = "") {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") {
      const t = v.trim();
      if (t.length >= 2) reverseMap.set(t, path);
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      walk(v, path);
    }
  }
}

export function resetReverseMap() {
  reverseMap = null;
}

function ensureReverse() {
  if (reverseMap) return reverseMap;
  reverseMap = new Map();
  walk(ar);
  return reverseMap;
}

export function translateText(_lang, text) {
  return text == null ? "" : String(text);
}

export { ensureReverse, LOCALES };
