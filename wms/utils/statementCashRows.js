// توسيع الفواتير النقدية إلى سطرين (فاتورة + دفع/قبض فوري) — صافي الرصيد = 0
const r2 = (n) => Math.round((+n || 0) * 100) / 100;

function cashInvoiceAmount(r) {
  return r2(r.displayDebit || r.displayCredit || 0);
}

function isCashInvoiceRow(r) {
  if (r.txType !== "فاتورة بيع" && r.txType !== "فاتورة شراء") return false;
  const amt = cashInvoiceAmount(r);
  return amt > 0 && !r.debit && !r.credit;
}

/** كشوف الحسابات — صفوف SQL بعد الاستعلام */
function expandCashStatementRows(rows, role) {
  const expanded = [];
  for (const r of rows) {
    if (!isCashInvoiceRow(r)) {
      expanded.push(r);
      continue;
    }
    const amt = cashInvoiceAmount(r);
    const base = {
      txDate: r.txDate,
      txDateTime: r.txDateTime,
      txRef: r.txRef,
      txSeq: r.txSeq,
      txSubType: r.txSubType || "",
      displayDebit: 0,
      displayCredit: 0,
    };

    if (role === "supplier") {
      expanded.push({
        ...base,
        txType: "فاتورة شراء (نقدي)",
        txNote: r.txNote || `فاتورة شراء نقدية #${r.txRef}`,
        invoiceAmount: r.invoiceAmount || amt,
        debit: 0,
        credit: amt,
        _cashSort: 0,
      });
      expanded.push({
        ...base,
        txType: "دفع فوري",
        txNote: `دفع فوري — فاتورة #${r.txRef}`,
        debit: amt,
        credit: 0,
        _cashSort: 1,
      });
    } else {
      expanded.push({
        ...base,
        txType: "فاتورة بيع (نقدي)",
        txNote: r.txNote || `فاتورة بيع نقدية #${r.txRef}`,
        invoiceAmount: r.invoiceAmount || amt,
        debit: amt,
        credit: 0,
        _cashSort: 0,
      });
      expanded.push({
        ...base,
        txType: "قبض فوري",
        txNote: `قبض فوري — فاتورة #${r.txRef}`,
        debit: 0,
        credit: amt,
        _cashSort: 1,
      });
    }
  }

  return expanded;
}

const PAY_TX_TYPES = new Set(["سند قبض", "سند دفع", "قبض فوري", "دفع فوري", "سماح"]);

function extractInvoiceRefFromPayNote(note, role) {
  const re = role === "supplier"
    ? /دفعة على فاتورة مش.+?#(\d+)/
    : /دفعة على فاتورة مبيعات\s*#(\d+)/;
  const m = String(note || "").match(re);
  return m ? m[1] : null;
}

/** ربط سندات الدفع/القبض على الفاتورة بوقت وتسلسل الفاتورة */
function linkInvoicePaymentRows(rows, role) {
  const invTypes = role === "supplier"
    ? new Set(["فاتورة شراء", "فاتورة شراء (نقدي)"])
    : new Set(["فاتورة بيع", "فاتورة بيع (نقدي)"]);
  const payType = role === "supplier" ? "سند دفع" : "سند قبض";

  const invByRef = new Map();
  for (const r of rows) {
    if (!invTypes.has(r.txType)) continue;
    const ref = String(r.txRef);
    const prev = invByRef.get(ref);
    if (!prev || String(r.txDateTime || "") >= String(prev.txDateTime || "")) {
      invByRef.set(ref, r);
    }
  }

  return rows.map((r) => {
    if (r.txType !== payType) return r;
    const invRef = extractInvoiceRefFromPayNote(r.txNote, role);
    if (!invRef) return { ...r, _paySort: 2 };
    const inv = invByRef.get(invRef);
    if (!inv) return { ...r, _invoiceLinked: true, _paySort: 1 };
    const invDt = String(inv.txDateTime || `${inv.txDate} 00:00:00`);
    const payDt = String(r.txDateTime || `${r.txDate} 00:00:00`);
    const inheritInvTime = payDt.endsWith("00:00:00") || payDt <= invDt;
    return {
      ...r,
      _invoiceLinked: true,
      _paySort: 1,
      txDateTime: inheritInvTime ? invDt : r.txDateTime,
      txSeq: inv.txSeq ?? r.txSeq,
    };
  });
}

