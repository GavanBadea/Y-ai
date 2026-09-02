// ============================================================
//  src/pages/pos/POSPage.jsx  — نقطة البيع السريعة
//
//  ✅ إصلاح "السلة فارغة": cartRef داخل المكوّن
//     يُحدَّث داخل setCart updater (متزامن 100%)
//  ✅ فاصل قابل للسحب بين الجانبين
//  ✅ مواد يمين — فاتورة يسار (RTL أصلي)
// ============================================================
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { posService, salesService } from "../../services/api";
import api from "../../services/api";
import { useApi }     from "../../hooks/useApi";
import { useNumberLocale } from "@/context/NumberLocaleContext";
import { useAuth } from "@/context/AuthContext";
import { useCompany } from "@/context/CompanyContext";
import { r2, fmt, fmtN, fmtC } from "@/utils/numFormat";
import { pickInvoiceSellPrice, numFieldNum } from "@/utils/numInput";

// ── أدوات ─────────────────────────────────────────────────
const now  = ()      => new Date().toLocaleString("en-US", { hour12: false });

let _lid = 0;

const scanQtyFromMaterial = (m) => {
  if (m?.scanType === "scale_weight" && (+m.scannedQty || 0) > 0) return r2(+m.scannedQty);
  return 1;
};

const scanPriceFromMaterial = (m) => {
  if (m?.scanType === "scale_price" && (+m.scannedLineTotal || 0) > 0) {
    return numFieldNum(m.scannedLineTotal);
  }
  return numFieldNum(pickInvoiceSellPrice(m));
};

const mkLine = (m) => ({
  _lid    : ++_lid,
  id      : m.id_Material_NoM,
  name    : m.MaterialName,
  barcode : m.Barcode         || "",
  band    : m.Band            || m.Unit || "",
  stock   : m.QuantityOnHand  || 0,
  price   : scanPriceFromMaterial(m),
  qty     : scanQtyFromMaterial(m),
  prices  : (m.priceOptions   || []).filter(p => p.value > 0),
  scanNote: m.scanNote        || null,
});

const QUICK = [5000, 10000, 25000, 50000, 100000, 250000];
const POS_CHANNEL = "wms-pos-customer-display";
const POS_LS_KEY  = "wms-pos-display";

