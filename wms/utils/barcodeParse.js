// ============================================================
//  barcodeParse.js — باركود ثابت + باركود ميزان (EAN-13)
//  الصيغة الشائعة في المحلات: 2T PPPPP WWWWW C
//    T=0 وزن بالغرام÷1000=كغ | T=1 سعر إجمالي على الملصق
// ============================================================

const r3 = (n) => Math.round((+n || 0) * 1000) / 1000;

function digitsOnly(raw) {
  return String(raw ?? "").replace(/\D/g, "");
}

function pluLookupVariants(plu) {
  const p = String(plu ?? "");
  const trimmed = p.replace(/^0+/, "") || "0";
  const padded5 = trimmed.padStart(5, "0");
  return [...new Set([p, trimmed, padded5])];
}

/** فك باركود ميزان EAN-13 (13 رقم يبدأ بـ 2) */
function parseScaleEan13(digits) {
  const d = digitsOnly(digits);
  if (d.length !== 13 || d[0] !== "2") return null;

  const typeDigit = d[1];
  const plu = d.substring(2, 7);
  const value = parseInt(d.substring(7, 12), 10);
  if (!Number.isFinite(value)) return null;

  if (typeDigit === "1") {
    return {
      type: "price",
      plu,
      pluVariants: pluLookupVariants(plu),
      totalPrice: value,
      valueDigits: d.substring(7, 12),
      raw: d,
    };
  }

  return {
    type: "weight",
    plu,
    pluVariants: pluLookupVariants(plu),
    weightKg: r3(value / 1000),
    valueDigits: d.substring(7, 12),
    raw: d,
  };
}

/**
 * تحليل إدخال الماسح: مفاتيح البحث + بيانات الميزان إن وُجدت
 */
function analyzeBarcodeScan(raw) {
  const original = String(raw ?? "").trim();
  const digits = digitsOnly(original);

  const lookupKeys = [];
  const addKey = (k) => {
    const s = String(k ?? "").trim();
    if (s && !lookupKeys.includes(s)) lookupKeys.push(s);
  };

  addKey(original);
  if (digits && digits !== original) addKey(digits);

  const scale = parseScaleEan13(digits);
  if (scale) {
    for (const v of scale.pluVariants) addKey(v);
  }

  const tryNumericId = /^\d+$/.test(original) && !scale;

  return { original, digits, lookupKeys, scale, tryNumericId };
}

function matchedViaScalePlu(analysis, matchedKey) {
  if (!analysis?.scale) return false;
  const key = String(matchedKey ?? "");
  return analysis.scale.pluVariants.includes(key) || key === analysis.scale.plu;
}

/** حقول إضافية تُرسل للواجهة بعد إيجاد المادة */
function buildScanExtras(analysis, matchedKey) {
  if (!analysis?.scale || !matchedViaScalePlu(analysis, matchedKey)) {
    return {
      scanType: "fixed",
      scannedQty: null,
      scannedLineTotal: null,
      scalePlu: null,
      scanNote: null,
    };
  }

  if (analysis.scale.type === "weight") {
    const q = analysis.scale.weightKg;
    return {
      scanType: "scale_weight",
      scannedQty: q > 0 ? q : null,
      scannedLineTotal: null,
      scalePlu: analysis.scale.plu,
      scanNote: q > 0 ? `وزن الميزان: ${q} كغ` : null,
    };
  }

  const total = analysis.scale.totalPrice;
  return {
    scanType: "scale_price",
    scannedQty: 1,
    scannedLineTotal: total > 0 ? total : null,
    scalePlu: analysis.scale.plu,
    scanNote: total > 0 ? `سعر الملصق: ${total}` : null,
  };
}

module.exports = {
  r3,
  digitsOnly,
  pluLookupVariants,
  parseScaleEan13,
  analyzeBarcodeScan,
  matchedViaScalePlu,
  buildScanExtras,
};
