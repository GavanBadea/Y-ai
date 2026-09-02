// ============================================================
//  controllers/projectCapital.controller.js  —  رأس المال
//
//  الجدول: ProjectCapital_tbl
//  الحقول: id_Capital, CapitalAmount, DepositDate, Notes
//
//  Endpoints:
//   GET  /api/capital           → آخر قيمة لرأس المال
//   POST /api/capital           → تعيين رأس المال (يُسجّل كإيداع جديد)
//   GET  /api/capital/history   → سجل تغييرات رأس المال
//   GET  /api/capital/summary   → ملخص الصندوق الكامل
// ============================================================
const db = require("../db");

// ──────────────────────────────────────────────────────────
//  GET /api/capital
//  يُرجع إجمالي رأس المال (مجموع كل الإيداعات التراكمية)
// ──────────────────────────────────────────────────────────
const getCapital = async (_req, res) => {
  try {
    const row = await db.queryOne(
      `SELECT COALESCE(SUM(CapitalAmount), 0) AS CapitalAmount,
              COUNT(*) AS depositsCount,
              MAX(DepositDate) AS lastDepositDate
       FROM ProjectCapital_tbl`
    );
    res.json({
      success : true,
      data    : row || { CapitalAmount: 0, depositsCount: 0, lastDepositDate: null },
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ──────────────────────────────────────────────────────────
//  POST /api/capital
//  Body: { CapitalAmount, Notes? }
//  يُضيف مبلغاً جديداً إلى رأس المال التراكمي
//  كل إيداع يُسجَّل بشكل مستقل في السجل التاريخي
// ──────────────────────────────────────────────────────────
const setCapital = async (req, res) => {
  const { CapitalAmount, Notes } = req.body;

  if (CapitalAmount === undefined || CapitalAmount === null)
    return res.status(400).json({ success: false, message: "المبلغ (CapitalAmount) مطلوب" });

  if (Number(CapitalAmount) <= 0)
    return res.status(400).json({ success: false, message: "يجب أن يكون المبلغ المُضاف أكبر من صفر" });

  try {
    // إجمالي رأس المال قبل الإضافة
    const prevRow = await db.queryOne(
      `SELECT COALESCE(SUM(CapitalAmount), 0) AS prev FROM ProjectCapital_tbl`
    );
    const prevTotal   = prevRow?.prev || 0;
    const newTotal    = prevTotal + Number(CapitalAmount);

    const r = await db.run(
      `INSERT INTO ProjectCapital_tbl (CapitalAmount, DepositDate, Notes)
       VALUES (?, date('now'), ?)`,
      [Number(CapitalAmount), Notes || null]
    );

    res.status(201).json({
      success   : true,
      message   : "تم إضافة رأس المال بنجاح",
      id        : r.lastID,
      added     : Number(CapitalAmount),
      prevTotal,
      newTotal,
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ──────────────────────────────────────────────────────────
//  GET /api/capital/history
//  سجل جميع التغييرات (آخر 50 سجل)
// ──────────────────────────────────────────────────────────
const getHistory = async (_req, res) => {
  try {
    const rows = await db.query(
      `SELECT * FROM ProjectCapital_tbl ORDER BY id_Capital DESC LIMIT 50`
    );
    res.json({ success: true, count: rows.length, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ──────────────────────────────────────────────────────────
//  GET /api/capital/summary
//  ملخص الصندوق الكامل (للقراءة فقط):
//   رأس المال + المقبوضات - المشتريات المدفوعة - المصاريف
// ──────────────────────────────────────────────────────────
const getSummary = async (_req, res) => {
  const r2 = (n) => Math.round((n || 0) * 100) / 100;

  try {
    // ── رأس المال (مجموع كل الإيداعات التراكمية) ─────────────
    const capRow = await db.queryOne(
      `SELECT COALESCE(SUM(CapitalAmount), 0) AS cap FROM ProjectCapital_tbl`
    );
    const capital = r2(capRow?.cap || 0);

    // ── إجمالي المقبوضات من الزبائن ──────────────────────────
    const catchRow = await db.queryOne(
      `SELECT COALESCE(SUM(Amount_CatchDoc), 0) AS t FROM CatchDoc_tbl`
    );
    const totalReceipts = r2(catchRow?.t || 0);

    // ── إجمالي المبيعات النقدية (كل ما ليس آجل) ──────────────
    const cashSalesRow = await db.queryOne(
      `SELECT COALESCE(SUM(d.AmountOUT * d.PriceOUT) - COALESCE(SUM(f.Dis_FOUT), 0), 0) AS t
       FROM FOUT_tbl f
       LEFT JOIN DetailsOUT_tbl d ON d.id_NoFOUT = f.id_NoFOUT
       LEFT JOIN PayType_Tbl pt ON pt.id_PayType = f.id_PayType_FOUT
       WHERE pt.PayTypeName NOT IN ('اجل','آجل')`
    );
    const cashSales = r2(cashSalesRow?.t || 0);

    // ── إجمالي المدفوعات للموردين ─────────────────────────────
    const payRow = await db.queryOne(
      `SELECT COALESCE(SUM(Amount_PayDoc), 0) AS t FROM PayDoc_tbl`
    );
    const totalPayments = r2(payRow?.t || 0);

    // ── إجمالي المصاريف التشغيلية ────────────────────────────
    const expRow = await db.queryOne(
      `SELECT COALESCE(SUM(Price_SpendingDetails), 0) AS t FROM SpendingDetails_tbl`
    );
    const totalExpenses = r2(expRow?.t || 0);

    // ── الإيداع الكلي = رأس المال + المقبوضات + مبيعات نقدية ──
    const totalIn  = r2(capital + totalReceipts + cashSales);

    // ── السحب الكلي = مدفوعات + مصاريف ───────────────────────
    const totalOut = r2(totalPayments + totalExpenses);

    // ── الرصيد الجاري ─────────────────────────────────────────
    const balance  = r2(totalIn - totalOut);

    // ── تفصيل المصاريف حسب الموضوع ───────────────────────────
    const expByTopic = await db.query(
      `SELECT
         COALESCE(s.NamePersonFor_Spending, 'غير محدد') AS topic,
         COALESCE(SUM(sd.Price_SpendingDetails), 0)     AS amount
       FROM SpendingDetails_tbl sd
       LEFT JOIN Spending_tbl s ON s.id_Spending = sd.id_Spending
       GROUP BY sd.id_Spending
       ORDER BY amount DESC
       LIMIT 10`
    );

    res.json({
      success : true,
      data    : {
        capital         : capital,
        receipts        : totalReceipts,
        cashSales       : cashSales,
        supplierPayments: totalPayments,
        expenses        : totalExpenses,
        totalIn,
        totalOut,
        balance,
        balanceStatus   : balance >= 0 ? "رصيد موجب" : "عجز",
        expensesByTopic : expByTopic.map((r) => ({
          topic  : r.topic,
          amount : r2(r.amount),
        })),
      },
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ──────────────────────────────────────────────────────────
//  PUT /api/capital/history/:id
//  تعديل سجل إيداع
// ──────────────────────────────────────────────────────────
const updateDeposit = async (req, res) => {
  const { CapitalAmount, Notes, DepositDate } = req.body;
  const id = req.params.id;

  if (CapitalAmount === undefined || Number(CapitalAmount) <= 0)
    return res.status(400).json({ success: false, message: "يجب أن يكون المبلغ أكبر من صفر" });

  try {
    const row = await db.queryOne(
      `SELECT id_Capital FROM ProjectCapital_tbl WHERE id_Capital = ?`, [id]
    );
    if (!row)
      return res.status(404).json({ success: false, message: "السجل غير موجود" });

    await db.run(
      `UPDATE ProjectCapital_tbl
       SET CapitalAmount = ?, Notes = ?, DepositDate = COALESCE(?, DepositDate)
       WHERE id_Capital = ?`,
      [Number(CapitalAmount), Notes || null, DepositDate || null, id]
    );

    const totalRow = await db.queryOne(
      `SELECT COALESCE(SUM(CapitalAmount), 0) AS CapitalAmount FROM ProjectCapital_tbl`
    );

    res.json({
      success : true,
      message : "تم تعديل الإيداع",
      newTotal: totalRow?.CapitalAmount || 0,
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ──────────────────────────────────────────────────────────
//  DELETE /api/capital/history/:id
//  حذف سجل إيداع
// ──────────────────────────────────────────────────────────
const deleteDeposit = async (req, res) => {
  try {
    const row = await db.queryOne(
      `SELECT id_Capital FROM ProjectCapital_tbl WHERE id_Capital = ?`, [req.params.id]
    );
    if (!row)
      return res.status(404).json({ success: false, message: "السجل غير موجود" });

    await db.run(`DELETE FROM ProjectCapital_tbl WHERE id_Capital = ?`, [req.params.id]);

    const totalRow = await db.queryOne(
      `SELECT COALESCE(SUM(CapitalAmount), 0) AS CapitalAmount FROM ProjectCapital_tbl`
    );

    res.json({
      success : true,
      message : "تم حذف الإيداع",
      newTotal: totalRow?.CapitalAmount || 0,
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

module.exports = { getCapital, setCapital, getHistory, getSummary, updateDeposit, deleteDeposit };
