// ============================================================
//  controllers/PurchaseController.js  ★ FINAL v3 — YVG WMS
//
//  المسار: /api/purchases  (مسجّل في server.js)
//
//  الجداول:
//   FIN_tbl         → رأس الفاتورة
//   DetailsIN_tbl   → أسطر الفاتورة
//   Stock_tbl       → المخزون  ← يُحدَّث آلياً عند الحفظ/الحذف
//   Materials_tbl   → "Cost Price" WAC ← يُحدَّث آلياً
//   DionAmil_tbl    → ديون الموردين (للدفع الآجل فقط)
//   AuditLog_tbl    → كل تغيير مُسجَّل
//
//  Landed Cost:
//   netExtras = Trans + Customs + Porter − Dis_FIN
//   حصة_السطر = (AmtIN × PriceIN / LinesTotal) × netExtras
//   LC/وحدة  = PriceIN + حصة_السطر / AmtIN
//
//  WAC:
//   newCost = (oldQty×oldCost + newQty×LC/وحدة) / (oldQty+newQty)
// ============================================================
const db = require("../db");
const { applyLandedCostToLines, r2, r3 } = require("../utils/purchaseLineCost");

const calcLC = applyLandedCostToLines;

function wacFromInventoryValue(oldQty, oldCost, newQty, inventoryValue) {
  const oq = +oldQty || 0;
  const oc = +oldCost || 0;
  const nq = +newQty || 0;
  const iv = +inventoryValue || 0;
  const totalQty = oq + nq;
  if (totalQty === 0) return nq > 0 ? iv / nq : 0;
  return (oq * oc + iv) / totalQty;
}

function wac(oldQ, oldC, newQ, newC) {
  const t = oldQ + newQ;
  return t === 0 ? newC : (oldQ * oldC + newQ * newC) / t;
}

const auditLog = require("./auditLog.controller");
const log = (user, tbl, id, field, ov, nv, note = "") =>
  auditLog.log(user, tbl, id, field, ov, nv, note);

const { supplierBalance } = require("../utils/partyBalance");

// ── BASE SELECT ─────────────────────────────────────────────
const HDR = `
  SELECT f.id_NoFIN, f.Date_FIN, f.id_PayType_FIN, f.Dis_FIN,
         f.Trans, f.Customs, f.Porter, f.id_Amil,
         a.AmilName, a.Mobil AS AmilMobile, pt.PayTypeName,
    COALESCE((SELECT SUM(d.AmountIN*d.PriceIN)
              FROM DetailsIN_tbl d WHERE d.id_NoFIN=f.id_NoFIN),0) AS LinesTotal,
    (f.Trans+f.Customs+f.Porter)                                    AS TotalExtras,
    (f.Trans+f.Customs+f.Porter-f.Dis_FIN)                         AS NetExtras,
    COALESCE((SELECT SUM(d.AmountIN*d.PriceIN)
              FROM DetailsIN_tbl d WHERE d.id_NoFIN=f.id_NoFIN),0)
    +(f.Trans+f.Customs+f.Porter-f.Dis_FIN)                        AS GrandTotal,
    (SELECT COUNT(*) FROM DetailsIN_tbl d WHERE d.id_NoFIN=f.id_NoFIN) AS ItemCount,
    COALESCE((SELECT SUM(d.AmountIN+COALESCE(d.Gift_IN,0))
              FROM DetailsIN_tbl d WHERE d.id_NoFIN=f.id_NoFIN),0) AS TotalUnits
  FROM FIN_tbl f
  LEFT JOIN Amil_tbl    a  ON a.id_Amil    = f.id_Amil
  LEFT JOIN PayType_Tbl pt ON pt.id_PayType = f.id_PayType_FIN
`;

// ══════════════════════════════════════════════════════════
//  1. getAll — قائمة الفواتير مع ترحيل صفحات
// ══════════════════════════════════════════════════════════
const getAll = async (req, res) => {
  try {
    const { from, to, id_Amil, id_PayType, page=1, limit=20 } = req.query;
    let w = " WHERE 1=1"; const p = [];
    if (from)       { w+=" AND f.Date_FIN>=?";      p.push(from); }
    if (to)         { w+=" AND f.Date_FIN<=?";      p.push(to); }
    if (id_Amil)    { w+=" AND f.id_Amil=?";        p.push(id_Amil); }
    if (id_PayType) { w+=" AND f.id_PayType_FIN=?"; p.push(id_PayType); }

    const cnt    = await db.queryOne(`SELECT COUNT(*) AS n FROM FIN_tbl f${w}`, p);
    const offset = (Number(page)-1)*Number(limit);
    const rows   = await db.query(
      HDR + w + " ORDER BY f.Date_FIN DESC,f.id_NoFIN DESC LIMIT ? OFFSET ?",
      [...p, Number(limit), offset]
    );
    res.json({ success:true, count:rows.length, total:cnt.n,
               page:Number(page), totalPages:Math.ceil(cnt.n/Number(limit)), data:rows });
  } catch(e){ res.status(500).json({success:false,message:e.message}); }
};

