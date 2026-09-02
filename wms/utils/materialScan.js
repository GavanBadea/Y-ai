// ============================================================
//  materialScan.js — بحث مادة بالباركود الثابت أو PLU الميزان
// ============================================================
const {
  analyzeBarcodeScan,
  buildScanExtras,
} = require("./barcodeParse");

async function tryBarcodeLookup(db, sql, keys) {
  for (const key of keys) {
    const row = await db.queryOne(sql, [key]);
    if (row) return { row, matchedKey: key };
  }
  return null;
}

/**
 * @param {object} db
 * @param {string} identifier — نص الماسح
 * @param {{ barcodeSql: string, idSql?: string }} queries
 * @returns {{ row, matchedKey, scan } | null}
 */
async function findMaterialByScan(db, identifier, { barcodeSql, idSql }) {
  const analysis = analyzeBarcodeScan(identifier);
  if (!analysis.original) return null;

  let found = await tryBarcodeLookup(db, barcodeSql, analysis.lookupKeys);
  if (found) {
    return {
      ...found,
      scan: buildScanExtras(analysis, found.matchedKey),
    };
  }

  if (analysis.tryNumericId && idSql) {
    const row = await db.queryOne(idSql, [Number(analysis.original)]);
    if (row) {
      return {
        row,
        matchedKey: analysis.original,
        scan: buildScanExtras(analysis, null),
      };
    }
  }

  return null;
}

function attachScanToMaterial(row, scan) {
  if (!row) return row;
  const s = scan || {};
  return {
    ...row,
    scanType: s.scanType || "fixed",
    scannedQty: s.scannedQty ?? null,
    scannedLineTotal: s.scannedLineTotal ?? null,
    scalePlu: s.scalePlu ?? null,
    scanNote: s.scanNote ?? null,
  };
}

module.exports = {
  findMaterialByScan,
  attachScanToMaterial,
  analyzeBarcodeScan,
};