// ============================================================
const escHtml = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export default function POSPage() {
  const navigate = useNavigate();
  const { locale } = useNumberLocale();
  const { user } = useAuth();
  const { company, refresh: refreshCompany } = useCompany();

  useEffect(() => { refreshCompany(); }, [refreshCompany]);
  const { data: init, loading: initLoading, refetch } =
    useApi(() => posService.init(), []);

  const cats    = init?.data?.categories || [];
  const payTps  = init?.data?.payTypes   || [];
  const cstmrs  = init?.data?.customers  || [];

  // ── State ─────────────────────────────────────────────
  const [cart,     setCart    ] = useState([]);
  const [customer, setCustomer] = useState(null);
  const [payType,  setPayType ] = useState(null);
  const [paid,       setPaid      ] = useState("");
  const [paidManual, setPaidManual] = useState(false);
  // ✅ Refs لضمان أحدث قيمة دائماً داخل save() و numpad() بدون Stale Closure
  const paidRef        = useRef("");
  const paidManualRef  = useRef(false);
  paidRef.current      = paid;
  paidManualRef.current = paidManual;
  const [discount, setDiscount] = useState(0);
  const [note,     setNote    ] = useState("");
  const [customerAmt, setCustomerAmt] = useState("");

  // ✅ cartRef — يُحدَّث داخل setCart updater (متزامن مع React)
  // لا يتأثر بـ batching ولا StrictMode ولا cleanup
  const cartRef = useRef([]);

  const syncCart = useCallback((updater) => {
    // ✅ حساب القيمة الجديدة من cartRef الحالي
    const next = typeof updater === "function"
      ? updater(cartRef.current)
      : (Array.isArray(updater) ? updater : []);
    // ✅ تحديث cartRef أولاً — قبل setCart وقبل أي شيء
    cartRef.current = next;
    // ثم React يُعيد الرسم
    setCart([...next]);
  }, []);

  // ── مواد الصنف ────────────────────────────────────────
  const [selCat,   setSelCat  ] = useState(null);
  const [mats,     setMats    ] = useState([]);
  const [loadMats, setLoadMats] = useState(false);

  const loadCat = useCallback(async (cat) => {
    setSelCat(cat);
    setLoadMats(true);
    try   { const r = await posService.getMaterialsByCategory(cat.id_Catiguary); setMats(r?.data || []); }
    catch { setMats([]); }
    finally { setLoadMats(false); }
  }, []);

  useEffect(() => { if (cats.length) loadCat(cats[0]); }, [cats]);

  // ✅ طريقة الدفع الافتراضية — نقد
  useEffect(() => {
    if (!payTps.length || payType) return;
    const cash = payTps.find(p => {
      const n = (p.PayTypeName||"").trim();
      return n==="نقد" || n==="نقدي" || n.toLowerCase()==="cash";
    });
    if (cash) setPayType(cash);
  }, [payTps]);

  // ── باركود ────────────────────────────────────────────
  const bcRef = useRef(null);
  const [bcVal,  setBcVal ] = useState("");
  const [bcMsg,  setBcMsg ] = useState({ txt: "", ok: true });
  const [bcBusy, setBcBusy] = useState(false);

  const [invNo,     setInvNo    ] = useState("");
  const [invNoMsg,  setInvNoMsg ] = useState({ txt: "", ok: true });
  const [invNoBusy, setInvNoBusy] = useState(false);

  const goToInvoice = useCallback(async (raw) => {
    const id = String(raw || "").trim().replace(/^#/, "");
    if (!id || !/^\d+$/.test(id)) {
      setInvNoMsg({ txt: "أدخل رقم فاتورة صحيح", ok: false });
      return;
    }
    setInvNoBusy(true);
    setInvNoMsg({ txt: "", ok: true });
    try {
      await salesService.getOne(id);
      navigate("/invoices-out", { state: { openInvoiceId: Number(id) } });
    } catch {
      setInvNoMsg({ txt: "فاتورة غير موجودة", ok: false });
    } finally {
      setInvNoBusy(false);
      setTimeout(() => setInvNoMsg({ txt: "", ok: true }), 4000);
    }
  }, [navigate]);

  const scan = useCallback(async (val) => {
    const v = (val || "").trim();
    if (!v) return;
    setBcVal(""); setBcBusy(true); setBcMsg({ txt: "", ok: true });
    try {
      const r   = await posService.searchMaterial(v);
      const mat = r?.data;
      if (mat && (r.single || mat.id_Material_NoM)) {
        const addQty = scanQtyFromMaterial(mat);
        syncCart(prev => {
          const i = prev.findIndex(l => l.id === mat.id_Material_NoM);
          return i >= 0
            ? prev.map((l, x) => x === i ? { ...l, qty: r2(l.qty + addQty), price: scanPriceFromMaterial(mat) } : l)
            : [mkLine(mat), ...prev];
        });
        const expNote = mat.expiryWarning?.message ? ` | ${mat.expiryWarning.message}` : "";
        const scaleNote = mat.scanNote ? ` | ${mat.scanNote}` : "";
        setBcMsg({
          txt: `✅ ${mat.MaterialName} — ${fmtC(scanPriceFromMaterial(mat))}${scaleNote}${expNote}`,
          ok: !mat.expiryWarning,
        });
      } else {
        setBcMsg({ txt: `⚠ غير موجود: "${v}"`, ok: false });
      }
    } catch (e) {
      setBcMsg({ txt: (e?.response?.status === 404 || e?.status === 404) ? `⚠ لا نتائج: "${v}"` : `❌ ${e?.message || ""}`, ok: false });
    } finally {
      setBcBusy(false);
      setTimeout(() => setBcMsg({ txt: "", ok: true }), 4000);
      bcRef.current?.focus();
    }
  }, []);

  // ── إضافة مادة بالضغط ────────────────────────────────
  const addItem = useCallback((mat) => {
    syncCart(prev => {
      const i = prev.findIndex(l => l.id === mat.id_Material_NoM);
      return i >= 0
        ? prev.map((l, x) => x === i ? { ...l, qty: r2(l.qty + 1) } : l)
        : [mkLine(mat), ...prev];
    });
  }, []);

  // ── تعديل السلة ──────────────────────────────────────
  const setQty   = (lid, q) => syncCart(p => p.map(l => l._lid===lid ? {...l, qty:Math.max(0.001,r2(+q||1))} : l));
  const setPrc   = (lid, v) => syncCart(p => p.map(l => l._lid===lid ? {...l, price:Math.max(0,+v||0)} : l));
  const rmLine   = (lid)    => syncCart(p => p.filter(l => l._lid !== lid));

  // ── حسابات ───────────────────────────────────────────
  const subtotal = useMemo(() => cart.reduce((s, l) => s + r2(l.qty * l.price), 0), [cart]);
  const total    = useMemo(() => r2(subtotal - (+discount || 0)), [subtotal, discount]);
  const customerAmtN  = useMemo(() => +customerAmt || 0, [customerAmt]);
  const customerRefAmt = useMemo(() => r2(customerAmtN - total), [customerAmtN, total]);
  const customerRefClr = customerRefAmt > 0 ? "#fbbf24" : customerRefAmt === 0 && customerAmt ? "#4ade80" : "#94a3b8";

  // ── ربط المدفوع بالإجمالي تلقائياً (إلا إذا غيّره المستخدم يدوياً) ──
  useEffect(() => {
    if (!paidManual) {
      setPaid(total > 0 ? String(total) : "");
    }
  }, [total, paidManual]);

  const paidN    = useMemo(() => Math.max(0, +paid || 0), [paid]);
  const change   = useMemo(() => r2(paidN - total), [paidN, total]);
  const isCash   = useMemo(() => { const n=(payType?.PayTypeName||"").trim(); return n==="نقدي"||n.toLowerCase()==="cash"; }, [payType]);
  const paidOk   = useMemo(() => !!paid && paidN > 0, [paid, paidN]);
  const isEmpty  = cart.length === 0;

  // ── إعادة ضبط ────────────────────────────────────────
  // ✅ reset — بدون زبون افتراضي (مثل "بدون مندوب")
  const reset = useCallback(() => {
    syncCart([]);
    const cash = payTps.find(p=>{ const n=(p.PayTypeName||"").trim(); return n==="نقد"||n==="نقدي"||n.toLowerCase()==="cash"; });
    setCustomer(null); setPayType(cash||null);
    paidManualRef.current=false; paidRef.current="";
    setPaidManual(false); setPaid(""); setNote(""); setDiscount(0); setCustomerAmt(""); setSaveErr(""); setShowNP(false);
    if (selCat) loadCat(selCat);
    setTimeout(() => bcRef.current?.focus(), 80);
  }, [selCat, loadCat, syncCart, payTps]);

  const clearCart = () => { syncCart([]); paidManualRef.current=false; paidRef.current=""; setPaidManual(false); setPaid(""); setDiscount(0); setCustomerAmt(""); setSaveErr(""); };

  // ── تعليق / استرجاع ──────────────────────────────────
  const [parked, setParked] = useState([]);
  const [showPK, setShowPK] = useState(false);

  const park = () => {
    if (!cartRef.current.length) return;
    setParked(p => [{ id: Date.now(), t: now(), cart: [...cartRef.current], customer, payType, note, discount }, ...p]);
    reset();
  };

  const restore = (pk) => {
    if (cartRef.current.length) {
      setParked(p => [{ id: Date.now(), t: now(), cart:[...cartRef.current], customer, payType, note, discount }, ...p.filter(x=>x.id!==pk.id)]);
    } else {
      setParked(p => p.filter(x => x.id !== pk.id));
    }
    syncCart(pk.cart.map(l => ({ ...l, _lid: ++_lid })));
    setCustomer(pk.customer??null); setPayType(pk.payType??null);
    setNote(pk.note??""); setDiscount(pk.discount??0); setPaidManual(false); setPaid(""); setSaveErr(""); setShowPK(false);
    setTimeout(() => bcRef.current?.focus(), 80);
  };

  // ── حاسبة اللمس ──────────────────────────────────────
  const [showNP, setShowNP] = useState(false);
  const numpad = (k) => {
    if (k === "C") {
      paidManualRef.current = false;
      setPaidManual(false);
      setPaid(String(total));
      return;
    }

    // ✅ isFirstPress من الـ Ref — يتجنب Stale Closure
    const isFirstPress = !paidManualRef.current;
    paidManualRef.current = true;
    setPaidManual(true);

    // ✅ استخدام p (React-queued state) وليس paidRef.current
    // السبب: عند الضغط السريع، paidRef.current = قيمة render قديمة
    // بينما p = آخر قيمة في طابور React حتى قبل إعادة الرندر
    // الخطأ السابق: setPaid(()=>{...paidRef.current}) = أرقام تتضاعف عند الضغط السريع
    setPaid(p => {
      const s = isFirstPress ? "" : String(p || "");
      if (k === "⌫")             return s.slice(0, -1) || "";
      if (k === "00")            return s ? s + "00" : "";
      if (typeof k === "number") return String(k);  // QUICK: يستبدل القيمة كاملاً
      return s + String(k);                          // رقم عادي: يُضاف للسلسلة
    });
  };

  // ── حفظ ──────────────────────────────────────────────
  const [saving,  setSaving ] = useState(false);
  const [saveErr, setSaveErr] = useState("");
  const [receipt, setReceipt] = useState(null);

  const save = async () => {
    setSaveErr("");
    // ✅ قراءة cart من cartRef — محدَّث قبل setCart
    const snap = [...cartRef.current];

    // ✅ قراءة paid من الـ Ref — أحدث قيمة دائماً (لا Stale Closure)
    const currentPaid = Math.max(0, +paidRef.current || 0);

    // ═══════════════════════════════════════════════════════
    // ✅ الإصلاح الجذري — تعديل PriceOUT مباشرةً
    //
    // المشكلة: التقرير يقرأ SUM(AmountOUT × PriceOUT) من DetailsOUT_tbl
    //          فالخصم في رأس الفاتورة (Dis_FOUT) لا يظهر في التقرير أبداً
    //
    // الحل: عندما يكون المدفوع < المجموع قبل الخصم (subtotal):
    //   نحسب نسبة المدفوع = currentPaid / subtotal
    //   نُعدِّل سعر كل مادة = price × النسبة
    //   فيُحفَظ في DetailsOUT_tbl السعر الحقيقي المدفوع
    //   → التقرير يعرض المبلغ الفعلي تلقائياً بدون أي تغيير في SQL
    // ═══════════════════════════════════════════════════════
    const baseDiscount = r2(+discount || 0);

    // نسبة السعر = المدفوع / المجموع قبل الخصم
    // مثال: paid=3,000 / subtotal=10,000 = 0.3
    const priceRatio = (currentPaid > 0 && subtotal > 0 && currentPaid < subtotal)
      ? currentPaid / subtotal
      : 1;

    const isPriceReduced = priceRatio < 1;

    // الأسطر المُعدَّلة: السعر × نسبة المدفوع إذا كان أقل من الكامل
    const adjustedItems = snap.map(l => ({
      id_Material_NoM : l.id,
      AmountOUT       : l.qty,
      PriceOUT        : isPriceReduced ? r2(l.price * priceRatio) : l.price,
    }));

    // الإجمالي الفعلي بعد التسوية (= currentPaid إذا كان ناقصاً)
    const effectiveTotal = isPriceReduced
      ? currentPaid
      : r2(total - baseDiscount <= 0 ? total : total);
    const currentChange  = r2(currentPaid - (isPriceReduced ? currentPaid : total - baseDiscount));

    if (!snap.length)     { setSaveErr("السلة فارغة — أضف مادة أولاً"); return; }
    if (!payType)         { setSaveErr("يرجى اختيار طريقة الدفع");       return; }
    if (currentPaid <= 0) { setSaveErr("أدخل المبلغ المدفوع");           return; }

    setSaving(true);
    try {
      const res = await posService.checkout({
        id_Zabon        : customer?.id_Zabon || null,
        id_PayType_FOUT : payType.id_PayType,
        // إذا عُدِّل السعر → لا خصم في الرأس (السعر يعكس المدفوع مباشرةً)
        // إذا لم يُعدَّل → احتفظ بالخصم اليدوي كما هو
        Dis_FOUT        : isPriceReduced ? 0 : baseDiscount,
        Note_FOUT       : note,
        PaidAmount      : currentPaid,
        items           : adjustedItems,
      });
      setReceipt({ ...res, cart:snap, customer, payType, subtotal,
        discount: isPriceReduced ? 0 : baseDiscount,
        total   : isPriceReduced ? currentPaid : total,
        paid    : currentPaid, change: currentChange, time:now() });
      if (dualScreen) {
        broadcastDisplay({
          cart: [],
          receipt: {
            invoiceId: res?.invoiceId || res?.data?.invoiceId,
            total: isPriceReduced ? currentPaid : total,
            change: currentChange,
          },
        });
      }
      syncCart([]);
      const cashP = payTps.find(p=>{ const n=(p.PayTypeName||"").trim(); return n==="نقد"||n==="نقدي"||n.toLowerCase()==="cash"; });
      setCustomer(null); setPayType(cashP||null);
      paidManualRef.current=false; paidRef.current="";
      setPaidManual(false); setPaid(""); setNote(""); setDiscount(0); setSaveErr("");
      if (selCat) loadCat(selCat);
      setTimeout(() => bcRef.current?.focus(), 80);
    } catch (e) {
      setSaveErr(e?.message || "خطأ في الحفظ");
    } finally {
      setSaving(false);
    }
  };

  const print = async () => {
    if (!receipt) return;
    let coName = (company?.CompanyInformation_Name || "").trim();
    if (!coName || coName === "اسم الشركة") {
      try {
        const res = await api.get("/company");
        coName = (res?.data?.CompanyInformation_Name || "").trim();
      } catch { /* ignore */ }
    }
    const html = buildPrint(receipt, coName || "", user?.UserName || "—");
    const iframe = document.createElement("iframe");
    iframe.setAttribute("title", " ");
    iframe.style.cssText = "position:fixed;left:-10000px;top:0;width:1px;height:1px;border:0;visibility:hidden";
    document.body.appendChild(iframe);
    const win = iframe.contentWindow;
    const doc = win.document;
    doc.open();
    doc.write(html);
    doc.close();
    const cleanup = () => { try { document.body.removeChild(iframe); } catch { /* ignore */ } };
    const doPrint = () => {
      try { doc.title = " "; } catch { /* ignore */ }
      win.focus();
      win.print();
      setTimeout(cleanup, 2000);
    };
    if (doc.readyState === "complete") setTimeout(doPrint, 80);
    else iframe.onload = () => setTimeout(doPrint, 80);
  };

  // ── فاصل قابل للسحب ──────────────────────────────────
  // ✅ 33% من عرض الشاشة كقيمة افتراضية
  const [leftW, setLeftW] = useState(() => Math.round(window.innerWidth * 0.33));
  const drag = useRef({ on:false, x0:0, w0:0 });

  const onDragStart = (e) => {
    drag.current = { on:true, x0:e.clientX, w0:leftW };
    document.body.style.cssText = "cursor:col-resize;user-select:none";
    const move = (ev) => {
      if (!drag.current.on) return;
      // RTL: سحب يساراً = تكبير، سحب يميناً = تصغير
      const d  = drag.current.x0 - ev.clientX;
      const nw = Math.max(220, Math.min(580, drag.current.w0 + d));
      setLeftW(nw);
    };
    const up = () => {
      drag.current.on = false;
      document.body.style.cssText = "";
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup",   up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup",   up);
  };

  // ── حالة الزر ─────────────────────────────────────────
  const btnOff = saving || isEmpty || !payType || !paidOk;
  const btnLbl = saving           ? "⏳ جاري الحفظ..."
               : isEmpty          ? "السلة فارغة"
               : !payType         ? "اختر طريقة الدفع"
               : !paidOk          ? `أدخل المبلغ المدفوع`
               : "✅ حفظ وطباعة";

  const chClr = change > 0 ? "#4ade80" : change === 0 && paid ? "#fbbf24" : "#f87171";

  // ── شاشة الزبون (مزدوجة) ───────────────────────────────
  const [dualScreen, setDualScreen] = useState(() => localStorage.getItem("pos-dual") === "1");
  const [displayMode, setDisplayMode] = useState(() => localStorage.getItem("pos-display-mode") || "full");
  const customerWinRef = useRef(null);

  const broadcastDisplay = useCallback((override = {}) => {
    const payload = {
      cart, customer, payType, discount, subtotal, total,
      paid: paidN, change, receipt: null, ...override,
    };
    try {
      const ch = new BroadcastChannel(POS_CHANNEL);
      ch.postMessage({ type: "state", state: payload });
      ch.close();
      localStorage.setItem(POS_LS_KEY, JSON.stringify(payload));
    } catch { /* ignore */ }
  }, [cart, customer, payType, discount, subtotal, total, paidN, change]);

  useEffect(() => {
    if (dualScreen) broadcastDisplay();
  }, [dualScreen, broadcastDisplay, cart, customer, payType, discount, subtotal, total, paidN, change]);

  const openCustomerWindow = useCallback((mode) => {
    const url = `/pos-display?mode=${mode}`;
    customerWinRef.current = window.open(url, "POSCustomerDisplay", "width=960,height=640,menubar=no,toolbar=no");
    setTimeout(() => broadcastDisplay(), 350);
  }, [broadcastDisplay]);

  const toggleDualScreen = (on) => {
    setDualScreen(on);
    localStorage.setItem("pos-dual", on ? "1" : "0");
    if (on) openCustomerWindow(displayMode);
    else if (customerWinRef.current && !customerWinRef.current.closed) customerWinRef.current.close();
  };

  const changeDisplayMode = (mode) => {
    setDisplayMode(mode);
    localStorage.setItem("pos-display-mode", mode);
    if (dualScreen) openCustomerWindow(mode);
  };

  useEffect(() => {
    if (dualScreen) openCustomerWindow(displayMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── شاشات خاصة ───────────────────────────────────────
  if (receipt) {
    const coName = (company?.CompanyInformation_Name || "").trim() || "اسم الشركة";
    return (
      <ReceiptScreen
        rc={receipt}
        companyName={coName}
        onPrint={print}
        onNew={() => { setReceipt(null); reset(); }}
      />
    );
  }
  if (initLoading) return <Ctr><Spin/><p style={{color:"#64748b",marginTop:12}}>جاري التحميل...</p></Ctr>;

  // ============================================================
  return (
    <div style={R.root} dir="rtl">

      {/* ══ الشريط العلوي ══ */}
      <div style={R.bar}>
        <span style={R.logo}>⚡ نقطة البيع</span>

        <div style={R.bcBox}>
          <span>📷</span>
          <input ref={bcRef} value={bcVal}
            onChange={e=>setBcVal(e.target.value)}
            onKeyDown={e=>{if(e.key==="Enter")scan(bcVal);}}
            placeholder="امسح الباركود أو اكتب رقم المادة ثم Enter..."
            style={R.bcIn} autoFocus/>
          {bcBusy && <span style={{color:"#475569"}}>⏳</span>}
          {bcMsg.txt && <span style={{fontSize:".8rem",fontWeight:700,color:bcMsg.ok?"#4ade80":"#f87171",whiteSpace:"nowrap"}}>{bcMsg.txt}</span>}
        </div>

        <div style={R.invBox}>
          <span>🧾</span>
          <input
            value={invNo}
            onChange={e => setInvNo(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") goToInvoice(invNo); }}
            placeholder="رقم الفاتورة — Enter للانتقال..."
            style={R.bcIn}
            disabled={invNoBusy}
          />
          <button
            type="button"
            onClick={() => goToInvoice(invNo)}
            disabled={invNoBusy || !invNo.trim()}
            style={R.invGo}
            title="فتح فاتورة المبيعات"
          >
            {invNoBusy ? "⏳" : "↗"}
          </button>
          {invNoMsg.txt && (
            <span style={{ fontSize: ".8rem", fontWeight: 700, color: invNoMsg.ok ? "#4ade80" : "#f87171", whiteSpace: "nowrap" }}>
              {invNoMsg.txt}
            </span>
          )}
        </div>

        <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
          <label title="شاشة الزبون المزدوجة" style={{
            display:"flex",alignItems:"center",gap:5,padding:"5px 10px",
            background:dualScreen?"#1e3a5f":"#0f172a",border:`1px solid ${dualScreen?"#3b82f6":"#334155"}`,
            borderRadius:7,cursor:"pointer",fontSize:".74rem",color:dualScreen?"#93c5fd":"#64748b",fontWeight:700,
          }}>
            <input type="checkbox" checked={dualScreen} onChange={e=>toggleDualScreen(e.target.checked)}
              style={{width:14,height:14,accentColor:"#3b82f6"}}/>
            🖥️ شاشة مزدوجة
          </label>
          {dualScreen && (
            <select value={displayMode} onChange={e=>changeDisplayMode(e.target.value)}
              style={{padding:"5px 8px",background:"#0f172a",border:"1px solid #334155",borderRadius:7,color:"#94a3b8",fontSize:".72rem",fontFamily:"inherit"}}>
              <option value="full">كاملة للزبون</option>
              <option value="digital">إجمالي ديجيتال</option>
            </select>
          )}
          <button style={R.bRefresh} onClick={()=>{refetch();if(selCat)loadCat(selCat);}} title="تحديث">🔄</button>
          <button style={R.bNew}   onClick={reset}>➕ فاتورة جديدة</button>
          <button style={{...R.bTop,background:"#450a0a",border:"1px solid #7f1d1d",color:"#f87171"}} onClick={clearCart} disabled={isEmpty}>🗑️ تفريغ</button>
          <button style={{...R.bTop,...(parked.length?R.bParked:{})}} onClick={()=>setShowPK(true)}>
            📋 معلّقة {parked.length>0&&<span style={R.bdg}>{parked.length}</span>}
          </button>
          <button style={R.bTop} onClick={park} disabled={isEmpty}>⏸ تعليق</button>
        </div>
      </div>

      {/* ══ الجسم ══ */}
      <div style={{flex:1,display:"flex",overflow:"hidden"}}>

        {/* ▶ يمين — شبكة المواد */}
        <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",minWidth:180}}>
          {/* تبويبات الأصناف */}
          <div style={R.cats}>
            {cats.map(c=>(
              <button key={c.id_Catiguary} onClick={()=>loadCat(c)}
                style={{...R.cTab,...(selCat?.id_Catiguary===c.id_Catiguary?R.cTabOn:{})}}>
                {c.CatiguaryName}
                {c.materialCount>0&&<span style={R.cBdg}>{c.materialCount}</span>}
              </button>
            ))}
          </div>
          {/* شبكة المواد */}
          <div style={R.grid}>
            {loadMats
              ? <p style={{gridColumn:"1/-1",padding:32,textAlign:"center",color:"#475569"}}>⏳ جاري التحميل...</p>
              : mats.length===0
                ? <p style={{gridColumn:"1/-1",padding:32,textAlign:"center",color:"#334155"}}>لا توجد مواد</p>
                : mats.map(m=><MatCard key={m.id_Material_NoM} mat={m} onAdd={addItem}/>)
            }
          </div>
        </div>

        {/* ◀ الفاصل القابل للسحب */}
        <div onMouseDown={onDragStart} style={R.splitter}
          onMouseEnter={e=>e.currentTarget.style.background="#1d4ed8"}
          onMouseLeave={e=>e.currentTarget.style.background="#1e293b"}
          title="اسحب لتغيير العرض"/>

        {/* ◀ يسار — الفاتورة */}
        <div style={{width:leftW,minWidth:220,flexShrink:0,display:"flex",flexDirection:"column",background:"#070d1a",borderRight:"1px solid #1e293b"}}>

          {/* الزبون + طريقة الدفع */}
          <div style={{padding:"6px 8px",display:"flex",flexDirection:"column",gap:4,borderBottom:"1px solid #1e293b",flexShrink:0}}>
            <select value={customer?.id_Zabon||""} onChange={e=>setCustomer(cstmrs.find(c=>String(c.id_Zabon)===e.target.value)||null)} style={R.sel}>
              <option value="">— بدون زبون —</option>
              {cstmrs.map(c=><option key={c.id_Zabon} value={c.id_Zabon}>{c.ZabonName}{c.NetBalance>0?` — ${fmtC(c.NetBalance)}`:""}</option>)}
            </select>
            <select value={payType?.id_PayType||""} onChange={e=>setPayType(payTps.find(p=>String(p.id_PayType)===e.target.value)||null)} style={{...R.sel,borderColor:!payType?"#ef4444":"#1e293b"}}>
              <option value="">💳 طريقة الدفع *</option>
              {payTps.map(p=><option key={p.id_PayType} value={p.id_PayType}>{p.PayTypeName}</option>)}
            </select>
          </div>

          {/* رأس جدول السلة */}
          {!isEmpty&&(
            <div style={{display:"flex",alignItems:"center",gap:2,padding:"3px 6px",background:"#0a0f1e",borderBottom:"1px solid #1e293b",fontSize:".6rem",fontWeight:700,color:"#475569",textTransform:"uppercase",flexShrink:0}}>
              <span style={{flex:1}}>المادة</span>
              <span style={{width:70,textAlign:"center"}}>الكمية</span>
              <span style={{width:78,textAlign:"right"}}>السعر</span>
              <span style={{width:70,textAlign:"right"}}>الإجمالي</span>
              <span style={{width:18}}/>
            </div>
          )}

          {/* أسطر السلة */}
          <div style={{flex:1,overflowY:"auto",display:"flex",flexDirection:"column",gap:2,padding:"3px 4px"}}>
            {isEmpty
              ? <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",textAlign:"center",padding:28}}>
                  <span style={{fontSize:"2.5rem"}}>🛒</span>
                  <p style={{color:"#475569",marginTop:8,fontWeight:600}}>السلة فارغة</p>
                  <p style={{color:"#334155",fontSize:".72rem",marginTop:4}}>اضغط على مادة أو امسح الباركود</p>
                </div>
              : cart.map(l=><CartLine key={l._lid} line={l} onQty={q=>setQty(l._lid,q)} onPrc={v=>setPrc(l._lid,v)} onRm={()=>rmLine(l._lid)}/>)
            }
          </div>

          {/* الإجماليات + الدفع + الحفظ */}
          <div style={{padding:"6px 8px",borderTop:"1px solid #1e293b",display:"flex",flexDirection:"column",gap:4,flexShrink:0}}>

            <div style={R.row}><span style={R.lbl}>خصم (د.ع)</span>
              <input type="number" min="0" value={discount} onChange={e=>setDiscount(Math.max(0,+e.target.value||0))} style={{...R.nIn,width:88,color:"#f87171"}}/>
            </div>
            <div style={R.row}><span style={R.lbl}>المجموع</span><span style={R.mono}>{fmtC(subtotal)}</span></div>
            {+discount>0&&<div style={R.row}><span style={{...R.lbl,color:"#f87171"}}>الخصم</span><span style={{...R.mono,color:"#f87171"}}>− {fmtC(discount)}</span></div>}

            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 10px",background:"#0f2744",border:"1px solid #1d4ed8",borderRadius:7,fontWeight:900,fontSize:".92rem",color:"#93c5fd"}}>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <span>الإجمالي</span>
                <button onClick={()=>{setPaidManual(false);setPaid(String(total));setShowNP(false);}} style={{padding:"2px 8px",background:"#1e3a5f",border:"1px solid #3b82f6",borderRadius:5,color:"#93c5fd",cursor:"pointer",fontSize:".68rem",fontWeight:700,fontFamily:"inherit",whiteSpace:"nowrap"}} title="إعادة ضبط للإجمالي">↺ الإجمالي</button>
              </div>
              <span style={{fontFamily:"monospace"}}>{fmtC(total)}</span>
            </div>

            {/* حاسبة المرجع — للكاشير فقط، لا تؤثر على الحفظ */}
            <div style={{display:"flex",gap:5}}>
              <div style={R.pBox}>
                <label style={R.pLbl}>مبلغ الزبون</label>
                <input type="number" min="0" value={customerAmt} onChange={e=>setCustomerAmt(e.target.value)} placeholder="0"
                  style={{background:"none",border:"none",outline:"none",color:"#e2e8f0",fontFamily:"monospace",fontWeight:900,fontSize:"1.05rem",textAlign:"right",width:"100%"}}/>
              </div>
              <div style={{...R.pBox,background:customerRefAmt>0?"#1a1000":"#0f172a",border:`2px solid ${customerRefClr}`,transition:"all .2s"}}>
                <label style={{...R.pLbl,color:customerRefClr}}>المبلغ المرجع</label>
                <div style={{fontFamily:"monospace",fontSize:"1.05rem",fontWeight:900,color:customerRefClr,textAlign:"right"}}>
                  {customerAmt ? fmtC(customerRefAmt) : fmtC(0)}
                </div>
              </div>
            </div>

            {/* المدفوع + الباقي */}
            <div style={{display:"flex",gap:5}}>
              <div style={R.pBox}>
                <label style={R.pLbl}>المبلغ المدفوع</label>
                <div style={{display:"flex",gap:3,alignItems:"center"}}>
                  <input type="number" min="0" value={paid} onChange={e=>{setPaidManual(true);setPaid(e.target.value);}} placeholder="0" readOnly={!paidManual}
                    style={{flex:1,background:"none",border:"none",outline:"none",color:"#4ade80",fontFamily:"monospace",fontWeight:900,fontSize:"1.05rem",textAlign:"right",minWidth:0}}/>
                  <button onClick={()=>setShowNP(v=>!v)} style={{background:showNP?"#1d4ed8":"#1e293b",border:`1px solid ${showNP?"#3b82f6":"#334155"}`,borderRadius:6,color:showNP?"#93c5fd":"#64748b",cursor:"pointer",fontSize:".95rem",padding:"3px 6px",flexShrink:0}}>🔢</button>
                </div>
              </div>
              <div style={{...R.pBox,background:change>0?"#052e16":change===0&&paid?"#1a1000":"#0f172a",border:`2px solid ${chClr}`,transition:"all .2s"}}>
                <label style={{...R.pLbl,color:chClr}}>{change>0?"✅ الباقي":change===0&&paid?"✔ مطابق":"الباقي"}</label>
                <div style={{fontFamily:"monospace",fontSize:"1.05rem",fontWeight:900,color:chClr,textAlign:"right"}}>{fmtC(Math.abs(change))}</div>
              </div>
            </div>

            {/* حاسبة اللمس */}
            {showNP&&(
              <div style={{background:"#0a0f1e",border:"1px solid #1e293b",borderRadius:9,padding:6}}>
                <div style={{display:"flex",flexWrap:"wrap",gap:3,marginBottom:4}}>
                  {QUICK.map(a=><button key={a} onClick={()=>numpad(a)} style={R.qAmt}>{a>=1000?`${a/1000}k`:a}</button>)}
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:3}}>
                  {[7,8,9,4,5,6,1,2,3].map(n=><button key={n} onClick={()=>numpad(String(n))} style={R.nBtn}>{n}</button>)}
                  <button onClick={()=>numpad("00")} style={R.nBtn}>00</button>
                  <button onClick={()=>numpad("0")}  style={R.nBtn}>0</button>
                  <button onClick={()=>numpad("⌫")}  style={{...R.nBtn,background:"#1e293b",color:"#f87171"}}>⌫</button>
                  <button onClick={()=>numpad("C")}  style={{...R.nBtn,gridColumn:"1/3",background:"#450a0a",color:"#f87171",fontWeight:900}}>مسح</button>
                  <button onClick={()=>{setPaidManual(false);setPaid(String(total));setShowNP(false);}} style={{...R.nBtn,background:"#052e16",color:"#4ade80",fontSize:".68rem",fontWeight:800}}>↺ الإجمالي</button>
                </div>
              </div>
            )}

            {saveErr&&<div style={{padding:"5px 8px",background:"#450a0a",border:"1px solid #ef4444",borderRadius:6,color:"#f87171",fontSize:".78rem",fontWeight:600}}>⚠ {saveErr}</div>}

            <button onClick={save} disabled={btnOff}
              style={{padding:"10px",border:"2px solid",borderRadius:9,fontWeight:900,fontSize:".9rem",fontFamily:"inherit",cursor:btnOff?"not-allowed":"pointer",
                background:btnOff?"#0f2744":"#166534",borderColor:btnOff?"#1d4ed8":"#16a34a",color:btnOff?"#475569":"#4ade80",opacity:btnOff?.5:1}}>
              {btnLbl}
            </button>
          </div>
        </div>
      </div>

      {/* ══ Modal الفواتير المعلّقة ══ */}
      {showPK&&createPortal(
        <div style={R.overlay} onClick={()=>setShowPK(false)}>
          <div style={R.modal} onClick={e=>e.stopPropagation()}>
            <div style={R.mHdr}>
              <span style={{fontWeight:800}}>📋 الفواتير المعلّقة <span style={{...R.bdg,background:"#d97706",marginRight:6}}>{parked.length}</span></span>
              <button onClick={()=>setShowPK(false)} style={R.bX}>✕</button>
            </div>
            {parked.length===0
              ? <p style={{padding:24,textAlign:"center",color:"#475569"}}>لا توجد فواتير معلّقة</p>
              : parked.map(pk=>(
                <div key={pk.id} style={R.pkRow}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontWeight:700,color:"#e2e8f0",fontSize:".88rem"}}>{pk.customer?.ZabonName||"زبون عام"}</div>
                    <div style={{fontSize:".68rem",color:"#64748b",marginTop:2}}>🕐 {pk.t} · {pk.cart.length} أصناف · {pk.payType?.PayTypeName||"—"}</div>
                    <div style={{fontSize:".65rem",color:"#475569",marginTop:2,lineHeight:1.5}}>
                      {pk.cart.slice(0,3).map(l=>`${l.name} ×${fmtN(l.qty)}`).join(" · ")}
                      {pk.cart.length>3&&` +${pk.cart.length-3}`}
                    </div>
                  </div>
                  <div style={{textAlign:"center",flexShrink:0,padding:"0 8px"}}>
                    <div style={{fontFamily:"monospace",fontWeight:900,color:"#fbbf24"}}>{fmtC(pk.cart.reduce((s,l)=>s+r2(l.qty*l.price),0))}</div>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:4,flexShrink:0}}>
                    <button onClick={()=>restore(pk)} style={R.bRes}>▶ استئناف</button>
                    <button onClick={()=>{if(confirm("حذف؟"))setParked(p=>p.filter(x=>x.id!==pk.id));}} style={R.bDlP}>🗑</button>
                  </div>
                </div>
              ))
            }
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// ============================================================
//  MatCard
// ============================================================
function MatCard({ mat, onAdd }) {
  const [fl, setFl] = useState(false);
  const out = mat.IsOutOfStock || mat.QuantityOnHand <= 0;
  return (
    <button onClick={()=>{if(!out){onAdd(mat);setFl(true);setTimeout(()=>setFl(false),160);}}}
      style={{display:"flex",flexDirection:"column",gap:2,padding:"9px 8px",borderRadius:9,background:fl?"#1e3a5f":"#0f172a",border:`1px solid ${fl?"#3b82f6":"#1e293b"}`,cursor:out?"not-allowed":"pointer",textAlign:"right",position:"relative",minHeight:90,opacity:out?.4:1,transform:fl?"scale(.95)":"none",transition:"all .1s"}}>
      <span style={{fontWeight:800,fontSize:".8rem",color:"#e2e8f0",lineHeight:1.3}}>{mat.MaterialName}</span>
      {mat.Band&&<span style={{fontSize:".63rem",color:"#475569"}}>{mat.Band}</span>}
      <span style={{fontFamily:"monospace",fontWeight:900,color:"#fbbf24",fontSize:".9rem",marginTop:"auto"}}>{fmtC(mat.DefaultPrice || pickInvoiceSellPrice(mat) || 0)}</span>
      <span style={{fontSize:".63rem",fontWeight:600,color:out?"#ef4444":mat.QuantityOnHand<=5?"#f59e0b":"#4ade80"}}>📦 {fmtN(mat.QuantityOnHand)}</span>
      {out&&<span style={{position:"absolute",top:3,left:3,padding:"1px 5px",background:"#7f1d1d",color:"#f87171",borderRadius:20,fontSize:".6rem",fontWeight:700}}>نفد</span>}
    </button>
  );
}

// ============================================================
//  CartLine
// ============================================================
function CartLine({ line, onQty, onPrc, onRm }) {
  const tot = r2(line.qty * line.price);
  return (
    <div style={{display:"flex",alignItems:"center",gap:3,padding:"3px 5px",background:"#0f172a",border:"1px solid #1e293b",borderRadius:6}}>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontWeight:800,fontSize:".76rem",color:"#e2e8f0",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{line.name}</div>
        {line.band&&<div style={{fontSize:".6rem",color:"#475569"}}>{line.band}</div>}
      </div>
      <div style={{display:"flex",alignItems:"center",gap:2,width:70,flexShrink:0}}>
        <button onClick={()=>onQty(line.qty-1)} style={{width:18,height:18,borderRadius:4,border:"1px solid #334155",background:"#1e293b",color:"#f87171",fontWeight:900,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:".9rem"}}>−</button>
        <input type="number" min="0.001" step="any" value={line.qty} onChange={e=>onQty(+e.target.value||1)} style={{width:26,textAlign:"center",padding:"1px 0",background:"#1e293b",border:"1px solid #334155",borderRadius:4,color:"#e2e8f0",fontFamily:"monospace",fontWeight:800,fontSize:".74rem",outline:"none"}}/>
        <button onClick={()=>onQty(line.qty+1)} style={{width:18,height:18,borderRadius:4,border:"1px solid #334155",background:"#166534",color:"#4ade80",fontWeight:900,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:".9rem"}}>+</button>
      </div>
      <div style={{width:78,flexShrink:0,display:"flex",flexDirection:"column",gap:1}}>
        <input type="number" min="0" step="any" value={line.price} onChange={e=>onPrc(e.target.value)} style={{width:"100%",padding:"2px 4px",background:"#1e293b",border:"1px solid #334155",borderRadius:4,color:"#fbbf24",fontFamily:"monospace",fontWeight:700,fontSize:".74rem",outline:"none"}}/>
        {line.prices?.length>0&&(
          <select value="" onChange={e=>{if(e.target.value)onPrc(+e.target.value);}} style={{background:"#1e293b",border:"1px solid #334155",borderRadius:3,color:"#94a3b8",fontSize:".59rem",padding:"1px 2px",cursor:"pointer",width:"100%"}}>
            <option value="">⬇ أسعار</option>
            {line.prices.map((p,i)=><option key={i} value={p.value}>{p.label}: {fmtN(Number(p.value))}</option>)}
          </select>
        )}
      </div>
      <div style={{width:70,textAlign:"right",fontFamily:"monospace",fontWeight:900,color:"#4ade80",fontSize:".76rem",flexShrink:0}}>{fmtC(tot)}</div>
      <button onClick={onRm} style={{background:"none",border:"none",color:"#ef4444",cursor:"pointer",fontSize:".85rem",padding:"1px 2px",flexShrink:0}}>✕</button>
    </div>
  );
}

// ============================================================
//  ReceiptScreen
// ============================================================
function ReceiptScreen({ rc, companyName = "", onPrint, onNew }) {
  const co = (companyName || "").trim() || "اسم الشركة";
  return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"#020817",color:"#e2e8f0",flexDirection:"column",gap:16}} dir="rtl">
      <div style={{fontSize:"3rem"}}>✅</div>
      <div style={{fontSize:"1.1rem",fontWeight:800,color:"#e2e8f0"}}>{co}</div>
      <div style={{fontSize:"1.4rem",fontWeight:900,color:"#4ade80"}}>تم حفظ الفاتورة!</div>
      <div style={{fontSize:".95rem",color:"#94a3b8"}}>شكراً لزيارتكم متجرنا</div>
      <div style={{fontFamily:"monospace",color:"#fbbf24"}}>رقم #{rc?.invoiceId}</div>
      <div style={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:12,padding:"14px 22px",minWidth:300}}>
        {rc.cart.map((l,i)=>(
          <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"3px 0",borderBottom:"1px solid #1e293b",fontSize:".82rem",color:"#94a3b8"}}>
            <span>{l.name} × {fmtN(l.qty)}</span>
            <span style={{fontFamily:"monospace"}}>{fmtC(r2(l.qty*l.price))}</span>
          </div>
        ))}
        <div style={{display:"flex",justifyContent:"space-between",padding:"9px 0 3px",fontWeight:900,color:"#e2e8f0"}}><span>الإجمالي</span><span style={{fontFamily:"monospace"}}>{fmtC(rc.total)}</span></div>
        <div style={{display:"flex",justifyContent:"space-between",color:"#4ade80",fontWeight:700}}><span>المدفوع</span><span style={{fontFamily:"monospace"}}>{fmtC(rc.paid)}</span></div>
        {rc.change>0&&<div style={{display:"flex",justifyContent:"space-between",color:"#fbbf24",fontWeight:700}}><span>الباقي للزبون</span><span style={{fontFamily:"monospace"}}>{fmtC(rc.change)}</span></div>}
      </div>
      <div style={{display:"flex",gap:12}}>
        <button onClick={onPrint} style={{padding:"11px 22px",background:"#1d4ed8",color:"#fff",border:"none",borderRadius:9,fontWeight:700,cursor:"pointer"}}>🖨 طباعة</button>
        <button onClick={onNew}   style={{padding:"11px 22px",background:"#166534",color:"#4ade80",border:"2px solid #16a34a",borderRadius:9,fontWeight:700,cursor:"pointer"}}>➕ فاتورة جديدة</button>
      </div>
    </div>
  );
}