/** وقت الترتيب — سندات بمنتصف الليل (بدون وقت حقيقي) تُؤخَّر بعد فواتير اليوم */
function effectiveSortDateTime(r) {
  const dt = String(r.txDateTime || r.dateTime || `${r.txDate || r.date} 00:00:00`);
  if (PAY_TX_TYPES.has(r.txType) && dt.endsWith("00:00:00")) {
    return `${dt.slice(0, 10)} 23:59:59`;
  }
  return dt;
}

/** أولوية فرعية عند تساوي وقت/تسلسل التسجيل */
function statementTypePriority(r) {
  if (r.txType === "سماح") return 5;
  if (r.txType === "قبض فوري" || r.txType === "دفع فوري") return 4;
  if (r.txType === "سند قبض" || r.txType === "سند دفع") {
    return r._paySort ?? (r._invoiceLinked ? 2 : 3);
  }
  if (String(r.txType || "").includes("مرتجع")) return 1;
  return 0;
}

/** ترتيب تصاعدي: الأقدم تسجيلاً يظهر أولاً */
function compareStatementRows(a, b) {
  const ta = effectiveSortDateTime(a);
  const tb = effectiveSortDateTime(b);
  const cmp = ta.localeCompare(tb);
  if (cmp !== 0) return cmp;

  const seqA = Number(a.txSeq ?? a.docNo);
  const seqB = Number(b.txSeq ?? b.docNo);
  if (Number.isFinite(seqA) && Number.isFinite(seqB) && seqA !== seqB) return seqA - seqB;

  const refA = Number(a.txRef ?? a.docNo) || 0;
  const refB = Number(b.txRef ?? b.docNo) || 0;
  if (refA !== refB) return refA - refB;

  const tp = statementTypePriority(a) - statementTypePriority(b);
  if (tp !== 0) return tp;

  return (a._cashSort || 0) - (b._cashSort || 0);
}

function sortStatementRows(rows) {
  return [...rows].sort(compareStatementRows);
}

/** تقرير كشف تفصيلي — حركات قبل الترتيب النهائي */
function pushCashDetailedTransactions(out, tx, partyType) {
  const amt = r2(tx.amount);
  const docNo = tx.docNo;
  const common = {
    docNo,
    date: tx.date,
    note: tx.note || "",
  };

  if (partyType === "CUSTOMER") {
    out.push({
      ...common,
      type: "فاتورة مبيعات (نقدي)",
      side: "debit",
      amount: amt,
      balanceDelta: amt,
      _cashSort: 0,
    });
    out.push({
      ...common,
      type: "قبض فوري",
      side: "credit",
      amount: amt,
      balanceDelta: -amt,
      note: `قبض فوري — فاتورة #${docNo}`,
      _cashSort: 1,
    });
  } else {
    out.push({
      ...common,
      type: "فاتورة شراء (نقدي)",
      side: "credit",
      amount: amt,
      balanceDelta: amt,
      _cashSort: 0,
    });
    out.push({
      ...common,
      type: "دفع فوري",
      side: "debit",
      amount: amt,
      balanceDelta: -amt,
      note: `دفع فوري — فاتورة #${docNo}`,
      _cashSort: 1,
    });
  }
}

function sortDetailedTransactions(transactions) {
  return transactions.sort((a, b) => {
    const d = new Date(a.date) - new Date(b.date);
    if (d !== 0) return d;
    if (a.docNo !== b.docNo) return String(a.docNo).localeCompare(String(b.docNo));
    return (a._cashSort || 0) - (b._cashSort || 0);
  });
}

module.exports = {
  expandCashStatementRows,
  linkInvoicePaymentRows,
  pushCashDetailedTransactions,
  sortDetailedTransactions,
  compareStatementRows,
  sortStatementRows,
};