// ══════════════════════════════════════════════════════════
//  2. getOne — فاتورة كاملة + LC محسوب + رصيد المورد
// ══════════════════════════════════════════════════════════
const getOne = async (req, res) => {
  try {
    const hdr = await db.queryOne(HDR+" WHERE f.id_NoFIN=?", [req.params.id]);
    if (!hdr) return res.status(404).json({success:false,message:"الفاتورة غير موجودة"});

    const lines = await db.query(
      `SELECT d.*, m.MaterialName, m.Barcode, m.Band,
              m."Cost Price" AS CurrentCost, c.CatiguaryName,
              (d.AmountIN*d.PriceIN) AS LineTotal,
              COALESCE(s.QuantityOnHand,0) AS CurrentStock
       FROM DetailsIN_tbl d
       LEFT JOIN Materials_tbl m ON m.id_Material_NoM=d.id_Material_NoM
       LEFT JOIN Catiguary_tbl c ON c.id_Catiguary=m.id_Catiguary
       LEFT JOIN Stock_tbl     s ON s.id_Material_NoM=d.id_Material_NoM
       WHERE d.id_NoFIN=? ORDER BY d.id_Material_NoM`, [req.params.id]
    );

    const bal    = await supplierBalance(hdr.id_Amil);
    const withLC = calcLC(lines, hdr.NetExtras || 0);

    res.json({ success:true, data:{ ...hdr, supplierBalance:bal, lines:withLC } });
  } catch(e){ res.status(500).json({success:false,message:e.message}); }
};

