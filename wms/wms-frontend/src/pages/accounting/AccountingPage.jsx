// ============================================================
//  AccountingPage.jsx — المحاسبة (شجرة الحسابات + القوائم المالية)
// ============================================================
import { useState, useEffect, useCallback, useMemo } from "react";
import AppLayout from "@/components/layout/AppLayout";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { useNumberLocale } from "@/context/NumberLocaleContext";
import { useCompany } from "@/context/CompanyContext";
import { useAction } from "@/hooks/useApi";
import { openReportPrint } from "@/utils/invoicePrint";
import { accountingService } from "@/services/accountingService";
import Modal from "@/components/ui/Modal";

const today = () => new Date().toISOString().split("T")[0];
const yearStart = () => `${new Date().getFullYear()}-01-01`;

const escHtml = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

async function loadXLSX() {
  if (window.XLSX) return window.XLSX;
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => reject(new Error("فشل تحميل مكتبة Excel"));
    document.head.appendChild(s);
  });
}

async function exportExcel(filename, sheetName, headers, rows) {
  if (!rows?.length && !headers?.length) return alert("لا توجد بيانات للتصدير");
  try {
    const XLSX = await loadXLSX();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
    XLSX.writeFile(wb, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
  } catch (e) {
    alert("خطأ في التصدير: " + e.message);
  }
}

function errMsg(e) {
  return typeof e === "string" ? e : (e?.message || "حدث خطأ");
}

function RangePlaceholder() {
  return (
    <div style={{ padding: 48, textAlign: "center", color: "var(--text-muted)", fontSize: ".9rem" }}>
      حدد <strong>من تاريخ</strong> و<strong>إلى تاريخ</strong> ثم اضغط <strong>عرض البيانات</strong>
    </div>
  );
}

function fmtAcct(n, fmtC) {
  const v = +n || 0;
  if (v < 0) return `(${fmtC(Math.abs(v))})`;
  return fmtC(v);
}

function flattenTree(nodes, depth = 0, out = []) {
  for (const n of nodes || []) {
    out.push({ code: n.AccountCode, name: n.AccountName, balance: n.balance, depth });
    if (n.children?.length) flattenTree(n.children, depth + 1, out);
  }
  return out;
}

const TABS = [
  { id: "chart", label: "شجرة الحسابات" },
  { id: "income", label: "قائمة الدخل" },
  { id: "balance", label: "الميزانية الختامية" },
  { id: "depreciation", label: "الاندثار" },
];

const selectSt = {
  width: "100%",
  padding: "10px 14px",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border)",
  background: "var(--bg-input)",
  color: "var(--text-primary)",
  fontSize: ".95rem",
  fontFamily: "inherit",
  fontWeight: 600,
  cursor: "pointer",
  outline: "none",
};

const emptyAssetForm = () => ({
  AssetName: "", id_GL_Account: "", AcquisitionCost: "", AcquisitionDate: today(), UsefulLifeMonths: "60",
});

const cardSt = {
  background: "var(--bg-card)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  padding: "14px 18px",
};

const thSt = {
  padding: "9px 12px",
  textAlign: "right",
  color: "var(--text-muted)",
  fontWeight: 700,
  fontSize: ".68rem",
  textTransform: "uppercase",
  background: "var(--bg-surface)",
  borderBottom: "1px solid var(--border)",
  whiteSpace: "nowrap",
};

const tdSt = {
  padding: "9px 12px",
  borderBottom: "1px solid var(--border-subtle)",
};

function ExportBar({ onExcel, onPrint, disabled }) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <Button variant="ghost" size="sm" onClick={onExcel} disabled={disabled}>📊 Excel</Button>
      <Button variant="ghost" size="sm" onClick={onPrint} disabled={disabled}>🖨 طباعة</Button>
    </div>
  );
}

function TreeNode({ node, depth, fmtC, expanded, toggle, onAccountClick }) {
  const hasKids = node.children?.length > 0;
  const open = expanded[node.AccountCode] !== false;
  const pad = 12 + depth * 18;
  const canDrill = node.AccountCode !== "—";
  return (
    <>
      <tr
        style={{ background: depth % 2 ? "var(--bg-hover)" : "transparent", cursor: canDrill ? "pointer" : "default" }}
        onClick={canDrill && onAccountClick ? () => onAccountClick(node) : undefined}
        title={canDrill ? "اضغط لعرض التفاصيل" : undefined}
      >
        <td style={{ ...tdSt, paddingRight: pad }} onClick={(e) => e.stopPropagation()}>
          {hasKids ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); toggle(node.AccountCode); }}
              style={{
                border: "none", background: "transparent", cursor: "pointer",
                color: "var(--accent)", fontWeight: 800, marginLeft: 6, fontSize: ".75rem",
              }}
            >
              {open ? "▼" : "◀"}
            </button>
          ) : <span style={{ display: "inline-block", width: 18 }} />}
          <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--accent)" }}>{node.AccountCode}</span>
          {" "}{node.AccountName}
          {canDrill && <span style={{ marginRight: 8, fontSize: ".68rem", color: "var(--text-muted)" }}>↗</span>}
        </td>
        <td style={{ ...tdSt, fontFamily: "var(--font-mono)", textAlign: "left", fontWeight: node.BalanceSource === "GROUP" ? 800 : 400 }}>
          {fmtAcct(node.balance, fmtC)}
        </td>
      </tr>
      {hasKids && open && node.children.map((ch) => (
        <TreeNode key={ch.AccountCode} node={ch} depth={depth + 1} fmtC={fmtC} expanded={expanded} toggle={toggle} onAccountClick={onAccountClick} />
      ))}
    </>
  );
}

