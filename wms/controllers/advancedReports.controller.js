// ============================================================
//  controllers/advancedReports.controller.js
//  وحدة التقارير التفصيلية — مستقلة تماماً عن الأقسام الحالية
//
//  نقاط الدخول:
//   GET /api/advanced-reports/lists/customers
//   GET /api/advanced-reports/lists/suppliers
//   GET /api/advanced-reports/lists/materials
//   GET /api/advanced-reports/statement/customer?id_Zabon=&from=&to=
//   GET /api/advanced-reports/statement/supplier?id_Amil=&from=&to=
//   GET /api/advanced-reports/activity/customer?id_Zabon=&from=&to=
//   GET /api/advanced-reports/activity/supplier?id_Amil=&from=&to=
//   GET /api/advanced-reports/tracking?id_Material=&from=&to=
// ============================================================
const db = require("../db");
const {
  PURCHASE_LC_SUM_SQL,
  PURCHASE_INV_LINES_SUBQUERY,
} = require("../utils/purchaseLineCost");
const { DEFERRED_PAY_SQL, SALE_INVOICE_AMT, PURCHASE_INVOICE_AMT } = require("../utils/statementPayType");
const { expandCashStatementRows } = require("../utils/statementCashRows");

const r2  = (n) => Math.round((+n || 0) * 100) / 100;
const r0  = (n) => Math.round(+n || 0);

function resolveDates(from, to) {
  return {
    dateFrom : from || "2000-01-01",
    dateTo   : to   || new Date().toISOString().split("T")[0],
  };
}

// ══════════════════════════════════════════════════════════
//  قوائم الاختيار (Dropdowns)
// ══════════════════════════════════════════════════════════