// ============================================================
//  buildPrint
// ============================================================
function buildPrint(rc, companyName = "", userName = "—") {
  const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const coName = esc(companyName.trim() || "اسم الشركة");
  const usrName = esc(userName.trim() || "—");
  const rows = rc.cart.map((l, i) => `
    <div class="line"><span class="nm">${i + 1}. ${esc(l.name)}</span></div>
    <div class="line sub">
      <span>${fmtN(Number(l.qty))}${l.band ? ` ${esc(l.band)}` : ""} × ${fmtC(l.price)}</span>
      <span class="vl">${fmtC(r2(l.qty * l.price))}</span>
    </div>`).join("");
  return `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>فاتورة #${rc.invoiceId}</title>
<style>
@page{size:80mm 80mm;margin:2mm}
*{box-sizing:border-box;margin:0;padding:0}
body{width:76mm;max-width:76mm;margin:0 auto;font-family:"Segoe UI",Tahoma,Arial,sans-serif;font-size:10px;line-height:1.35;color:#000;padding:2mm}
.h{text-align:center;border-bottom:1px dashed #000;padding-bottom:3mm;margin-bottom:3mm}
.h .co{font-size:13px;font-weight:900;word-break:break-word}
.h .sub{font-size:9px;margin-top:2mm;color:#333}
.h .user{font-size:9px;margin-top:2mm;color:#444;font-weight:700}
.meta{margin-bottom:2mm}
.meta-grid{display:grid;grid-template-columns:1fr 1fr;gap:1.5mm 2mm;font-size:8px}
.meta-item{min-width:0}
.meta-item .lbl{display:block;font-size:7px;font-weight:700;color:#555;margin-bottom:0.5mm}
.meta-item .val{display:block;font-weight:800;word-break:break-word;line-height:1.25}
.line{display:flex;justify-content:space-between;gap:2mm;padding:2px 0;border-bottom:1px dotted #bbb;font-size:9px}
.line.sub{border-bottom:1px dashed #ddd;padding-bottom:3px;margin-bottom:2px}
.line .nm{flex:1;word-break:break-word;font-weight:700}
.line .vl{white-space:nowrap;font-weight:900}
.tot{margin-top:3mm;border-top:1px dashed #000;padding-top:2mm;font-size:10px}
.tot div{display:flex;justify-content:space-between;padding:2px 0}
.tot .g{font-size:12px;font-weight:900;margin-top:2mm;padding-top:2mm;border-top:1px solid #000}
.footer{text-align:center;margin-top:4mm;font-size:9px;padding-top:2mm;border-top:1px dashed #000}
@media print{html,body{width:76mm;max-width:76mm}body{padding:0}}
</style></head><body>
<div class="h"><div class="co">${coName}</div><div class="sub">فاتورة مبيعات — نقطة البيع</div><div class="user">المستخدم: ${usrName}</div></div>
<div class="meta">
  <div class="meta-grid">
    <div class="meta-item"><span class="lbl">رقم الفاتورة</span><span class="val">#${rc.invoiceId}</span></div>
    <div class="meta-item"><span class="lbl">التاريخ</span><span class="val">${esc(rc.time)}</span></div>
    <div class="meta-item"><span class="lbl">الزبون</span><span class="val">${esc(rc.customer?.ZabonName || "زبون عام")}</span></div>
    <div class="meta-item"><span class="lbl">الدفع</span><span class="val">${esc(rc.payType?.PayTypeName || "—")}</span></div>
  </div>
</div>
${rows}
<div class="tot">
  <div><span>المجموع</span><span>${fmtC(rc.subtotal)}</span></div>
  ${+rc.discount > 0 ? `<div><span>الخصم</span><span>− ${fmtC(rc.discount)}</span></div>` : ""}
  <div class="g"><span>الإجمالي</span><span>${fmtC(rc.total)}</span></div>
  <div><span>المدفوع</span><span>${fmtC(rc.paid)}</span></div>
  ${rc.change > 0 ? `<div><span>الباقي</span><span>${fmtC(rc.change)}</span></div>` : ""}
</div>
<div class="footer">شكرا لزيارتكم متجرنا</div>
</body></html>`;
}

