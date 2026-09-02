/** رصيد الزبون/المورد بدون احتساب «تسوية» السندات مرتين مع سند القبض/الدفع */
const db = require("../db");
const r2 = (n) => Math.round((+n || 0) * 100) / 100;

async function customerBalance(id_Zabon) {
  const [debtRow, payRow] = await Promise.all([
    db.queryOne(
      `SELECT COALESCE(SUM(Amount_DionZabon), 0) AS t
       FROM DionZabon_tbl
       WHERE id_Zabon = ?
         AND Note_DionZabon NOT LIKE 'تسوية سند قبض رقم%'`,
      [id_Zabon]
    ),
    db.queryOne(
      `SELECT COALESCE(SUM(Amount_CatchDoc), 0) AS t
       FROM CatchDoc_tbl WHERE id_Zabon = ?`,
      [id_Zabon]
    ),
  ]);
  const totalDebt = r2(debtRow?.t || 0);
  const totalPaid = r2(payRow?.t || 0);
  return {
    totalDebt,
    totalCollected: totalPaid,
    totalPaid,
    netBalance: r2(totalDebt - totalPaid),
  };
}

async function supplierBalance(id_Amil) {
  const [debtRow, payRow] = await Promise.all([
    db.queryOne(
      `SELECT COALESCE(SUM(Amount_DionAmil), 0) AS t
       FROM DionAmil_tbl
       WHERE id_Amil = ?
         AND Note_DionAmil NOT LIKE 'تسوية سند دفع رقم%'`,
      [id_Amil]
    ),
    db.queryOne(
      `SELECT COALESCE(SUM(Amount_PayDoc), 0) AS t
       FROM PayDoc_tbl WHERE id_Amil = ?`,
      [id_Amil]
    ),
  ]);
  const totalDebt = r2(debtRow?.t || 0);
  const totalPaid = r2(payRow?.t || 0);
  return { totalDebt, totalPaid, netBalance: r2(totalDebt - totalPaid) };
}

/** null = مسموح | string = رسالة رفض */
function checkCustomerCreditLimit(creditLimit, netBalance, grandTotal, paidAmount = 0) {
  const limit = r2(creditLimit);
  if (limit <= 0) return null;
  const gt = r2(grandTotal);
  const paid = r2(Math.min(Math.max(0, +paidAmount || 0), gt));
  const projected = r2(r2(netBalance) + gt - paid);
  if (projected > limit) {
    return `تجاوز حد الائتمان (${limit} د.ع). الرصيد الحالي: ${r2(netBalance)} د.ع، وبعد هذه الفاتورة: ${projected} د.ع`;
  }
  return null;
}

module.exports = { customerBalance, supplierBalance, checkCustomerCreditLimit };