// ══════════════════════════════════════════════════════════
//  3. create — حفظ الفاتورة مع WAC + Stock + DionAmil_tbl
// ══════════════════════════════════════════════════════════
const create = async (req, res) => {
  const { Date_FIN, id_PayType_FIN, id_Amil,
          Dis_FIN=0, Trans=0, Customs=0, Porter=0, lines=[] } = req.body;

  if (!id_Amil)        return res.status(400).json({success:false,message:"المورد مطلوب"});
  if (!id_PayType_FIN) return res.status(400).json({success:false,message:"طريقة الدفع مطلوبة"});
  if (!lines.length)   return res.status(400).json({success:false,message:"أضف سطراً واحداً على الأقل"});

  const amil    = await db.queryOne(`SELECT * FROM Amil_tbl    WHERE id_Amil=?`,[id_Amil]);
  const payType = await db.queryOne(`SELECT * FROM PayType_Tbl WHERE id_PayType=?`,[id_PayType_FIN]);
  if (!amil)    return res.status(400).json({success:false,message:`المورد ${id_Amil} غير موجود`});
  if (!payType) return res.status(400).json({success:false,message:`طريقة الدفع ${id_PayType_FIN} غير موجودة`});

  const invDate  = Date_FIN || new Date().toISOString().split("T")[0];
  const prepared = [];

  for (const ln of lines) {
    const { id_Material_NoM, AmountIN, PriceIN, Gift_IN=0 } = ln;
    if (!id_Material_NoM || Number(AmountIN)<=0)
      return res.status(400).json({success:false,message:`بيانات ناقصة (المادة ${id_Material_NoM})`});

    const mat = await db.queryOne(
      `SELECT id_Material_NoM,MaterialName,"Cost Price" AS Cost FROM Materials_tbl WHERE id_Material_NoM=?`,
      [id_Material_NoM]);
    if (!mat) return res.status(400).json({success:false,message:`المادة ${id_Material_NoM} غير موجودة`});

    const stk = await db.queryOne(
      `SELECT COALESCE(QuantityOnHand,0) AS qty FROM Stock_tbl WHERE id_Material_NoM=?`,
      [id_Material_NoM]);

    prepared.push({
      id_Material_NoM: Number(id_Material_NoM),
      MaterialName   : mat.MaterialName,
      OldCost        : mat.Cost || 0,
      OldQty         : stk?.qty || 0,
      AmountIN       : Number(AmountIN),
      PriceIN        : Number(PriceIN),
      Gift_IN        : Number(Gift_IN),
    });
  }

  const netExtras = +Trans + +Customs + +Porter - +Dis_FIN;
  const withLC    = calcLC(prepared, netExtras);
  const balBefore = await supplierBalance(id_Amil);

  try {
    await db.run("BEGIN TRANSACTION");

    // ── رأس الفاتورة ─────────────────────────────────────
    const hdr = await db.run(
      `INSERT INTO FIN_tbl (Date_FIN,id_PayType_FIN,Dis_FIN,Trans,Customs,Porter,id_Amil)
       VALUES(?,?,?,?,?,?,?)`,
      [invDate, id_PayType_FIN, +Dis_FIN, +Trans, +Customs, +Porter, id_Amil]
    );
    const invId = hdr.lastID;
    const summ  = [];

    for (const ln of withLC) {
      const totalQty = ln.AmountIN + ln.Gift_IN;

      // سطر التفصيل
      await db.run(
        `INSERT INTO DetailsIN_tbl (id_NoFIN,id_Material_NoM,AmountIN,PriceIN,Gift_IN)
         VALUES(?,?,?,?,?)`,
        [invId, ln.id_Material_NoM, ln.AmountIN, ln.PriceIN, ln.Gift_IN]
      );

      // WAC بسعر LC — من قيمة المخzون الكاملة دون تقريب مبكر
      const newCost = wacFromInventoryValue(ln.OldQty, ln.OldCost, totalQty, ln.InventoryValue);
      await db.run(
        `UPDATE Materials_tbl SET "Cost Price"=? WHERE id_Material_NoM=?`,
        [newCost, ln.id_Material_NoM]
      );

      // تحديث المخزون (كمية + هدايا)
      await db.run(
        `INSERT INTO Stock_tbl (id_Material_NoM,QuantityIN,QuantityOnHand,LastUpdateDate)
         VALUES(?,?,?,datetime('now'))
         ON CONFLICT(id_Material_NoM) DO UPDATE SET
           QuantityIN     = QuantityIN     + excluded.QuantityIN,
           QuantityOnHand = QuantityOnHand + excluded.QuantityIN,
           LastUpdateDate = excluded.LastUpdateDate`,
        [ln.id_Material_NoM, totalQty, totalQty]
      );

      await log(req.user,"Materials_tbl",ln.id_Material_NoM,"Cost Price",
        ln.OldCost, newCost, `فاتورة #${invId} LC=${ln.LandedCostPerUnit}`);

      summ.push({
        id_Material_NoM  : ln.id_Material_NoM,
        MaterialName     : ln.MaterialName,
        AmountIN         : ln.AmountIN,
        Gift_IN          : ln.Gift_IN,
        TotalQtyIn       : totalQty,
        PriceIN          : ln.PriceIN,
        LandedCostShare  : ln.LandedCostShare,
        LandedCostPerUnit: ln.LandedCostPerUnit,
        OldCost          : ln.OldCost,
        NewCost          : newCost,
      });
    }

    // الإجمالي
    const linesTotal = prepared.reduce((s,l)=>s+l.AmountIN*l.PriceIN, 0);
    const grandTotal = r2(linesTotal + netExtras);

    // ── DionAmil_tbl للدفع الآجل ──────────────────────────
    if (payType.PayTypeName === "آجل") {
      await db.run(
        `INSERT INTO DionAmil_tbl (Amount_DionAmil,Date_DionAmil,Note_DionAmil,id_Amil)
         VALUES(?,?,?,?)`,
        [grandTotal, invDate, `فاتورة مشتريات رقم ${invId}`, id_Amil]
      );
    }

    await log(req.user,"FIN_tbl",invId,"CREATE",null,grandTotal,
      `${amil.AmilName}|${payType.PayTypeName}|${summ.length} أصناف`);

    await db.run("COMMIT");

    const balAfter = await supplierBalance(id_Amil);

    res.status(201).json({
      success  : true,
      message  : "✅ تم إنشاء الفاتورة وتحديث المخزون والتكاليف",
      invoiceId: invId,
      summary  : {
        invoiceDate, supplierName:amil.AmilName, paymentType:payType.PayTypeName,
        linesCount:summ.length, linesTotal:r2(linesTotal),
        extras:{ Trans:+Trans, Customs:+Customs, Porter:+Porter },
        discount:+Dis_FIN, netExtras:r2(netExtras), grandTotal,
        debtAdded    : payType.PayTypeName==="آجل",
        balanceBefore: balBefore.netBalance,
        balanceAfter : balAfter.netBalance,
      },
      lines: summ,
    });
  } catch(e) {
    await db.run("ROLLBACK").catch(()=>{});
    res.status(500).json({success:false,message:e.message});
  }
};