const getCustomersList = async (_req, res) => {
  try {
    const rows = await db.query(
      `SELECT id_Zabon AS id, ZabonName AS name, Mobail AS mobile
       FROM Zabon_tbl ORDER BY ZabonName`, []
    );
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const getSuppliersList = async (_req, res) => {
  try {
    const rows = await db.query(
      `SELECT id_Amil AS id, AmilName AS name, Mobil AS mobile
       FROM Amil_tbl ORDER BY AmilName`, []
    );
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const getMaterialsList = async (_req, res) => {
  try {
    const rows = await db.query(
      `SELECT m.id_Material_NoM AS id, m.MaterialName AS name,
              m.Band AS unit, m.Barcode AS barcode,
              m.id_Catiguary, m.id_Type,
              c.CatiguaryName, t.TypeName,
              COALESCE(s.QuantityOnHand, 0) AS stock
       FROM Materials_tbl m
       LEFT JOIN Catiguary_tbl c ON c.id_Catiguary = m.id_Catiguary
       LEFT JOIN Type_tbl t ON t.id_Type = m.id_Type
       LEFT JOIN Stock_tbl s ON s.id_Material_NoM = m.id_Material_NoM
       ORDER BY m.MaterialName`, []
    );
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ══════════════════════════════════════════════════════════
//  ① كشف حساب الزبون — مع رصيد افتتاحي
//
//  الرصيد الافتتاحي = صافي حركات قبل dateFrom
//   مدين : فواتير بيع + ديون سابقة
//   دائن : مرتجعات + سندات قبض
//  الرصيد التراكمي يبدأ من الرصيد الافتتاحي
// ══════════════════════════════════════════════════════════
async function _customerOpening(id_Zabon, dateFrom) {
  const row = await db.queryOne(`
    SELECT (
      COALESCE((
        SELECT SUM(CASE WHEN ${DEFERRED_PAY_SQL} THEN ${SALE_INVOICE_AMT} ELSE 0 END)
        FROM FOUT_tbl f
        LEFT JOIN PayType_Tbl pt ON pt.id_PayType = f.id_PayType_FOUT
        WHERE f.id_Zabon=? AND f.Date_FOUT < ?
      ),0)
      + COALESCE((
        SELECT SUM(dz.Amount_DionZabon) FROM DionZabon_tbl dz
        WHERE dz.id_Zabon=? AND dz.Date_DionZabon < ?
          AND dz.Note_DionZabon NOT LIKE 'فاتورة مبيعات رقم%'
          AND dz.Note_DionZabon NOT LIKE 'تسوية سند قبض رقم%'
      ),0)
      - COALESCE((
        SELECT SUM(
          COALESCE((SELECT SUM(d.AmountOUT*d.PriceOUT) FROM DetailsRetern_tbl d WHERE d.id_NoFRetern=r.id_NoFRetern),0))
        FROM FRetern_tbl r WHERE r.id_Party=? AND r.ReturnType='CUSTOMER' AND r.Date_FRetern < ?
      ),0)
      - COALESCE((
        SELECT SUM(c.Amount_CatchDoc) FROM CatchDoc_tbl c
        WHERE c.id_Zabon=? AND c.Date_CatchDoc < ?
      ),0)
    ) AS ob
  `, [id_Zabon, dateFrom, id_Zabon, dateFrom, id_Zabon, dateFrom, id_Zabon, dateFrom]);
  return r2(row?.ob || 0);
}

const getCustomerStatement = async (req, res) => {
  const { id_Zabon, from, to } = req.query;
  if (!id_Zabon)
    return res.status(400).json({ success: false, message: "id_Zabon مطلوب" });

  const { dateFrom, dateTo } = resolveDates(from, to);

  try {
    const party = await db.queryOne(
      `SELECT ZabonName AS name, Mobail AS mobile FROM Zabon_tbl WHERE id_Zabon=?`,
      [id_Zabon]
    );
    if (!party) return res.status(404).json({ success: false, message: "الزبون غير موجود" });

    const openingBalance = await _customerOpening(id_Zabon, dateFrom);

    const rows = await db.query(`
      SELECT f.Date_FOUT AS txDate, 'فاتورة بيع' AS txType,
             pt.PayTypeName AS txSubType, f.id_NoFOUT AS txRef,
             COALESCE(f.Note_FOUT,'') AS txNote,
             CASE WHEN ${DEFERRED_PAY_SQL} THEN ${SALE_INVOICE_AMT} ELSE 0 END AS debit,
             0 AS credit,
             CASE WHEN NOT ${DEFERRED_PAY_SQL} THEN ${SALE_INVOICE_AMT} ELSE 0 END AS displayDebit,
             CASE WHEN NOT ${DEFERRED_PAY_SQL} THEN ${SALE_INVOICE_AMT} ELSE 0 END AS displayCredit
      FROM FOUT_tbl f LEFT JOIN PayType_Tbl pt ON pt.id_PayType=f.id_PayType_FOUT
      WHERE f.id_Zabon=? AND f.Date_FOUT BETWEEN ? AND ?

      UNION ALL

      SELECT r.Date_FRetern, 'مرتجع مبيعات', '', r.id_NoFRetern, '',
             0,
             ROUND(COALESCE((SELECT SUM(d.AmountOUT*d.PriceOUT) FROM DetailsRetern_tbl d WHERE d.id_NoFRetern=r.id_NoFRetern),0),0),
             0, 0
      FROM FRetern_tbl r
      WHERE r.id_Party=? AND r.ReturnType='CUSTOMER' AND r.Date_FRetern BETWEEN ? AND ?

      UNION ALL

      SELECT dz.Date_DionZabon, 'دين سابق', '', dz.id_DionZabon, COALESCE(dz.Note_DionZabon,''),
             dz.Amount_DionZabon, 0, 0, 0
      FROM DionZabon_tbl dz
      WHERE dz.id_Zabon=? AND dz.Note_DionZabon NOT LIKE 'فاتورة مبيعات رقم%'
        AND dz.Note_DionZabon NOT LIKE 'تسوية سند قبض رقم%'
        AND dz.Date_DionZabon BETWEEN ? AND ?

      UNION ALL

      SELECT c.Date_CatchDoc, 'سند قبض', '', c.id_CatchDoc, COALESCE(c.Note_CatchDoc,''),
             0, c.Amount_CatchDoc, 0, 0
      FROM CatchDoc_tbl c WHERE c.id_Zabon=? AND c.Date_CatchDoc BETWEEN ? AND ?

      ORDER BY txDate ASC, txType ASC, txRef ASC
    `, [
      id_Zabon, dateFrom, dateTo,
      id_Zabon, dateFrom, dateTo,
      id_Zabon, dateFrom, dateTo,
      id_Zabon, dateFrom, dateTo,
    ]);

    const expanded = expandCashStatementRows(rows, "customer");
    let balance = openingBalance;
    const data = expanded.map((r) => {
      balance = r2(balance + r.debit - r.credit);
      return {
        ...r,
        debit: r0(r.debit),
        credit: r0(r.credit),
        displayDebit: r0(r.displayDebit || 0),
        displayCredit: r0(r.displayCredit || 0),
        balance: r2(balance),
      };
    });

    const totalDebit  = r0(data.reduce((s, r) => s + r.debit,  0));
    const totalCredit = r0(data.reduce((s, r) => s + r.credit, 0));

    res.json({
      success: true, party: { ...party, id: id_Zabon },
      dateFrom, dateTo, openingBalance,
      data,
      totals: { totalDebit, totalCredit, finalBalance: r2(openingBalance + totalDebit - totalCredit) },
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ══════════════════════════════════════════════════════════
//  ② كشف حساب المورد — مع رصيد افتتاحي
// ══════════════════════════════════════════════════════════
async function _supplierOpening(id_Amil, dateFrom) {
  const row = await db.queryOne(`
    SELECT (
      COALESCE((
        SELECT SUM(CASE WHEN ${DEFERRED_PAY_SQL} THEN ${PURCHASE_INVOICE_AMT} ELSE 0 END)
        FROM FIN_tbl f
        LEFT JOIN PayType_Tbl pt ON pt.id_PayType = f.id_PayType_FIN
        WHERE f.id_Amil=? AND f.Date_FIN < ?
      ),0)
      + COALESCE((
        SELECT SUM(da.Amount_DionAmil) FROM DionAmil_tbl da
        WHERE da.id_Amil=? AND da.Date_DionAmil < ?
          AND da.Note_DionAmil NOT LIKE 'فاتورة مشتريات رقم%'
          AND da.Note_DionAmil NOT LIKE 'تسوية سند دفع رقم%'
      ),0)
      - COALESCE((
        SELECT SUM(
          COALESCE((SELECT SUM(d.AmountOUT*d.PriceOUT) FROM DetailsRetern_tbl d WHERE d.id_NoFRetern=r.id_NoFRetern),0))
        FROM FRetern_tbl r WHERE r.id_Party=? AND r.ReturnType='SUPPLIER' AND r.Date_FRetern < ?
      ),0)
      - COALESCE((
        SELECT SUM(p.Amount_PayDoc) FROM PayDoc_tbl p
        WHERE p.id_Amil=? AND p.Date_PayDoc < ?
      ),0)
    ) AS ob
  `, [id_Amil, dateFrom, id_Amil, dateFrom, id_Amil, dateFrom, id_Amil, dateFrom]);
  return r2(row?.ob || 0);
}

const getSupplierStatement = async (req, res) => {
  const { id_Amil, from, to } = req.query;
  if (!id_Amil)
    return res.status(400).json({ success: false, message: "id_Amil مطلوب" });

  const { dateFrom, dateTo } = resolveDates(from, to);

  try {
    const party = await db.queryOne(
      `SELECT AmilName AS name, Mobil AS mobile FROM Amil_tbl WHERE id_Amil=?`,
      [id_Amil]
    );
    if (!party) return res.status(404).json({ success: false, message: "المورد غير موجود" });

    const openingBalance = await _supplierOpening(id_Amil, dateFrom);

    const rows = await db.query(`
      SELECT f.Date_FIN AS txDate, 'فاتورة شراء' AS txType,
             pt.PayTypeName AS txSubType, f.id_NoFIN AS txRef, '' AS txNote,
             0 AS debit,
             CASE WHEN ${DEFERRED_PAY_SQL} THEN ${PURCHASE_INVOICE_AMT} ELSE 0 END AS credit,
             CASE WHEN NOT ${DEFERRED_PAY_SQL} THEN ${PURCHASE_INVOICE_AMT} ELSE 0 END AS displayDebit,
             0 AS displayCredit
      FROM FIN_tbl f LEFT JOIN PayType_Tbl pt ON pt.id_PayType=f.id_PayType_FIN
      WHERE f.id_Amil=? AND f.Date_FIN BETWEEN ? AND ?

      UNION ALL

      SELECT r.Date_FRetern, 'مرتجع مشتريات', '', r.id_NoFRetern, '',
             ROUND(COALESCE((SELECT SUM(d.AmountOUT*d.PriceOUT) FROM DetailsRetern_tbl d WHERE d.id_NoFRetern=r.id_NoFRetern),0),0),
             0, 0, 0
      FROM FRetern_tbl r
      WHERE r.id_Party=? AND r.ReturnType='SUPPLIER' AND r.Date_FRetern BETWEEN ? AND ?

      UNION ALL

      SELECT da.Date_DionAmil, 'دين سابق', '', da.id_DionAmil, COALESCE(da.Note_DionAmil,''),
             0, da.Amount_DionAmil, 0, 0
      FROM DionAmil_tbl da
      WHERE da.id_Amil=? AND da.Note_DionAmil NOT LIKE 'فاتورة مشتريات رقم%'
        AND da.Note_DionAmil NOT LIKE 'تسوية سند دفع رقم%'
        AND da.Date_DionAmil BETWEEN ? AND ?

      UNION ALL

      SELECT p.Date_PayDoc, 'سند دفع', '', p.id_PayDoc, COALESCE(p.Note_PayDoc,''),
             p.Amount_PayDoc, 0, 0, 0
      FROM PayDoc_tbl p WHERE p.id_Amil=? AND p.Date_PayDoc BETWEEN ? AND ?

      ORDER BY txDate ASC, txType ASC, txRef ASC
    `, [
      id_Amil, dateFrom, dateTo,
      id_Amil, dateFrom, dateTo,
      id_Amil, dateFrom, dateTo,
      id_Amil, dateFrom, dateTo,
    ]);

    const expanded = expandCashStatementRows(rows, "supplier");
    // للمورد: الرصيد = دائن − مدين (موجب = ندين للمورد)
    let balance = openingBalance;
    const data = expanded.map((r) => {
      balance = r2(balance + r.credit - r.debit);
      return {
        ...r,
        debit: r0(r.debit),
        credit: r0(r.credit),
        displayDebit: r0(r.displayDebit || 0),
        displayCredit: r0(r.displayCredit || 0),
        balance: r2(balance),
      };
    });

    const totalDebit  = r0(data.reduce((s, r) => s + r.debit,  0));
    const totalCredit = r0(data.reduce((s, r) => s + r.credit, 0));

    res.json({
      success: true, party: { ...party, id: id_Amil },
      dateFrom, dateTo, openingBalance,
      data,
      totals: { totalDebit, totalCredit, finalBalance: r2(openingBalance + totalCredit - totalDebit) },
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ══════════════════════════════════════════════════════════
//  ③ تفاصيل حركات الزبون — على مستوى أسطر الفواتير
// ══════════════════════════════════════════════════════════
const getCustomerActivity = async (req, res) => {
  const { id_Zabon, from, to } = req.query;
  if (!id_Zabon)
    return res.status(400).json({ success: false, message: "id_Zabon مطلوب" });

  const { dateFrom, dateTo } = resolveDates(from, to);

  try {
    const party = await db.queryOne(
      `SELECT ZabonName AS name FROM Zabon_tbl WHERE id_Zabon=?`, [id_Zabon]
    );

    const rows = await db.query(`
      SELECT
        f.Date_FOUT                                    AS txDate,
        'بيع'                                          AS txType,
        f.id_NoFOUT                                    AS invoiceNo,
        pt.PayTypeName                                 AS payType,
        m.MaterialName,
        m.Band                                         AS unit,
        d.AmountOUT                                    AS qty,
        COALESCE(d.gift_qty, 0)                        AS giftQty,
        d.PriceOUT                                     AS price,
        0                                              AS lcShare,
        ROUND(CASE WHEN inv.tot > 0
          THEN (d.AmountOUT * d.PriceOUT * 1.0 / inv.tot) * COALESCE(f.Dis_FOUT, 0)
          ELSE 0 END, 0)                               AS discountShare,
        ROUND(d.AmountOUT * d.PriceOUT, 0)             AS lineTotal
      FROM DetailsOUT_tbl d
      JOIN FOUT_tbl f ON f.id_NoFOUT = d.id_NoFOUT
      JOIN Materials_tbl m ON m.id_Material_NoM = d.id_Material_NoM
      LEFT JOIN PayType_Tbl pt ON pt.id_PayType = f.id_PayType_FOUT
      JOIN (
        SELECT id_NoFOUT, SUM(AmountOUT * PriceOUT) AS tot
        FROM DetailsOUT_tbl GROUP BY id_NoFOUT
      ) inv ON inv.id_NoFOUT = f.id_NoFOUT
      WHERE f.id_Zabon = ? AND f.Date_FOUT BETWEEN ? AND ?

      UNION ALL

      SELECT
        r.Date_FRetern,
        'مرتجع بيع',
        r.id_NoFRetern,
        '',
        m.MaterialName,
        m.Band,
        d.AmountOUT                                    AS qty,
        0                                              AS giftQty,
        d.PriceOUT                                     AS price,
        0                                              AS lcShare,
        0                                              AS discountShare,
        ROUND(d.AmountOUT * d.PriceOUT, 0)             AS lineTotal
      FROM DetailsRetern_tbl d
      JOIN FRetern_tbl r ON r.id_NoFRetern = d.id_NoFRetern
      JOIN Materials_tbl m ON m.id_Material_NoM = d.id_Material_NoM
      WHERE r.id_Party = ? AND r.ReturnType = 'CUSTOMER' AND r.Date_FRetern BETWEEN ? AND ?

      ORDER BY txDate ASC, invoiceNo ASC
    `, [
      id_Zabon, dateFrom, dateTo,
      id_Zabon, dateFrom, dateTo,
    ]);

    const totals = {
      totalQty       : r2(rows.reduce((s, r) => s + (r.txType === 'بيع' ? r.qty : -r.qty), 0)),
      totalSales     : r0(rows.filter(r => r.txType === 'بيع').reduce((s, r) => s + r.lineTotal, 0)),
      totalReturns   : r0(rows.filter(r => r.txType !== 'بيع').reduce((s, r) => s + r.lineTotal, 0)),
      netTotal       : r0(
        rows.filter(r => r.txType === 'بيع').reduce((s, r) => s + r.lineTotal, 0) -
        rows.filter(r => r.txType !== 'بيع').reduce((s, r) => s + r.lineTotal, 0)
      ),
      rowCount       : rows.length,
    };

    res.json({ success: true, party: { ...party, id: id_Zabon }, dateFrom, dateTo, data: rows, totals });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ══════════════════════════════════════════════════════════
//  ④ تفاصيل حركات المورد — على مستوى أسطر الفواتير
// ══════════════════════════════════════════════════════════
const getSupplierActivity = async (req, res) => {
  const { id_Amil, from, to } = req.query;
  if (!id_Amil)
    return res.status(400).json({ success: false, message: "id_Amil مطلوب" });

  const { dateFrom, dateTo } = resolveDates(from, to);

  try {
    const party = await db.queryOne(
      `SELECT AmilName AS name FROM Amil_tbl WHERE id_Amil=?`, [id_Amil]
    );

    const rows = await db.query(`
      SELECT
        f.Date_FIN                                     AS txDate,
        'شراء'                                         AS txType,
        f.id_NoFIN                                     AS invoiceNo,
        pt.PayTypeName                                 AS payType,
        m.MaterialName,
        m.Band                                         AS unit,
        d.AmountIN                                     AS qty,
        COALESCE(d.Gift_IN, 0)                         AS giftQty,
        d.PriceIN                                      AS price,
        ROUND(CASE WHEN invLt.linesTotal > 0
          THEN (d.AmountIN * d.PriceIN * 1.0 / invLt.linesTotal) * ${PURCHASE_LC_SUM_SQL}
          ELSE 0 END, 0)                               AS lcShare,
        ROUND(CASE WHEN invLt.linesTotal > 0
          THEN (d.AmountIN * d.PriceIN * 1.0 / invLt.linesTotal) * COALESCE(f.Dis_FIN, 0)
          ELSE 0 END, 0)                               AS discountShare,
        ROUND(d.AmountIN * d.PriceIN, 0)               AS lineTotal
      FROM DetailsIN_tbl d
      JOIN FIN_tbl f ON f.id_NoFIN = d.id_NoFIN
      JOIN Materials_tbl m ON m.id_Material_NoM = d.id_Material_NoM
      LEFT JOIN PayType_Tbl pt ON pt.id_PayType = f.id_PayType_FIN
      JOIN ${PURCHASE_INV_LINES_SUBQUERY}
      WHERE f.id_Amil = ? AND f.Date_FIN BETWEEN ? AND ?

      UNION ALL

      SELECT
        r.Date_FRetern,
        'مرتجع شراء',
        r.id_NoFRetern,
        '',
        m.MaterialName,
        m.Band,
        d.AmountOUT                                    AS qty,
        0                                              AS giftQty,
        d.PriceOUT                                     AS price,
        0                                              AS lcShare,
        0                                              AS discountShare,
        ROUND(d.AmountOUT * d.PriceOUT, 0)             AS lineTotal
      FROM DetailsRetern_tbl d
      JOIN FRetern_tbl r ON r.id_NoFRetern = d.id_NoFRetern
      JOIN Materials_tbl m ON m.id_Material_NoM = d.id_Material_NoM
      WHERE r.id_Party = ? AND r.ReturnType = 'SUPPLIER' AND r.Date_FRetern BETWEEN ? AND ?

      ORDER BY txDate ASC, invoiceNo ASC
    `, [
      id_Amil, dateFrom, dateTo,
      id_Amil, dateFrom, dateTo,
    ]);

    const totals = {
      totalQty     : r2(rows.reduce((s, r) => s + (r.txType === 'شراء' ? r.qty : -r.qty), 0)),
      totalPurch   : r0(rows.filter(r => r.txType === 'شراء').reduce((s, r) => s + r.lineTotal, 0)),
      totalReturns : r0(rows.filter(r => r.txType !== 'شراء').reduce((s, r) => s + r.lineTotal, 0)),
      netTotal     : r0(
        rows.filter(r => r.txType === 'شراء').reduce((s, r) => s + r.lineTotal, 0) -
        rows.filter(r => r.txType !== 'شراء').reduce((s, r) => s + r.lineTotal, 0)
      ),
      rowCount     : rows.length,
    };

    res.json({ success: true, party: { ...party, id: id_Amil }, dateFrom, dateTo, data: rows, totals });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ══════════════════════════════════════════════════════════
//  ⑤ تتبع حركة صنف — مشتريات + مبيعات + مرتجعات
//     مع حساب الكمية التراكمية
//     معيار بحث واحد: id_Material | id_Catiguary | id_Type
// ══════════════════════════════════════════════════════════
function mergeTrackingParts(parts, groupLabel) {
  const ok = parts.filter(Boolean);
  if (!ok.length) return null;

  const data = [];
  let totalPurchased = 0;
  let totalSold = 0;
  let totalGifted = 0;
  let totalValue = 0;
  let totalCost = 0;
  let grandLineTotal = 0;

  ok.forEach((p) => {
    (p.data || []).forEach((row) => {
      data.push({ ...row, MaterialName: p.material?.name || "—" });
    });
    totalPurchased += +(p.totals?.totalPurchased || 0);
    totalSold      += +(p.totals?.totalSold || 0);
    totalGifted    += +(p.totals?.totalGifted || 0);
    totalValue     += +(p.totals?.totalValue || 0);
    totalCost      += +(p.totals?.totalCost || 0);
    grandLineTotal += +(p.totals?.grandLineTotal || 0);
  });

  data.sort((a, b) => {
    const d = String(a.txDate).localeCompare(String(b.txDate));
    return d !== 0 ? d : String(a.txType).localeCompare(String(b.txType));
  });

  return {
    groupMode: true,
    material: { name: groupLabel, unit: "—", currentStock: null },
    openingQty: 0,
    data,
    totals: {
      totalPurchased: r2(totalPurchased),
      totalSold: r2(totalSold),
      totalGifted: r2(totalGifted),
      totalSalesRet: 0,
      totalPurchRet: 0,
      totalValue: r2(totalValue),
      totalCost: r2(totalCost),
      grandLineTotal: r2(grandLineTotal),
    },
  };
}

async function buildMaterialTracking(id_Material, dateFrom, dateTo) {
    const material = await db.queryOne(
      `SELECT m.MaterialName AS name, m.Band AS unit, m.Barcode AS barcode,
              COALESCE(s.QuantityOnHand, 0) AS currentStock
       FROM Materials_tbl m
       LEFT JOIN Stock_tbl s ON s.id_Material_NoM = m.id_Material_NoM
       WHERE m.id_Material_NoM = ?`,
      [id_Material]
    );
    if (!material) return null;

    // الكمية الافتتاحية (قبل الفترة)
    const openRow = await db.queryOne(`
      SELECT (
        COALESCE((
          SELECT SUM(d.AmountIN + COALESCE(d.Gift_IN, 0)) FROM DetailsIN_tbl d
          JOIN FIN_tbl f ON f.id_NoFIN=d.id_NoFIN
          WHERE d.id_Material_NoM=? AND f.Date_FIN < ?
        ),0)
        - COALESCE((
          SELECT SUM(d.AmountOUT + COALESCE(d.gift_qty,0)) FROM DetailsOUT_tbl d
          JOIN FOUT_tbl f ON f.id_NoFOUT=d.id_NoFOUT
          WHERE d.id_Material_NoM=? AND f.Date_FOUT < ?
        ),0)
        + COALESCE((
          SELECT SUM(d.AmountOUT) FROM DetailsRetern_tbl d
          JOIN FRetern_tbl r ON r.id_NoFRetern=d.id_NoFRetern
          WHERE d.id_Material_NoM=? AND r.ReturnType='CUSTOMER' AND r.Date_FRetern < ?
        ),0)
        - COALESCE((
          SELECT SUM(d.AmountOUT) FROM DetailsRetern_tbl d
          JOIN FRetern_tbl r ON r.id_NoFRetern=d.id_NoFRetern
          WHERE d.id_Material_NoM=? AND r.ReturnType='SUPPLIER' AND r.Date_FRetern < ?
        ),0)
      ) AS openQty
    `, [id_Material, dateFrom, id_Material, dateFrom, id_Material, dateFrom, id_Material, dateFrom]);

    const openingQty = r2(openRow?.openQty || 0);

    const rows = await db.query(`
      -- مشتريات (تزيد المخزون)
      SELECT
        f.Date_FIN                                     AS txDate,
        'شراء'                                         AS txType,
        a.AmilName                                     AS party,
        f.id_NoFIN                                     AS txRef,
        pt.PayTypeName                                 AS payType,
        d.AmountIN                                     AS qty,
        COALESCE(d.Gift_IN, 0)                         AS giftQty,
        d.PriceIN                                      AS price,
        ROUND(CASE WHEN invLt.linesTotal > 0
          THEN (d.AmountIN * d.PriceIN * 1.0 / invLt.linesTotal) * ${PURCHASE_LC_SUM_SQL}
          ELSE 0 END, 0)                               AS lcShare,
        ROUND(CASE WHEN invLt.linesTotal > 0
          THEN (d.AmountIN * d.PriceIN * 1.0 / invLt.linesTotal) * COALESCE(f.Dis_FIN, 0)
          ELSE 0 END, 0)                               AS discountShare,
        ROUND(d.AmountIN * d.PriceIN, 0)               AS lineTotal,
        1                                              AS qtySign
      FROM DetailsIN_tbl d
      JOIN FIN_tbl f ON f.id_NoFIN = d.id_NoFIN
      JOIN Amil_tbl a ON a.id_Amil = f.id_Amil
      LEFT JOIN PayType_Tbl pt ON pt.id_PayType = f.id_PayType_FIN
      JOIN ${PURCHASE_INV_LINES_SUBQUERY}
      WHERE d.id_Material_NoM = ? AND f.Date_FIN BETWEEN ? AND ?

      UNION ALL

      -- مبيعات (تقلل المخزون — الكمية + الهدية)
      SELECT
        f.Date_FOUT,
        'بيع',
        z.ZabonName,
        f.id_NoFOUT,
        pt.PayTypeName,
        d.AmountOUT,
        COALESCE(d.gift_qty, 0),
        d.PriceOUT,
        0,
        ROUND(CASE WHEN inv.tot > 0
          THEN (d.AmountOUT * d.PriceOUT * 1.0 / inv.tot) * COALESCE(f.Dis_FOUT, 0)
          ELSE 0 END, 0),
        ROUND(d.AmountOUT * d.PriceOUT, 0),
        -1
      FROM DetailsOUT_tbl d
      JOIN FOUT_tbl f ON f.id_NoFOUT = d.id_NoFOUT
      JOIN Zabon_tbl z ON z.id_Zabon = f.id_Zabon
      LEFT JOIN PayType_Tbl pt ON pt.id_PayType = f.id_PayType_FOUT
      JOIN (
        SELECT id_NoFOUT, SUM(AmountOUT * PriceOUT) AS tot
        FROM DetailsOUT_tbl GROUP BY id_NoFOUT
      ) inv ON inv.id_NoFOUT = f.id_NoFOUT
      WHERE d.id_Material_NoM = ? AND f.Date_FOUT BETWEEN ? AND ?

      UNION ALL

      -- مرتجع مبيعات (تزيد المخزون)
      SELECT
        r.Date_FRetern,
        'مرتجع مبيعات',
        COALESCE(z.ZabonName,''),
        r.id_NoFRetern,
        '',
        d.AmountOUT,
        0,
        d.PriceOUT,
        0,
        0,
        ROUND(d.AmountOUT * d.PriceOUT, 0),
        1
      FROM DetailsRetern_tbl d
      JOIN FRetern_tbl r ON r.id_NoFRetern = d.id_NoFRetern
      LEFT JOIN Zabon_tbl z ON z.id_Zabon = r.id_Party AND r.ReturnType = 'CUSTOMER'
      WHERE d.id_Material_NoM = ? AND r.ReturnType = 'CUSTOMER' AND r.Date_FRetern BETWEEN ? AND ?

      UNION ALL

      -- مرتجع مشتريات (تقلل المخزون)
      SELECT
        r.Date_FRetern,
        'مرتجع مشتريات',
        COALESCE(a.AmilName,''),
        r.id_NoFRetern,
        '',
        d.AmountOUT,
        0,
        d.PriceOUT,
        0,
        0,
        ROUND(d.AmountOUT * d.PriceOUT, 0),
        -1
      FROM DetailsRetern_tbl d
      JOIN FRetern_tbl r ON r.id_NoFRetern = d.id_NoFRetern
      LEFT JOIN Amil_tbl a ON a.id_Amil = r.id_Party AND r.ReturnType = 'SUPPLIER'
      WHERE d.id_Material_NoM = ? AND r.ReturnType = 'SUPPLIER' AND r.Date_FRetern BETWEEN ? AND ?

      UNION ALL

      -- نقل مخزني (لا يغيّر المخزون الإجمالي)
      SELECT
        t.Date_Transfer,
        'نقل مخزني',
        COALESCE(wf.WarehouseName, '') || ' → ' || COALESCE(wt.WarehouseName, ''),
        t.id_Transfer,
        '',
        stl.Quantity,
        0,
        0,
        0,
        0,
        0,
        0
      FROM Stock_Transfer_Lines_tbl stl
      JOIN Stock_Transfer_tbl t ON t.id_Transfer = stl.id_Transfer
      LEFT JOIN Warehouses_tbl wf ON wf.id_Warehouse = t.id_Warehouse_From
      LEFT JOIN Warehouses_tbl wt ON wt.id_Warehouse = t.id_Warehouse_To
      WHERE stl.id_Material_NoM = ? AND t.Date_Transfer BETWEEN ? AND ?

      ORDER BY txDate ASC, txType ASC, txRef ASC
    `, [
      id_Material, dateFrom, dateTo,
      id_Material, dateFrom, dateTo,
      id_Material, dateFrom, dateTo,
      id_Material, dateFrom, dateTo,
      id_Material, dateFrom, dateTo,
    ]);

    // الكمية التراكمية: للمبيعات والمشتريات تُحسب الهدية مع الكمية
    let runQty = openingQty;
    const data = rows.map((r) => {
      if (r.txType === "نقل مخزني") {
        return { ...r, giftQty: 0, runningQty: runQty };
      }
      const moveQty = (r.txType === "بيع" || r.txType === "شراء")
        ? r.qty + (+r.giftQty || 0)
        : r.qty;
      runQty = r2(runQty + r.qtySign * moveQty);
      return { ...r, giftQty: r2(+r.giftQty || 0), runningQty: runQty };
    });

    const totalPurchased = r2(data.filter(r => r.txType === 'شراء').reduce((s, r) => s + r.qty + r.giftQty, 0));
    const totalSold      = r2(data.filter(r => r.txType === 'بيع').reduce((s, r) => s + r.qty + r.giftQty, 0));
    const totalGifted    = r2(data.filter(r => r.txType === 'بيع').reduce((s, r) => s + r.giftQty, 0));
    const totalSalesRet  = r2(data.filter(r => r.txType === 'مرتجع مبيعات').reduce((s, r) => s + r.qty, 0));
    const totalPurchRet  = r2(data.filter(r => r.txType === 'مرتجع مشتريات').reduce((s, r) => s + r.qty, 0));
    const totalValue     = r0(data.filter(r => r.txType === 'بيع').reduce((s, r) => s + r.lineTotal, 0));
    const totalCost      = r0(data.filter(r => r.txType === 'شراء').reduce((s, r) => s + r.lineTotal, 0));
    const grandLineTotal = r0(data.reduce((s, r) => s + (+r.lineTotal || 0), 0));

    return {
      groupMode: false,
      material: { ...material, id: id_Material },
      openingQty,
      data,
      totals: { totalPurchased, totalSold, totalGifted, totalSalesRet, totalPurchRet, totalValue, totalCost, grandLineTotal },
    };
}

const getItemTracking = async (req, res) => {
  const { id_Material, id_Catiguary, id_Type, from, to } = req.query;
  const pickCount = (id_Material ? 1 : 0) + (id_Catiguary ? 1 : 0) + (id_Type ? 1 : 0);
  if (pickCount !== 1)
    return res.status(400).json({
      success: false,
      message: "اختر معيار بحث واحد فقط: مادة (id_Material) أو صنف (id_Catiguary) أو نوع (id_Type)",
    });

  const { dateFrom, dateTo } = resolveDates(from, to);

  try {
    if (id_Material) {
      const result = await buildMaterialTracking(id_Material, dateFrom, dateTo);
      if (!result)
        return res.status(404).json({ success: false, message: "المادة غير موجودة" });
      return res.json({ success: true, dateFrom, dateTo, ...result });
    }

    let ids = [];
    let label = "";
    if (id_Catiguary) {
      const cat = await db.queryOne(
        `SELECT CatiguaryName FROM Catiguary_tbl WHERE id_Catiguary = ?`,
        [id_Catiguary]
      );
      const rows = await db.query(
        `SELECT id_Material_NoM AS id FROM Materials_tbl WHERE id_Catiguary = ?`,
        [id_Catiguary]
      );
      ids = rows.map((r) => r.id);
      label = `صنف: ${cat?.CatiguaryName || id_Catiguary}`;
    } else {
      const typ = await db.queryOne(
        `SELECT TypeName FROM Type_tbl WHERE id_Type = ?`,
        [id_Type]
      );
      const rows = await db.query(
        `SELECT id_Material_NoM AS id FROM Materials_tbl WHERE id_Type = ?`,
        [id_Type]
      );
      ids = rows.map((r) => r.id);
      label = `نوع: ${typ?.TypeName || id_Type}`;
    }

    if (!ids.length) {
      return res.json({
        success: true,
        dateFrom,
        dateTo,
        groupMode: true,
        material: { name: label, unit: "—", currentStock: null },
        openingQty: 0,
        data: [],
        totals: {
          totalPurchased: 0, totalSold: 0, totalGifted: 0,
          totalSalesRet: 0, totalPurchRet: 0, totalValue: 0, totalCost: 0, grandLineTotal: 0,
        },
      });
    }

    const parts = await Promise.all(
      ids.map((id) => buildMaterialTracking(id, dateFrom, dateTo))
    );
    const merged = mergeTrackingParts(parts, label) || {
      groupMode: true,
      material: { name: label, unit: "—", currentStock: null },
      openingQty: 0,
      data: [],
      totals: {
        totalPurchased: 0, totalSold: 0, totalGifted: 0,
        totalSalesRet: 0, totalPurchRet: 0, totalValue: 0, totalCost: 0, grandLineTotal: 0,
      },
    };

    return res.json({ success: true, dateFrom, dateTo, ...merged });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ══════════════════════════════════════════════════════════
//  ⑥ تقرير المرتجعات التفصيلي (مبيعات / مشتريات)
//  GET /api/advanced-reports/returns?type=CUSTOMER|SUPPLIER&from=&to=
// ══════════════════════════════════════════════════════════
const getReturnsReport = async (req, res) => {
  try {
    const { type, partyType, id_Party, from, to } = req.query;
    const returnType = String(type || "ALL").toUpperCase();
    if (!["ALL", "CUSTOMER", "SUPPLIER"].includes(returnType))
      return res.status(400).json({ success: false, message: "type مطلوب: ALL أو CUSTOMER (مبيعات) أو SUPPLIER (مشتريات)" });
    const partyFilterType = String(partyType || "ALL").toUpperCase();
    if (!["ALL", "CUSTOMER", "SUPPLIER"].includes(partyFilterType))
      return res.status(400).json({ success: false, message: "partyType يجب أن يكون ALL أو CUSTOMER أو SUPPLIER" });
    const { dateFrom, dateTo } = resolveDates(from, to);

    const rows = await db.query(
      `SELECT
         r.id_NoFRetern,
         r.Date_FRetern,
         r.ReturnType,
         r.Note_FRetern,
         r.DriverName_R,
         r.DriverMobile_R,
         r.VehicleNumber_R,
         CASE r.ReturnType WHEN 'CUSTOMER' THEN z.ZabonName WHEN 'SUPPLIER' THEN a.AmilName END AS PartyName,
         d.AmountOUT AS AmountReturn,
         d.PriceOUT AS PriceReturn,
         COALESCE(d.ReturnReason, '') AS ReturnReason,
         (d.AmountOUT * d.PriceOUT) AS LineTotal,
         m.MaterialName,
         m.Barcode,
         m.Band,
         COALESCE(t.TypeName, '') AS TypeName
       FROM FRetern_tbl r
       JOIN DetailsRetern_tbl d ON d.id_NoFRetern = r.id_NoFRetern
       LEFT JOIN Materials_tbl m ON m.id_Material_NoM = d.id_Material_NoM
       LEFT JOIN Type_tbl t ON t.id_Type = m.id_Type
       LEFT JOIN Zabon_tbl z ON z.id_Zabon = r.id_Party AND r.ReturnType = 'CUSTOMER'
       LEFT JOIN Amil_tbl a ON a.id_Amil = r.id_Party AND r.ReturnType = 'SUPPLIER'
       WHERE (? = 'ALL' OR r.ReturnType = ?)
         AND (? = 'ALL' OR r.ReturnType = ?)
         AND (? IS NULL OR ? = '' OR r.id_Party = ?)
         AND r.Date_FRetern BETWEEN ? AND ?
       ORDER BY r.Date_FRetern DESC, r.id_NoFRetern DESC, d.id_Material_NoM`,
      [returnType, returnType, partyFilterType, partyFilterType, id_Party || null, id_Party || "", id_Party || null, dateFrom, dateTo]
    );

    const byId = new Map();
    let totalValue = 0;
    for (const r of rows) {
      totalValue += +r.LineTotal || 0;
      if (!byId.has(r.id_NoFRetern)) {
        byId.set(r.id_NoFRetern, {
          id_NoFRetern: r.id_NoFRetern,
          Date_FRetern: r.Date_FRetern,
          ReturnType: r.ReturnType,
          PartyName: r.PartyName || "—",
          Note_FRetern: r.Note_FRetern || "",
          DriverName_R: r.DriverName_R || "",
          DriverMobile_R: r.DriverMobile_R || "",
          VehicleNumber_R: r.VehicleNumber_R || "",
          lines: [],
          totalValue: 0,
        });
      }
      const inv = byId.get(r.id_NoFRetern);
      inv.totalValue = r2(inv.totalValue + (+r.LineTotal || 0));
      inv.lines.push({
        MaterialName: r.MaterialName,
        Barcode: r.Barcode,
        Band: r.Band,
        TypeName: r.TypeName,
        AmountReturn: r.AmountReturn,
        PriceReturn: r.PriceReturn,
        ReturnReason: r.ReturnReason,
        LineTotal: r2(r.LineTotal),
      });
    }

    res.json({
      success: true,
      dateFrom,
      dateTo,
      returnType,
      partyType: partyFilterType,
      id_Party: id_Party || "",
      rows,
      returns: [...byId.values()],
      totals: {
        returnCount: byId.size,
        lineCount: rows.length,
        totalValue: r2(totalValue),
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

module.exports = {
  getCustomersList,
  getSuppliersList,
  getMaterialsList,
  getCustomerStatement,
  getSupplierStatement,
  getCustomerActivity,
  getSupplierActivity,
  getItemTracking,
  getReturnsReport,
};