function ChartTab({ range, fmtC, company }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState({});
  const [detailTarget, setDetailTarget] = useState(null);

  const from = range?.from;
  const to = range?.to;

  const load = useCallback(async () => {
    if (!range) return;
    setLoading(true);
    try {
      const r = await accountingService.getChart({ from: range.from, to: range.to });
      setData(r);
      const exp = {};
      (r?.tree || []).forEach((n) => { exp[n.AccountCode] = true; });
      setExpanded(exp);
    } catch (e) {
      alert(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => { load(); }, [load]);

  const toggle = (code) => setExpanded((p) => ({ ...p, [code]: !p[code] }));

  const rows = useMemo(() => flattenTree(data?.tree), [data]);

  const doPrint = () => {
    if (!rows.length) return alert("لا توجد بيانات");
    const tbody = rows.map((r, i) =>
      `<tr style="background:${i % 2 ? "#f1f5f9" : "#fff"}">
        <td style="padding-right:${12 + r.depth * 18}px">${escHtml(r.code)} — ${escHtml(r.name)}</td>
        <td>${escHtml(fmtAcct(r.balance, fmtC))}</td>
      </tr>`
    ).join("");
    openReportPrint({
      title: "شجرة الحسابات — النظام المحاسبي العراقي الموحد",
      subtitle: `${from} — ${to}`,
      company: company || {},
      tableHtml: `<table class="items"><thead><tr><th>الحساب</th><th>الرصيد</th></tr></thead><tbody>${tbody}</tbody></table>`,
    });
  };

  const doExcel = () => exportExcel(
    "شجرة_الحسابات",
    "الشجرة",
    ["رمز الحساب", "اسم الحساب", "الرصيد"],
    rows.map((r) => [r.code, r.name, r.balance])
  );

  if (!range) return <RangePlaceholder />;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div style={{ fontSize: ".82rem", color: "var(--text-muted)" }}>
          الفترة: {from} — {to} · الأرصدة من بيانات النظام التشغيلية
        </div>
        <ExportBar onExcel={doExcel} onPrint={doPrint} disabled={loading || !rows.length} />
      </div>
      {loading ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>جاري التحميل...</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".84rem" }}>
            <thead><tr>
              <th style={thSt}>الحساب</th>
              <th style={{ ...thSt, textAlign: "left" }}>الرصيد</th>
            </tr></thead>
            <tbody>
              {(data?.tree || []).map((n) => (
                <TreeNode
                  key={n.AccountCode}
                  node={n}
                  depth={0}
                  fmtC={fmtC}
                  expanded={expanded}
                  toggle={toggle}
                  onAccountClick={(node) => setDetailTarget({ code: node.AccountCode, label: `${node.AccountCode} — ${node.AccountName}` })}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {detailTarget && range && (
        <AccountDetailsModal
          target={detailTarget}
          range={range}
          fmtC={fmtC}
          company={company}
          onClose={() => setDetailTarget(null)}
        />
      )}
    </div>
  );
}

function StatementLines({ lines, fmtC, onLineClick }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".84rem" }}>
      <thead><tr>
        <th style={thSt}>رمز</th>
        <th style={thSt}>البند</th>
        <th style={{ ...thSt, textAlign: "left" }}>المبلغ</th>
      </tr></thead>
      <tbody>
        {(lines || []).map((ln, i) => {
          const clickable = ln.clickable && typeof onLineClick === "function";
          return (
          <tr
            key={i}
            onClick={clickable ? () => onLineClick(ln) : undefined}
            style={{
              background: ln.bold ? "var(--accent-glow)" : i % 2 ? "var(--bg-hover)" : "transparent",
              fontWeight: ln.bold ? 800 : 400,
              cursor: clickable ? "pointer" : "default",
            }}
            title={clickable ? "اضغط لعرض التفاصيل" : undefined}
          >
            <td style={{ ...tdSt, fontFamily: "var(--font-mono)", color: "var(--accent)" }}>{ln.code}</td>
            <td style={tdSt}>
              {ln.label}
              {ln.nonCash && <span style={{ marginRight: 8, fontSize: ".7rem", color: "var(--warning)" }}>(غير نقدي)</span>}
              {ln.infoOnly && <span style={{ marginRight: 8, fontSize: ".7rem", color: "var(--text-muted)" }}>(إعلامي)</span>}
              {clickable && <span style={{ marginRight: 8, fontSize: ".7rem", color: "var(--accent)" }}>↗ تفاصيل</span>}
            </td>
            <td style={{ ...tdSt, fontFamily: "var(--font-mono)", textAlign: "left" }}>{fmtAcct(ln.amount, fmtC)}</td>
          </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const taxColTh = {
  invoice:  { ...thSt, width: "12%", textAlign: "center" },
  material: { ...thSt, width: "40%" },
  qty:      { ...thSt, width: "12%", textAlign: "center" },
  type:     { ...thSt, width: "36%" },
};
const taxColTd = {
  invoice:  { ...tdSt, fontFamily: "var(--font-mono)", textAlign: "center", verticalAlign: "middle", fontWeight: 800, color: "var(--accent)" },
  material: { ...tdSt, verticalAlign: "middle" },
  qty:      { ...tdSt, fontFamily: "var(--font-mono)", textAlign: "center", verticalAlign: "middle", fontWeight: 700 },
  type:     { ...tdSt, verticalAlign: "middle", color: "var(--text-secondary)" },
};

function buildGeneralTaxPrintTable(data, fmtC, fmtAcct) {
  const blocks = (data?.invoices || []).map((inv) => {
    const lineRows = inv.lines.map((ln, i) =>
      `<tr style="background:${i % 2 ? "#f8fafc" : "#fff"}">
        <td class="n" style="text-align:center;font-weight:800;color:#1d4ed8">#${escHtml(inv.id_NoFIN)}</td>
        <td>${escHtml(ln.MaterialName)}</td>
        <td class="n" style="text-align:center">${escHtml(ln.AmountIN)}</td>
        <td>${escHtml(ln.TypeName || "—")}</td>
      </tr>`
    ).join("");
    return `
      <div style="margin-bottom:22px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
        <div style="padding:10px 14px;background:#f1f5f9;border-bottom:1px solid #e2e8f0;display:flex;flex-wrap:wrap;gap:16px;justify-content:space-between;font-size:.88rem">
          <div><strong>فاتورة #${escHtml(inv.id_NoFIN)}</strong> — ${escHtml(inv.Date_FIN)}<br/>
            <span style="color:#64748b">المورد: ${escHtml(inv.AmilName)}</span></div>
          <div><span style="color:#64748b">رقم السيارة:</span> <strong>${escHtml(inv.VehicleNumber || "—")}</strong></div>
          <div><span style="color:#64748b">الظريبة:</span> <strong>${escHtml(fmtAcct(inv.GeneralTax, fmtC))}</strong></div>
        </div>
        <table class="items" style="margin:0">
          <thead><tr>
            <th style="text-align:center;width:90px">الفاتورة</th>
            <th style="text-align:right">المادة</th>
            <th style="text-align:center;width:90px">الكمية</th>
            <th style="text-align:right">النوعية</th>
          </tr></thead>
          <tbody>${lineRows}</tbody>
        </table>
      </div>`;
  }).join("");

  return `
    <div style="margin-bottom:16px;padding:12px 16px;background:#eff6ff;border:1px solid #93c5fd;border-radius:8px;font-weight:700">
      مجموع الظريبة (حـ/ 39): ${escHtml(fmtAcct(data.total, fmtC))}
    </div>
    ${blocks}
    ${data.note ? `<p style="font-size:.78rem;color:#64748b;margin-top:8px">${escHtml(data.note)}</p>` : ""}`;
}

function buildGeneralTaxExcelRows(data) {
  const rows = [
    ["تفاصيل الظريبة العامة"],
    [`الفترة: ${data.period?.from || ""} — ${data.period?.to || ""}`],
    [`مجموع الظريبة (حـ/ 39)`, data.total],
    [],
    ["رقم الفاتورة", "التاريخ", "المورد", "رقم السيارة", "الظريبة", "المادة", "الكمية", "النوعية"],
  ];
  for (const inv of data?.invoices || []) {
    inv.lines.forEach((ln, idx) => {
      rows.push([
        idx === 0 ? inv.id_NoFIN : "",
        idx === 0 ? inv.Date_FIN : "",
        idx === 0 ? inv.AmilName : "",
        idx === 0 ? (inv.VehicleNumber || "—") : "",
        idx === 0 ? inv.GeneralTax : "",
        ln.MaterialName,
        ln.AmountIN,
        ln.TypeName || "—",
      ]);
    });
  }
  return rows;
}

function GeneralTaxDetailsModal({ range, fmtC, company, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await accountingService.getGeneralTaxDetails({ from: range.from, to: range.to });
        if (!cancelled) setData({ ...r, period: r.period || range });
      } catch (e) {
        if (!cancelled) alert(errMsg(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [range]);

  const doPrint = () => {
    if (!data?.invoices?.length) return alert("لا توجد بيانات للطباعة");
    openReportPrint({
      title: "تفاصيل الظريبة العامة (حـ/ 39)",
      subtitle: `الفترة: ${range.from} — ${range.to}`,
      company: company || {},
      tableHtml: buildGeneralTaxPrintTable(data, fmtC, fmtAcct),
    });
  };

  const doExcel = async () => {
    if (!data?.invoices?.length) return alert("لا توجد بيانات للتصدير");
    try {
      const XLSX = await loadXLSX();
      const ws = XLSX.utils.aoa_to_sheet(buildGeneralTaxExcelRows(data));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "الظريبة العامة".slice(0, 31));
      XLSX.writeFile(wb, `ظريبة_عامة_${range.from}_${range.to}.xlsx`);
    } catch (e) {
      alert("خطأ في التصدير: " + e.message);
    }
  };

  return (
    <Modal
      title={`تفاصيل الظريبة العامة — ${range.from} إلى ${range.to}`}
      onClose={onClose}
      width="min(920px, 96vw)"
    >
      <div style={{ padding: "0 4px 8px" }}>
        {!loading && data?.invoices?.length > 0 && (
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <Button variant="ghost" size="sm" onClick={doExcel}>📊 Excel</Button>
            <Button variant="ghost" size="sm" onClick={doPrint}>🖨 طباعة</Button>
          </div>
        )}
        {loading ? (
          <div style={{ padding: 32, textAlign: "center", color: "var(--text-muted)" }}>جاري التحميل...</div>
        ) : !data?.invoices?.length ? (
          <div style={{ padding: 32, textAlign: "center", color: "var(--text-muted)" }}>لا توجد ظريبة مسجّلة في هذه الفترة</div>
        ) : (
          <>
            <div style={{ ...cardSt, marginBottom: 14, borderColor: "var(--accent)" }}>
              <strong>مجموع الظريبة (حـ/ 39):</strong>{" "}
              <span style={{ fontFamily: "var(--font-mono)", fontWeight: 900, color: "var(--accent)" }}>{fmtAcct(data.total, fmtC)}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14, maxHeight: "60vh", overflowY: "auto" }}>
              {data.invoices.map((inv) => (
                <div key={inv.id_NoFIN} style={{ ...cardSt, padding: 0, overflow: "hidden" }}>
                  <div style={{
                    padding: "12px 16px",
                    background: "var(--bg-surface)",
                    borderBottom: "1px solid var(--border-subtle)",
                    display: "grid",
                    gridTemplateColumns: "1fr auto auto",
                    gap: "8px 20px",
                    alignItems: "start",
                  }}>
                    <div>
                      <div style={{ fontWeight: 800, marginBottom: 4 }}>فاتورة #{inv.id_NoFIN} — {inv.Date_FIN}</div>
                      <div style={{ fontSize: ".78rem", color: "var(--text-muted)" }}>المورد: {inv.AmilName}</div>
                    </div>
                    <div style={{ textAlign: "center", minWidth: 100 }}>
                      <div style={{ fontSize: ".68rem", fontWeight: 700, color: "var(--text-muted)", marginBottom: 4 }}>رقم السيارة</div>
                      <div style={{ fontFamily: "var(--font-mono)", fontWeight: 800, color: "var(--accent)" }}>{inv.VehicleNumber || "—"}</div>
                    </div>
                    <div style={{ textAlign: "left", minWidth: 110 }}>
                      <div style={{ fontSize: ".68rem", fontWeight: 700, color: "var(--text-muted)", marginBottom: 4 }}>الظريبة</div>
                      <div style={{ fontFamily: "var(--font-mono)", fontWeight: 900 }}>{fmtAcct(inv.GeneralTax, fmtC)}</div>
                    </div>
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".82rem", tableLayout: "fixed" }}>
                      <colgroup>
                        <col style={{ width: "12%" }} />
                        <col style={{ width: "38%" }} />
                        <col style={{ width: "12%" }} />
                        <col style={{ width: "38%" }} />
                      </colgroup>
                      <thead>
                        <tr>
                          <th style={taxColTh.invoice}>الفاتورة</th>
                          <th style={taxColTh.material}>المادة</th>
                          <th style={taxColTh.qty}>الكمية</th>
                          <th style={taxColTh.type}>النوعية</th>
                        </tr>
                      </thead>
                      <tbody>
                        {inv.lines.map((ln, idx) => (
                          <tr key={idx} style={{ background: idx % 2 ? "var(--bg-hover)" : "transparent" }}>
                            <td style={taxColTd.invoice}>#{inv.id_NoFIN}</td>
                            <td style={taxColTd.material}>{ln.MaterialName}</td>
                            <td style={taxColTd.qty}>{ln.AmountIN}</td>
                            <td style={taxColTd.type}>{ln.TypeName || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
            {data.note && (
              <div style={{ marginTop: 12, fontSize: ".74rem", color: "var(--text-muted)", lineHeight: 1.45 }}>{data.note}</div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function AccountDetailsModal({ target, range, fmtC, company, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const params = {
          from: range.from,
          to: range.to,
          asOf: range.to,
          code: target.code,
          section: target.detailSection || target.section || undefined,
        };
        const r = await accountingService.getAccountDetails(params);
        if (!cancelled) setData(r);
      } catch (e) {
        if (!cancelled) alert(errMsg(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [target, range]);

  const renderTable = (sec) => {
    const cols = sec.columnLabels || ["التاريخ", "البيان", "المبلغ", "ملاحظة"];
    const keys = sec.columns || ["txDate", "description", "amount", "note"];
    return (
      <div key={sec.title} style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 800, marginBottom: 8, fontSize: ".88rem", color: "var(--accent)" }}>{sec.title}</div>
        {!sec.rows?.length ? (
          <div style={{ padding: 16, color: "var(--text-muted)", fontSize: ".82rem" }}>لا توجد حركات في هذه الفترة</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".82rem" }}>
              <thead>
                <tr>{cols.map((h, i) => <th key={i} style={thSt}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {sec.rows.map((row, i) => (
                  <tr key={i} style={{ background: i % 2 ? "var(--bg-hover)" : "transparent" }}>
                    {keys.map((k, j) => (
                      <td key={j} style={{ ...tdSt, fontFamily: k === "amount" || k === "unitCost" ? "var(--font-mono)" : "inherit", textAlign: k === "amount" || k === "unitCost" ? "left" : "right" }}>
                        {k === "amount" || k === "unitCost" ? fmtAcct(row[k], fmtC) : (row[k] ?? "—")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: "var(--bg-surface)", fontWeight: 800 }}>
                  <td colSpan={keys.length - 1} style={tdSt}>المجموع</td>
                  <td style={{ ...tdSt, fontFamily: "var(--font-mono)", textAlign: "left" }}>{fmtAcct(sec.total, fmtC)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    );
  };

  const doPrint = () => {
    if (!data?.sections?.length && !data?.rows?.length) return alert("لا توجد بيانات للطباعة");
    const sections = data.sections?.length ? data.sections : [{
      title: `${data.account?.code} — ${data.account?.name}`,
      columnLabels: data.columnLabels,
      columns: data.columns,
      rows: data.rows,
      total: data.total,
    }];
    const html = sections.map((sec) => {
      const keys = sec.columns || ["txDate", "description", "amount", "note"];
      const head = (sec.columnLabels || []).map((h) => `<th>${escHtml(h)}</th>`).join("");
      const body = (sec.rows || []).map((row, i) =>
        `<tr style="background:${i % 2 ? "#f1f5f9" : "#fff"}">${keys.map((k) =>
          `<td>${escHtml(k === "amount" || k === "unitCost" ? fmtAcct(row[k], fmtC) : row[k])}</td>`
        ).join("")}</tr>`
      ).join("");
      return `<h3 style="margin:16px 0 8px;color:#1d4ed8">${escHtml(sec.title)}</h3>
        <table class="items"><thead><tr>${head}</tr></thead><tbody>${body}</tbody>
        <tfoot><tr><td colspan="${keys.length - 1}"><strong>المجموع</strong></td><td>${escHtml(fmtAcct(sec.total, fmtC))}</td></tr></tfoot></table>`;
    }).join("");
    openReportPrint({
      title: `تفاصيل الحساب: ${target.label || data.account?.name}`,
      subtitle: `${range.from} — ${range.to}`,
      company: company || {},
      tableHtml: html,
    });
  };

  const doExcel = async () => {
    const sections = data?.sections?.length ? data.sections : [{
      title: "التفاصيل",
      columnLabels: data?.columnLabels,
      rows: data?.rows,
    }];
    const rows = [[`تفاصيل: ${target.label}`], [`${range.from} — ${range.to}`], []];
    for (const sec of sections) {
      rows.push([sec.title], sec.columnLabels || [], ...(sec.rows || []).map((r) =>
        (sec.columns || ["txDate", "description", "amount", "note"]).map((k) => r[k])
      ), []);
    }
    try {
      const XLSX = await loadXLSX();
      const ws = XLSX.utils.aoa_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "تفاصيل".slice(0, 31));
      XLSX.writeFile(wb, `تفاصيل_${target.code}_${range.from}_${range.to}.xlsx`);
    } catch (e) {
      alert("خطأ في التصدير: " + e.message);
    }
  };

  const sections = data?.sections?.filter((s) => s.rows?.length) || [];
  const hasData = sections.length > 0 || data?.rows?.length > 0;

  return (
    <Modal
      title={`تفاصيل: ${target.label || target.code} — ${range.from} إلى ${range.to}`}
      onClose={onClose}
      width="min(920px, 96vw)"
    >
      <div style={{ padding: "0 4px 8px" }}>
        {!loading && hasData && (
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <Button variant="ghost" size="sm" onClick={doExcel}>📊 Excel</Button>
            <Button variant="ghost" size="sm" onClick={doPrint}>🖨 طباعة</Button>
          </div>
        )}
        {loading ? (
          <div style={{ padding: 32, textAlign: "center", color: "var(--text-muted)" }}>جاري التحميل...</div>
        ) : !hasData ? (
          <div style={{ padding: 32, textAlign: "center", color: "var(--text-muted)" }}>لا توجد تفاصيل مرتبطة في هذه الفترة</div>
        ) : sections.length ? (
          <>
            {data.total != null && (
              <div style={{ ...cardSt, marginBottom: 14, borderColor: "var(--accent)" }}>
                <strong>إجمالي المعروض:</strong>{" "}
                <span style={{ fontFamily: "var(--font-mono)", fontWeight: 900, color: "var(--accent)" }}>{fmtAcct(data.total, fmtC)}</span>
              </div>
            )}
            <div style={{ maxHeight: "60vh", overflowY: "auto" }}>
              {sections.map(renderTable)}
            </div>
          </>
        ) : (
          renderTable({
            title: `${data.account?.code} — ${data.account?.name}`,
            columnLabels: data.columnLabels,
            columns: data.columns,
            rows: data.rows,
            total: data.total,
          })
        )}
      </div>
    </Modal>
  );
}

function IncomeTab({ range, fmtC, company }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [taxModalOpen, setTaxModalOpen] = useState(false);
  const [detailTarget, setDetailTarget] = useState(null);

  const load = useCallback(async () => {
    if (!range) return;
    setLoading(true);
    try {
      const r = await accountingService.getIncomeStatement({ from: range.from, to: range.to });
      setData(r);
    } catch (e) { alert(errMsg(e)); }
    finally { setLoading(false); }
  }, [range]);

  useEffect(() => { load(); }, [load]);

  const from = range?.from;
  const to = range?.to;

  const doPrint = () => {
    const rows = (data?.lines || []).map((ln) =>
      `<tr><td>${escHtml(ln.code)}</td><td>${escHtml(ln.label)}</td><td>${escHtml(fmtAcct(ln.amount, fmtC))}</td></tr>`
    ).join("");
    openReportPrint({
      title: "قائمة الدخل (الأرباح والخسائر)",
      subtitle: `${from} — ${to}`,
      company: company || {},
      tableHtml: `<table class="items"><thead><tr><th>رمز</th><th>البند</th><th>المبلغ</th></tr></thead><tbody>${rows}</tbody></table>`,
    });
  };

  const doExcel = () => exportExcel(
    "قائمة_الدخل",
    "قائمة الدخل",
    ["رمز", "البند", "المبلغ"],
    (data?.lines || []).map((ln) => [ln.code, ln.label, ln.amount])
  );

  if (!range) return <RangePlaceholder />;
  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>جاري التحميل...</div>;

  return (
    <div>
      <div style={{ fontSize: ".82rem", color: "var(--text-muted)", marginBottom: 12 }}>
        الفترة: {from} — {to}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
        <ExportBar onExcel={doExcel} onPrint={doPrint} />
      </div>
      <StatementLines
        lines={data?.lines}
        fmtC={fmtC}
        onLineClick={(ln) => {
          if (ln.section === "tax") setTaxModalOpen(true);
          else if (ln.clickable) setDetailTarget({ code: ln.code, label: ln.label, section: ln.section, detailSection: ln.detailSection });
        }}
      />
      {taxModalOpen && range && (
        <GeneralTaxDetailsModal range={range} fmtC={fmtC} company={company} onClose={() => setTaxModalOpen(false)} />
      )}
      {detailTarget && range && (
        <AccountDetailsModal
          target={detailTarget}
          range={range}
          fmtC={fmtC}
          company={company}
          onClose={() => setDetailTarget(null)}
        />
      )}
      {data?.summary?.netProfit != null && (
        <div style={{ ...cardSt, marginTop: 16, borderColor: data.summary.netProfit >= 0 ? "var(--success)" : "var(--danger)" }}>
          <strong>صافي الربح / الخسارة الخاضع للضريبة:</strong>{" "}
          <span style={{ fontFamily: "var(--font-mono)", fontWeight: 900 }}>{fmtAcct(data.summary.netProfit, fmtC)}</span>
        </div>
      )}
    </div>
  );
}

function BalanceTab({ range, fmtC, company }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [detailTarget, setDetailTarget] = useState(null);
  const [showImbalance, setShowImbalance] = useState(false);

  const load = useCallback(async () => {
    if (!range) return;
    setLoading(true);
    try {
      const r = await accountingService.getBalanceSheet({ from: range.from, to: range.to });
      setData(r);
    } catch (e) { alert(errMsg(e)); }
    finally { setLoading(false); }
  }, [range]);

  useEffect(() => { load(); }, [load]);

  const from = range?.from;
  const to = range?.to;

  const doPrint = () => {
    const assetRows = (data?.assets || []).map((ln) =>
      `<tr><td>${escHtml(ln.code)}</td><td>${escHtml(ln.label)}</td><td>${escHtml(fmtAcct(ln.amount, fmtC))}</td></tr>`
    ).join("");
    const liabRows = (data?.liabilitiesEquity || []).map((ln) =>
      `<tr><td>${escHtml(ln.code)}</td><td>${escHtml(ln.label)}</td><td>${escHtml(fmtAcct(ln.amount, fmtC))}</td></tr>`
    ).join("");
    openReportPrint({
      title: "الميزانية الختامية",
      subtitle: `من ${from} إلى ${to}`,
      company: company || {},
      tableHtml: `
        <h3>الموجودات</h3>
        <table class="items"><thead><tr><th>رمز</th><th>البند</th><th>المبلغ</th></tr></thead><tbody>${assetRows}</tbody></table>
        <h3 style="margin-top:20px">المطلوبات وحقوق الملكية</h3>
        <table class="items"><thead><tr><th>رمز</th><th>البند</th><th>المبلغ</th></tr></thead><tbody>${liabRows}</tbody></table>`,
    });
  };

  const doExcel = () => {
    const rows = [
      ["══ الموجودات ══", "", ""],
      ...(data?.assets || []).map((ln) => [ln.code, ln.label, ln.amount]),
      ["", "", ""],
      ["══ المطلوبات وحقوق الملكية ══", "", ""],
      ...(data?.liabilitiesEquity || []).map((ln) => [ln.code, ln.label, ln.amount]),
    ];
    exportExcel("الميزانية_الختامية", "الميزانية", ["رمز", "البند", "المبلغ"], rows);
  };

  if (!range) return <RangePlaceholder />;
  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>جاري التحميل...</div>;

  const balanced = data?.summary?.balanced;
  const imbalance = data?.imbalanceAnalysis;

  return (
    <div>
      <div style={{ fontSize: ".82rem", color: "var(--text-muted)", marginBottom: 12 }}>
        الفترة: {from} — {to}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div
          role={!balanced && imbalance ? "button" : undefined}
          tabIndex={!balanced && imbalance ? 0 : undefined}
          onClick={() => { if (!balanced && imbalance) setShowImbalance(true); }}
          onKeyDown={(e) => { if (!balanced && imbalance && (e.key === "Enter" || e.key === " ")) setShowImbalance(true); }}
          style={{
          ...cardSt, padding: "8px 14px", flex: "1 1 200px",
          borderColor: balanced ? "var(--success)" : "var(--warning)",
          background: balanced ? "var(--success-bg, rgba(34,197,94,.08))" : "var(--warning-bg)",
          cursor: !balanced && imbalance ? "pointer" : "default",
        }}>
          {balanced
            ? "✓ الميزانية متوازنة"
            : (
              <>
                ⚠ فرق التوازن: {fmtAcct(data?.summary?.difference, fmtC)}
                {imbalance && (
                  <span style={{ display: "block", fontSize: ".72rem", marginTop: 4, color: "var(--text-muted)" }}>
                    انقر لعرض تحليل الفرق
                  </span>
                )}
              </>
            )}
        </div>
        <ExportBar onExcel={doExcel} onPrint={doPrint} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <Card padding="0">
          <div style={{ padding: "12px 16px", fontWeight: 800, borderBottom: "1px solid var(--border-subtle)" }}>الموجودات (1)</div>
          <StatementLines
            lines={data?.assets}
            fmtC={fmtC}
            onLineClick={(ln) => ln.clickable && ln.code !== "—" && setDetailTarget({ code: ln.code, label: ln.label })}
          />
        </Card>
        <Card padding="0">
          <div style={{ padding: "12px 16px", fontWeight: 800, borderBottom: "1px solid var(--border-subtle)" }}>المطلوبات وحقوق الملكية (2)</div>
          <StatementLines
            lines={data?.liabilitiesEquity}
            fmtC={fmtC}
            onLineClick={(ln) => ln.clickable && ln.code !== "—" && setDetailTarget({ code: ln.code, label: ln.label })}
          />
        </Card>
      </div>
      {detailTarget && range && (
        <AccountDetailsModal
          target={detailTarget}
          range={range}
          fmtC={fmtC}
          company={company}
          onClose={() => setDetailTarget(null)}
        />
      )}
      {showImbalance && imbalance && (
        <ImbalanceAnalysisModal
          analysis={imbalance}
          fmtC={fmtC}
          onClose={() => setShowImbalance(false)}
        />
      )}
    </div>
  );
}

function ImbalanceAnalysisModal({ analysis, fmtC, onClose }) {
  const diffAbs = Math.abs(analysis.difference || 0);
  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9000,
        background: "rgba(0,0,0,.55)", display: "flex",
        alignItems: "center", justifyContent: "center", padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "min(520px, 100%)", maxHeight: "90vh", overflow: "auto",
          background: "var(--bg-card)", border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)", boxShadow: "0 20px 60px rgba(0,0,0,.35)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "14px 18px", borderBottom: "1px solid var(--border-subtle)",
        }}>
          <div style={{ fontWeight: 800 }}>تحليل فرق التوازن</div>
          <button type="button" onClick={onClose} style={{
            background: "none", border: "none", cursor: "pointer",
            fontSize: "1.2rem", color: "var(--text-muted)",
          }}>✕</button>
        </div>
        <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{
            padding: "12px 14px", borderRadius: "var(--radius-md)",
            background: "var(--warning-bg)", border: "1px solid var(--warning)",
            fontWeight: 700, textAlign: "center",
          }}>
            فرق التوازن: {fmtAcct(analysis.difference, fmtC)}
            <div style={{ fontSize: ".78rem", fontWeight: 500, marginTop: 4, color: "var(--text-secondary)" }}>
              الموجودات {fmtAcct(analysis.totalAssets, fmtC)} − المطلوبات وحقوق الملكية {fmtAcct(analysis.totalLiabilitiesEquity, fmtC)}
            </div>
          </div>

          <div>
            <div style={{ fontSize: ".72rem", fontWeight: 700, color: "var(--text-muted)", marginBottom: 8 }}>تفصيل الموجودات</div>
            {(analysis.assetBreakdown || []).map((row) => (
              <div key={row.label} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: ".84rem" }}>
                <span>{row.label}</span>
                <span style={{ fontFamily: "var(--font-mono)" }}>{fmtAcct(row.amount, fmtC)}</span>
              </div>
            ))}
          </div>

          <div>
            <div style={{ fontSize: ".72rem", fontWeight: 700, color: "var(--text-muted)", marginBottom: 8 }}>تفصيل المطلوبات وحقوق الملكية</div>
            {(analysis.liabilitiesBreakdown || []).map((row) => (
              <div key={row.label} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: ".84rem" }}>
                <span>{row.label}</span>
                <span style={{ fontFamily: "var(--font-mono)" }}>{fmtAcct(row.amount, fmtC)}</span>
              </div>
            ))}
          </div>

          {analysis.incomeStatement && (
            <div style={{
              padding: "10px 12px", borderRadius: "var(--radius-md)",
              background: "var(--bg-surface)", border: "1px solid var(--border-subtle)",
              fontSize: ".82rem", lineHeight: 1.7,
            }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>قائمة الدخل (نفس الفترة)</div>
              <div>صافي المبيعات: {fmtAcct(analysis.incomeStatement.netSales, fmtC)}</div>
              <div>مجمل الربح: {fmtAcct(analysis.incomeStatement.grossProfit, fmtC)}</div>
              <div>صافي الربح المُدرَج في الميزانية: {fmtAcct(analysis.incomeStatement.netProfit, fmtC)}</div>
            </div>
          )}

          {(analysis.hints || []).length > 0 && (
            <div style={{ fontSize: ".8rem", color: "var(--text-secondary)", lineHeight: 1.65 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>ملاحظات محتملة</div>
              <ul style={{ margin: 0, paddingRight: 18 }}>
                {analysis.hints.map((h) => <li key={h}>{h}</li>)}
              </ul>
            </div>
          )}

          {diffAbs >= 1 && (
            <div style={{ fontSize: ".75rem", color: "var(--text-muted)", lineHeight: 1.5 }}>
              راجع تفاصيل الحسابات (113، 114، 13، 16، 18، 21، 26، 218) من الجدول بالنقر على البند للمقارنة مع الدفاتر.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DepreciationTab({ fmtC }) {
  const { execute, loading: saving } = useAction();
  const [entries, setEntries] = useState([]);
  const [assets, setAssets] = useState([]);
  const [glAccounts, setGlAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingAssetId, setEditingAssetId] = useState(null);
  const [form, setForm] = useState({ Amount: "", EntryDate: today(), id_Asset: "", Note: "" });
  const [assetForm, setAssetForm] = useState(emptyAssetForm());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [dep, ast, gl] = await Promise.all([
        accountingService.listDepreciation(),
        accountingService.listAssets(),
        accountingService.listGlAccounts(),
      ]);
      setEntries(dep?.data || []);
      setAssets(ast?.data || []);
      const fixedGl = (gl?.data || []).filter((g) => ["113", "114"].includes(g.AccountCode));
      setGlAccounts(fixedGl);
    } catch (e) { alert(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const resetAssetForm = () => {
    setEditingAssetId(null);
    setAssetForm(emptyAssetForm());
  };

  const startEditAsset = (a) => {
    setEditingAssetId(a.id_Asset);
    setAssetForm({
      AssetName: a.AssetName || "",
      id_GL_Account: String(a.id_GL_Account || ""),
      AcquisitionCost: String(a.AcquisitionCost ?? ""),
      AcquisitionDate: a.AcquisitionDate || today(),
      UsefulLifeMonths: String(a.UsefulLifeMonths ?? "60"),
    });
  };

  const submitDep = async (e) => {
    e.preventDefault();
    if (!form.Amount || +form.Amount <= 0) return alert("أدخل مبلغ الاندثار");
    await execute(() => accountingService.createDepreciation({
      Amount: +form.Amount,
      EntryDate: form.EntryDate,
      id_Asset: form.id_Asset || null,
      Note: form.Note,
    }), {
      onSuccess: () => { setForm({ Amount: "", EntryDate: today(), id_Asset: "", Note: "" }); load(); },
      onError: (err) => alert(errMsg(err)),
    });
  };

  const submitAsset = async (e) => {
    e.preventDefault();
    if (!assetForm.AssetName || !assetForm.id_GL_Account) return alert("اسم الأصل والحساب مطلوبان");
    const payload = {
      ...assetForm,
      AcquisitionCost: +assetForm.AcquisitionCost || 0,
      UsefulLifeMonths: +assetForm.UsefulLifeMonths || 60,
    };
    const fn = editingAssetId
      ? () => accountingService.updateAsset(editingAssetId, payload)
      : () => accountingService.createAsset(payload);
    await execute(fn, {
      onSuccess: () => { resetAssetForm(); load(); },
      onError: (err) => alert(errMsg(err)),
    });
  };

  const removeEntry = async (id) => {
    if (!confirm("حذف قيد الاندثار؟")) return;
    await execute(() => accountingService.removeDepreciation(id), { onSuccess: load, onError: (e) => alert(errMsg(e)) });
  };

  const removeAsset = async (id, name) => {
    if (!confirm(`حذف الأصل "${name}"؟`)) return;
    await execute(() => accountingService.removeAsset(id), {
      onSuccess: () => { if (editingAssetId === id) resetAssetForm(); load(); },
      onError: (e) => alert(errMsg(e)),
    });
  };

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>جاري التحميل...</div>;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 20, alignItems: "start" }}>
      <div>
        <Card style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 800, marginBottom: 12 }}>تسجيل قيد اندثار (غير نقدي)</div>
          <p style={{ fontSize: ".78rem", color: "var(--text-muted)", marginBottom: 14 }}>
            مصروف دفتري — يُطرح من الموجودات الثابتة ولا يخصم من الصندوق (حـ/ 37 و 12)
          </p>
          <form onSubmit={submitDep} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Input label="المبلغ" type="number" min="0" step="0.01" value={form.Amount}
              onChange={(v) => setForm((p) => ({ ...p, Amount: v }))} required />
            <Input label="التاريخ" type="date" value={form.EntryDate}
              onChange={(v) => setForm((p) => ({ ...p, EntryDate: v }))} />
            <label style={{ fontSize: ".85rem", fontWeight: 600, color: "var(--text-secondary)" }}>الأصل (اختياري)</label>
            <select
              value={form.id_Asset}
              onChange={(e) => setForm((p) => ({ ...p, id_Asset: e.target.value }))}
              style={selectSt}
            >
              <option value="" style={{ color: "var(--text-primary)", background: "var(--bg-card)" }}>— عام —</option>
              {assets.map((a) => (
                <option key={a.id_Asset} value={a.id_Asset} style={{ color: "var(--text-primary)", background: "var(--bg-card)" }}>
                  {a.AssetName} ({a.AccountCode})
                </option>
              ))}
            </select>
            <Input label="ملاحظة" value={form.Note} onChange={(v) => setForm((p) => ({ ...p, Note: v }))} />
            <Button type="submit" loading={saving}>تسجيل الاندثار</Button>
          </form>
        </Card>

        <Card>
          <div style={{ fontWeight: 800, marginBottom: 12 }}>
            {editingAssetId ? "تعديل أصل ثابت" : "إضافة أصل ثابت (حـ/ 11)"}
          </div>
          {editingAssetId && (
            <div style={{ fontSize: ".78rem", color: "var(--accent)", marginBottom: 10 }}>
              تعديل الأصل #{editingAssetId} — <button type="button" onClick={resetAssetForm}
                style={{ border: "none", background: "transparent", color: "var(--text-muted)", cursor: "pointer", textDecoration: "underline" }}>
                إلغاء التعديل
              </button>
            </div>
          )}
          <form onSubmit={submitAsset} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Input label="اسم الأصل" value={assetForm.AssetName}
              onChange={(v) => setAssetForm((p) => ({ ...p, AssetName: v }))} required />
            <label style={{ fontSize: ".85rem", fontWeight: 600, color: "var(--text-secondary)" }}>حساب GL</label>
            <select
              value={assetForm.id_GL_Account}
              onChange={(e) => setAssetForm((p) => ({ ...p, id_GL_Account: e.target.value }))}
              required
              style={selectSt}
            >
              <option value="" style={{ color: "var(--text-primary)", background: "var(--bg-card)" }}>اختر الحساب</option>
              {glAccounts.map((g) => (
                <option key={g.id_GL_Account} value={g.id_GL_Account} style={{ color: "var(--text-primary)", background: "var(--bg-card)" }}>
                  {g.AccountCode} — {g.AccountName}
                </option>
              ))}
            </select>
            <Input label="تكلفة الاقتناء" type="number" min="0" value={assetForm.AcquisitionCost}
              onChange={(v) => setAssetForm((p) => ({ ...p, AcquisitionCost: v }))} />
            <Input label="تاريخ الاقتناء" type="date" value={assetForm.AcquisitionDate}
              onChange={(v) => setAssetForm((p) => ({ ...p, AcquisitionDate: v }))} />
            <Input label="العمر الإنتاجي (شهر)" type="number" value={assetForm.UsefulLifeMonths}
              onChange={(v) => setAssetForm((p) => ({ ...p, UsefulLifeMonths: v }))} />
            <div style={{ display: "flex", gap: 8 }}>
              <Button type="submit" loading={saving}>
                {editingAssetId ? "💾 حفظ التعديل" : "إضافة أصل"}
              </Button>
              {editingAssetId && (
                <Button type="button" variant="secondary" onClick={resetAssetForm}>إلغاء</Button>
              )}
            </div>
          </form>
        </Card>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Card padding="0">
          <div style={{ padding: "12px 16px", fontWeight: 800, borderBottom: "1px solid var(--border-subtle)" }}>
            الأصول الثابتة المسجّلة
          </div>
          {!assets.length ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)" }}>لا توجد أصول — أضف أصلاً من النموذج على اليسار</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".84rem" }}>
                <thead><tr>
                  {["الاسم", "GL", "التكلفة", "التاريخ", "العمر", ""].map((h, i) => <th key={i} style={thSt}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {assets.map((a, i) => (
                    <tr key={a.id_Asset} style={{
                      background: editingAssetId === a.id_Asset ? "var(--accent-glow)" : i % 2 ? "var(--bg-hover)" : "transparent",
                    }}>
                      <td style={{ ...tdSt, fontWeight: 700 }}>{a.AssetName}</td>
                      <td style={{ ...tdSt, fontFamily: "var(--font-mono)", color: "var(--accent)" }}>{a.AccountCode}</td>
                      <td style={{ ...tdSt, fontFamily: "var(--font-mono)" }}>{fmtC(a.AcquisitionCost)}</td>
                      <td style={tdSt}>{a.AcquisitionDate}</td>
                      <td style={{ ...tdSt, textAlign: "center" }}>{a.UsefulLifeMonths}</td>
                      <td style={tdSt}>
                        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                          <Button size="sm" variant="secondary" onClick={() => startEditAsset(a)}>✏</Button>
                          <Button size="sm" variant="danger" onClick={() => removeAsset(a.id_Asset, a.AssetName)}>🗑</Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card padding="0">
          <div style={{ padding: "12px 16px", fontWeight: 800, borderBottom: "1px solid var(--border-subtle)" }}>
            سجل قيود الاندثار
          </div>
          {!entries.length ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)" }}>لا توجد قيود</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".84rem" }}>
                <thead><tr>
                  {["التاريخ", "الأصل", "المبلغ", ""].map((h, i) => <th key={i} style={thSt}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {entries.map((r, i) => (
                    <tr key={r.id_Entry} style={{ background: i % 2 ? "var(--bg-hover)" : "transparent" }}>
                      <td style={tdSt}>{r.EntryDate}</td>
                      <td style={tdSt}>{r.AssetName || "— عام —"}</td>
                      <td style={{ ...tdSt, fontFamily: "var(--font-mono)" }}>{fmtC(r.Amount)}</td>
                      <td style={tdSt}>
                        <button type="button" onClick={() => removeEntry(r.id_Entry)}
                          style={{ border: "none", background: "transparent", color: "var(--danger)", cursor: "pointer", fontSize: ".75rem", fontWeight: 700 }}>
                          حذف
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

export default function AccountingPage() {
  const { fmtC } = useNumberLocale();
  const { company } = useCompany();
  const [tab, setTab] = useState("chart");
  const [from, setFrom] = useState(yearStart());
  const [to, setTo] = useState(today());
  const [activeRange, setActiveRange] = useState(null);

  const showRangeBar = tab === "chart" || tab === "income" || tab === "balance";

  const runRangeQuery = () => {
    if (!from || !to) return alert("أدخل تاريخ البداية والنهاية");
    if (from > to) return alert("تاريخ البداية يجب أن يسبق تاريخ النهاية");
    setActiveRange({ from, to });
  };

  return (
    <AppLayout title="المحاسبة">
      {showRangeBar && (
        <div style={{ ...cardSt, marginBottom: 18, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
          <Input label="من تاريخ" type="date" value={from} onChange={setFrom} style={{ width: 160 }} />
          <Input label="إلى تاريخ" type="date" value={to} onChange={setTo} style={{ width: 160 }} />
          <Button onClick={runRangeQuery}>عرض البيانات</Button>
          {activeRange && (
            <span style={{ fontSize: ".78rem", color: "var(--text-muted)", paddingBottom: 8 }}>
              المعروض: {activeRange.from} — {activeRange.to}
            </span>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, marginBottom: 18, flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            style={{
              padding: "8px 16px",
              borderRadius: "var(--radius-full)",
              border: tab === t.id ? "1px solid var(--accent)" : "1px solid var(--border)",
              background: tab === t.id ? "var(--accent-glow)" : "var(--bg-card)",
              color: tab === t.id ? "var(--accent)" : "var(--text-secondary)",
              fontWeight: 700,
              fontSize: ".82rem",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Card>
        {tab === "chart" && <ChartTab range={activeRange} fmtC={fmtC} company={company} />}
        {tab === "income" && <IncomeTab range={activeRange} fmtC={fmtC} company={company} />}
        {tab === "balance" && <BalanceTab range={activeRange} fmtC={fmtC} company={company} />}
        {tab === "depreciation" && <DepreciationTab fmtC={fmtC} />}
      </Card>
    </AppLayout>
  );
}