// ══════════════════════════════════════════════════════════
//  4. deleteInvoice — حذف كامل مع عكس جميع التأثيرات
//     • يُنقَص المخزون (qty + Gift_IN)
//     • يُحذَف قيد الدين من DionAmil_tbl إذا كان آجلاً
//     • يُسجَّل في AuditLog_tbl
// ══════════════════════════════════════════════════════════
const deleteInvoice = async (req, res) => {
  try {
    const hdr = await db.queryOne(
      `SELECT f.*, pt.PayTypeName FROM FIN_tbl f
       LEFT JOIN PayType_Tbl pt ON pt.id_PayType=f.id_PayType_FIN
       WHERE f.id_NoFIN=?`, [req.params.id]
    );
    if (!hdr) return res.status(404).json({success:false,message:"الفاتورة غير موجودة"});

    const lines = await db.query(
      `SELECT d.*, m."Cost Price" AS Cost, COALESCE(s.QuantityOnHand,0) AS StockNow
       FROM DetailsIN_tbl d
       LEFT JOIN Materials_tbl m ON m.id_Material_NoM=d.id_Material_NoM
       LEFT JOIN Stock_tbl     s ON s.id_Material_NoM=d.id_Material_NoM
       WHERE d.id_NoFIN=?`, [req.params.id]
    );

    await db.run("BEGIN TRANSACTION");

    for (const l of lines) {
      const qty = (l.AmountIN||0) + (l.Gift_IN||0);

      // عكس المخزون
      await db.run(
        `UPDATE Stock_tbl SET
           QuantityIN     = MAX(0, QuantityIN-?),
           QuantityOnHand = MAX(0, QuantityOnHand-?),
           LastUpdateDate = datetime('now')
         WHERE id_Material_NoM=?`,
        [qty, qty, l.id_Material_NoM]
      );

      // عكس تقريبي للتكلفة (WAC عكسي)
      const newQ = Math.max(0, l.StockNow - qty);
      if (newQ > 0 && l.Cost > 0) {
        const revC = (l.Cost * l.StockNow - l.PriceIN * qty) / newQ;
        if (revC > 0)
          await db.run(`UPDATE Materials_tbl SET "Cost Price"=? WHERE id_Material_NoM=?`,
            [r3(revC), l.id_Material_NoM]);
      }

      await log(req.user,"Stock_tbl",l.id_Material_NoM,
        "QuantityOnHand(−)", l.StockNow, Math.max(0,l.StockNow-qty),
        `حذف فاتورة #${req.params.id}`);
    }

    // إلغاء قيد الدين
    let debtCancelled = false;
    if (hdr.PayTypeName === "آجل") {
      const r = await db.run(
        `DELETE FROM DionAmil_tbl WHERE id_Amil=? AND Note_DionAmil=?`,
        [hdr.id_Amil, `فاتورة مشتريات رقم ${req.params.id}`]
      );
      debtCancelled = r.changes > 0;
    }

    await db.run(`DELETE FROM DetailsIN_tbl WHERE id_NoFIN=?`, [req.params.id]);
    await db.run(`DELETE FROM FIN_tbl        WHERE id_NoFIN=?`, [req.params.id]);
    await log(req.user,"FIN_tbl",req.params.id,"DELETE",null,null,
      "حذف كامل + عكس المخزون والديون");

    await db.run("COMMIT");

    res.json({
      success  : true,
      message  : `✅ الفاتورة #${req.params.id} حُذفت وعُكست جميع تأثيراتها`,
      reversed : { linesReversed:lines.length, debtCancelled },
    });
  } catch(e) {
    await db.run("ROLLBACK").catch(()=>{});
    res.status(500).json({success:false,message:e.message});
  }
};