// ── مساعدات ───────────────────────────────────────────────
const Ctr  = ({children}) => <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"#020817",flexDirection:"column"}}>{children}</div>;
const Spin = () => <div style={{width:26,height:26,border:"3px solid #1e293b",borderTopColor:"#3b82f6",borderRadius:"50%"}}/>;

// ── التنسيقات ─────────────────────────────────────────────
const R = {
  root    : {display:"flex",flexDirection:"column",height:"100vh",overflow:"hidden",background:"#020817",color:"#e2e8f0",fontFamily:"'Segoe UI',Tahoma,sans-serif"},
  bar     : {display:"flex",alignItems:"center",gap:8,padding:"7px 12px",background:"#0a0f1e",borderBottom:"1px solid #1e293b",flexShrink:0},
  logo    : {fontSize:".95rem",fontWeight:900,color:"#fbbf24",minWidth:76,flexShrink:0},
  bcBox   : {flex:1,display:"flex",alignItems:"center",gap:8,padding:"5px 10px",background:"#0f172a",border:"1px solid #1e3a5f",borderRadius:8,minWidth:0},
  invBox  : {display:"flex",alignItems:"center",gap:6,padding:"5px 10px",background:"#0f172a",border:"1px solid #334155",borderRadius:8,minWidth:180,maxWidth:320,flexShrink:0},
  invGo   : {padding:"4px 8px",background:"#1d4ed8",border:"1px solid #3b82f6",borderRadius:6,color:"#bfdbfe",cursor:"pointer",fontSize:".78rem",fontWeight:700,fontFamily:"inherit",flexShrink:0},
  bcIn    : {flex:1,background:"none",border:"none",outline:"none",color:"#93c5fd",fontSize:".87rem",fontFamily:"inherit",minWidth:0},
  bRefresh: {padding:"5px 7px",background:"#0f172a",border:"1px solid #1e293b",borderRadius:7,color:"#475569",cursor:"pointer",fontSize:".9rem"},
  bNew    : {padding:"6px 11px",background:"#166534",border:"2px solid #16a34a",borderRadius:7,color:"#4ade80",cursor:"pointer",fontSize:".78rem",fontWeight:800,fontFamily:"inherit",whiteSpace:"nowrap"},
  bTop    : {padding:"6px 10px",background:"#1e293b",border:"1px solid #334155",borderRadius:7,color:"#94a3b8",cursor:"pointer",fontSize:".78rem",fontWeight:600,position:"relative",display:"flex",alignItems:"center",gap:4,whiteSpace:"nowrap"},
  bParked : {background:"#78350f",border:"1px solid #d97706",color:"#fbbf24"},
  bdg     : {display:"inline-flex",alignItems:"center",justifyContent:"center",minWidth:16,height:16,background:"#ef4444",color:"#fff",borderRadius:20,fontSize:".62rem",fontWeight:900,padding:"0 4px"},
  splitter: {width:5,flexShrink:0,cursor:"col-resize",background:"#1e293b",transition:"background .15s"},
  cats    : {display:"flex",gap:4,padding:"6px 8px",flexWrap:"wrap",background:"#070d1a",borderBottom:"1px solid #1e293b",flexShrink:0},
  cTab    : {padding:"4px 10px",borderRadius:7,background:"#0f172a",border:"1px solid #1e293b",color:"#64748b",cursor:"pointer",fontSize:".76rem",fontWeight:600,display:"flex",alignItems:"center",gap:3},
  cTabOn  : {background:"#1d4ed8",border:"1px solid #3b82f6",color:"#bfdbfe"},
  cBdg    : {background:"#1e293b",color:"#64748b",padding:"1px 5px",borderRadius:20,fontSize:".62rem"},
  grid    : {flex:1,overflowY:"auto",padding:8,display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(120px,1fr))",gap:7,alignContent:"start"},
  sel     : {width:"100%",padding:"5px 8px",background:"#0f172a",border:"1px solid #1e293b",borderRadius:7,color:"#e2e8f0",fontFamily:"inherit",fontSize:".79rem",outline:"none"},
  row     : {display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:".79rem"},
  lbl     : {color:"#64748b"},
  mono    : {fontFamily:"monospace",color:"#94a3b8",fontSize:".79rem"},
  nIn     : {padding:"2px 5px",background:"#0f172a",border:"1px solid #334155",borderRadius:5,fontFamily:"monospace",fontWeight:700,fontSize:".8rem",outline:"none",textAlign:"right"},
  pBox    : {flex:1,padding:"5px 7px",background:"#0f172a",border:"1px solid #1e293b",borderRadius:7,display:"flex",flexDirection:"column",gap:2,transition:"all .2s"},
  pLbl    : {fontSize:".61rem",color:"#64748b",fontWeight:600,textTransform:"uppercase"},
  qAmt    : {flex:"1 1 calc(33% - 3px)",padding:"4px 2px",background:"#1e293b",border:"1px solid #334155",borderRadius:5,color:"#94a3b8",cursor:"pointer",fontFamily:"monospace",fontWeight:700,fontSize:".68rem",textAlign:"center"},
  nBtn    : {padding:"8px 2px",background:"#0f172a",border:"1px solid #1e293b",borderRadius:6,color:"#e2e8f0",cursor:"pointer",fontFamily:"monospace",fontWeight:800,fontSize:".92rem",textAlign:"center"},
  overlay : {position:"fixed",inset:0,background:"rgba(0,0,0,.82)",backdropFilter:"blur(4px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9999},
  modal   : {background:"#0f172a",border:"1px solid #1e293b",borderRadius:14,width:460,maxHeight:"78vh",overflow:"auto",display:"flex",flexDirection:"column"},
  mHdr    : {display:"flex",justifyContent:"space-between",alignItems:"center",padding:"11px 14px",borderBottom:"1px solid #1e293b",position:"sticky",top:0,background:"#0f172a"},
  bX      : {background:"none",border:"none",color:"#64748b",cursor:"pointer",fontSize:"1.05rem"},
  pkRow   : {display:"flex",alignItems:"center",gap:8,padding:"10px 14px",borderBottom:"1px solid #1e293b"},
  bRes    : {padding:"4px 9px",background:"#1d4ed8",border:"none",borderRadius:6,color:"#bfdbfe",fontWeight:700,cursor:"pointer",fontSize:".76rem",fontFamily:"inherit"},
  bDlP    : {padding:"4px 7px",background:"none",border:"1px solid #334155",borderRadius:5,color:"#64748b",cursor:"pointer",fontSize:".76rem",fontFamily:"inherit"},
};