// ══════════════════════════════════════════════════════════
//  5. navigate — السابق / التالي
// ══════════════════════════════════════════════════════════
const navigate = async (req, res) => {
  const { id, direction } = req.params;
  try {
    const sql = direction==="prev"
      ? `SELECT id_NoFIN FROM FIN_tbl WHERE id_NoFIN<? ORDER BY id_NoFIN DESC LIMIT 1`
      : `SELECT id_NoFIN FROM FIN_tbl WHERE id_NoFIN>? ORDER BY id_NoFIN ASC  LIMIT 1`;

    const row = await db.queryOne(sql, [id]);
    if (!row) return res.status(404).json({
      success:false,
      message: direction==="prev" ? "لا يوجد سابق" : "لا يوجد تالٍ",
      currentId: Number(id)
    });

    const hdr   = await db.queryOne(HDR+" WHERE f.id_NoFIN=?", [row.id_NoFIN]);
    const lines = await db.query(
      `SELECT d.*, m.MaterialName, m.Band, m.Barcode,
              (d.AmountIN*d.PriceIN) AS LineTotal
       FROM DetailsIN_tbl d
       LEFT JOIN Materials_tbl m ON m.id_Material_NoM=d.id_Material_NoM
       WHERE d.id_NoFIN=?`, [row.id_NoFIN]
    );
    const bal    = await supplierBalance(hdr.id_Amil);
    const withLC = calcLC(lines, hdr.NetExtras||0);

    res.json({ success:true, direction, data:{ ...hdr, supplierBalance:bal, lines:withLC }});
  } catch(e){ res.status(500).json({success:false,message:e.message}); }
};

// ══════════════════════════════════════════════════════════
//  6. getBounds — أول / آخر رقم فاتورة (للملاحة)
// ══════════════════════════════════════════════════════════
const getBounds = async (_req, res) => {
  try {
    const [first, last] = await Promise.all([
      db.queryOne(`SELECT id_NoFIN FROM FIN_tbl ORDER BY id_NoFIN ASC  LIMIT 1`),
      db.queryOne(`SELECT id_NoFIN FROM FIN_tbl ORDER BY id_NoFIN DESC LIMIT 1`),
    ]);
    res.json({ success:true, first:first?.id_NoFIN||null, last:last?.id_NoFIN||null });
  } catch(e){ res.status(500).json({success:false,message:e.message}); }
};

// ══════════════════════════════════════════════════════════
//  7. previewLC — معاينة Landed Cost بدون حفظ
// ══════════════════════════════════════════════════════════
const previewLC = async (req, res) => {
  const { Trans=0, Customs=0, Porter=0, Dis_FIN=0, lines=[] } = req.body;
  if (!lines.length) return res.status(400).json({success:false,message:"الأسطر فارغة"});

  const netExtras  = +Trans + +Customs + +Porter - +Dis_FIN;
  const norm       = lines.map(l=>({...l, AmountIN:+(l.AmountIN||1), PriceIN:+(l.PriceIN||0)}));
  const preview    = calcLC(norm, netExtras);
  const linesTotal = norm.reduce((s,l)=>s+l.AmountIN*l.PriceIN, 0);

  res.json({
    success   : true,
    linesTotal: r2(linesTotal),
    netExtras : r2(netExtras),
    grandTotal: r2(linesTotal+netExtras),
    lines     : preview.map(l=>({
      id_Material_NoM  : l.id_Material_NoM,
      AmountIN         : l.AmountIN,
      PriceIN          : l.PriceIN,
      LineTotal        : r2(l.AmountIN*l.PriceIN),
      LandedCostShare  : r2(l.LandedCostShare),
      LandedCostPerUnit: r2(l.LandedCostPerUnit),
    })),
  });
};

// ══════════════════════════════════════════════════════════
//  8. getSupplierBalance — رصيد المورد (عند اختياره)
// ══════════════════════════════════════════════════════════
const getSupplierBalance = async (req, res) => {
  try {
    const amil = await db.queryOne(`SELECT * FROM Amil_tbl WHERE id_Amil=?`,[req.params.id]);
    if (!amil) return res.status(404).json({success:false,message:"المورد غير موجود"});
    const bal = await supplierBalance(req.params.id);
    res.json({ success:true, data:{ ...amil, balance:bal }});
  } catch(e){ res.status(500).json({success:false,message:e.message}); }
};

module.exports = {
  getAll,
  getOne,
  create,
  deleteInvoice,
  navigate,
  getBounds,
  previewLC,
  getSupplierBalance,
};
