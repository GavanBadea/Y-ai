// ============================================================
//  src/components/invoices/InvoiceEditModal.jsx
//  Modal تعديل فاتورة المبيعات المحفوظة
// ============================================================
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import api from "../../services/api";

const r2   = (n=0) => Math.round((+n||0)*100)/100;
const fmtN = (n=0) => r2(n).toLocaleString("en-US");
const fmtC = (n=0) => `${fmtN(n)} د.ع`;
let _lid = 0;

export default function InvoiceEditModal({ invoiceId, onClose, onSaved }) {
  const [loading,  setLoading ] = useState(true);
  const [saving,   setSaving  ] = useState(false);
  const [err,      setErr     ] = useState("");
  const [header,   setHeader  ] = useState(null);
  const [lines,    setLines   ] = useState([]);
  const [discount, setDiscount] = useState(0);
  const [note,     setNote    ] = useState("");
  const [matQ,     setMatQ    ] = useState("");
  const [matBusy,  setMatBusy ] = useState(false);
  const matRef = useRef(null);

  const newTotal = r2(lines.reduce((s,l)=>s+r2(l.qty*l.price),0) - +discount);
  const oldTotal = header
    ? r2((header.oldLines||[]).reduce((s,l)=>s+r2(l.AmountOUT*l.PriceOUT),0) - (header.Dis_FOUT||0))
    : 0;
  const diff = r2(newTotal - oldTotal);

  // ── جلب البيانات ─────────────────────────────────────
  useEffect(()=>{
    if (!invoiceId) return;
    setLoading(true);
    api.get(`/invoices-out/${invoiceId}/edit-data`)
      .then(r=>{
        const hdr   = r?.data?.header || r?.header;
        const lns   = r?.data?.lines  || r?.lines || [];
        setHeader({ ...hdr, oldLines: lns });
        setDiscount(hdr?.Dis_FOUT || 0);
        setNote(hdr?.Note_FOUT || "");
        setLines(lns.map(l=>({
          _lid  : ++_lid,
          matId : l.id_Material_NoM,
          name  : l.MaterialName,
          band  : l.Band||"",
          qty   : r2(l.AmountOUT),
          price : r2(l.PriceOUT),
        })));
      })
      .catch(e=>setErr(e?.response?.data?.message||e.message))
      .finally(()=>setLoading(false));
  },[invoiceId]);

  // ── بحث مادة إضافية ──────────────────────────────────
  const searchMat = async (val) => {
    const v=(val||"").trim(); if(!v) return;
    setMatQ(""); setMatBusy(true);
    try {
      const r   = await api.get(`/invoices-out/material/${encodeURIComponent(v)}`);
      const mat = r?.data || r?.material;
      if (mat?.id_Material_NoM) {
        setLines(prev=>{
          const i=prev.findIndex(l=>l.matId===mat.id_Material_NoM);
          if(i>=0) return prev.map((l,x)=>x===i?{...l,qty:r2(l.qty+1)}:l);
          return [...prev,{_lid:++_lid,matId:mat.id_Material_NoM,name:mat.MaterialName,
            band:mat.Band||"",qty:1,price:r2(mat.LastSellPrice||0)}];
        });
      }
    } catch {}
    finally { setMatBusy(false); matRef.current?.focus(); }
  };

  const updQty   = (lid,q) => setLines(p=>p.map(l=>l._lid===lid?{...l,qty:Math.max(0.001,r2(+q||1))}:l));
  const updPrice = (lid,v) => setLines(p=>p.map(l=>l._lid===lid?{...l,price:Math.max(0,r2(+v||0))}:l));
  const delLine  = (lid)   => setLines(p=>p.filter(l=>l._lid!==lid));

  // ── حفظ التعديل ──────────────────────────────────────
  const save = async () => {
    setErr(""); setSaving(true);
    try {
      await api.put(`/invoices-out/${invoiceId}`,{
        Dis_FOUT  : r2(+discount),
        Note_FOUT : note,
        lines: lines.map(l=>({ id_Material_NoM:l.matId, AmountOUT:l.qty, PriceOUT:l.price })),
      });
      onSaved?.();
      onClose();
    } catch(e){ setErr(e?.response?.data?.message||e.message); }
    finally { setSaving(false); }
  };

  return createPortal(
    <div style={MS.overlay} onClick={e=>{ if(e.target===e.currentTarget) onClose(); }}>
      <div style={MS.box}>

        {/* رأس */}
        <div style={MS.hdr}>
          <div>
            <div style={{fontWeight:800,fontSize:"1rem",color:"#e2e8f0"}}>✏️ تعديل فاتورة #{invoiceId}</div>
            {header&&<div style={{fontSize:".74rem",color:"#64748b",marginTop:3}}>{header.ZabonName} — {header.Date_FOUT?.split("T")[0]}</div>}
          </div>
          <button onClick={onClose} style={MS.xBtn}>✕</button>
        </div>

        <div style={{flex:1,overflowY:"auto",padding:16,display:"flex",flexDirection:"column",gap:14}}>
          {loading ? <div style={{textAlign:"center",padding:40,color:"#64748b"}}>⏳ جاري التحميل...</div> : <>

            {/* بحث مادة */}
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <input ref={matRef} value={matQ}
                onChange={e=>setMatQ(e.target.value)}
                onKeyDown={e=>{ if(e.key==="Enter") searchMat(matQ); }}
                placeholder="📦 أضف مادة جديدة — باركود أو اسم ثم Enter"
                style={MS.inp}/>
              {matBusy&&<span style={{color:"#64748b"}}>⏳</span>}
            </div>

            {/* جدول الأسطر */}
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:".82rem"}}>
                <thead>
                  <tr style={{background:"#070d1a",borderBottom:"2px solid #1e293b"}}>
                    {["المادة","الكمية","السعر","الإجمالي",""].map((h,i)=>(
                      <th key={i} style={{padding:"7px 10px",textAlign:"right",color:"#64748b",fontWeight:700,fontSize:".67rem"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l,i)=>(
                    <tr key={l._lid} style={{borderBottom:"1px solid #1e293b",background:i%2?"transparent":"#070d1a"}}>
                      <td style={{padding:"7px 10px"}}>
                        <div style={{fontWeight:700,color:"#e2e8f0"}}>{l.name}</div>
                        {l.band&&<div style={{fontSize:".68rem",color:"#475569"}}>{l.band}</div>}
                      </td>
                      <td style={{padding:"7px 10px"}}>
                        <div style={{display:"flex",alignItems:"center",gap:3}}>
                          <button onClick={()=>updQty(l._lid,l.qty-1)} style={MS.qBtn}>−</button>
                          <input type="number" min="0.001" step="any" value={l.qty}
                            onChange={e=>updQty(l._lid,e.target.value)}
                            style={{width:44,...MS.numIn}}/>
                          <button onClick={()=>updQty(l._lid,l.qty+1)} style={{...MS.qBtn,background:"#166534",color:"#4ade80"}}>+</button>
                        </div>
                      </td>
                      <td style={{padding:"7px 10px"}}>
                        <input type="number" min="0" step="any" value={l.price}
                          onChange={e=>updPrice(l._lid,e.target.value)}
                          style={{width:90,...MS.numIn,color:"#fbbf24"}}/>
                      </td>
                      <td style={{padding:"7px 10px",fontFamily:"monospace",fontWeight:700,color:"#4ade80"}}>{fmtC(r2(l.qty*l.price))}</td>
                      <td style={{padding:"7px 10px"}}>
                        <button onClick={()=>delLine(l._lid)} style={{background:"none",border:"none",color:"#ef4444",cursor:"pointer"}}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* خصم وملاحظة */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <div>
                <label style={MS.lbl}>خصم (د.ع)</label>
                <input type="number" min="0" value={discount} onChange={e=>setDiscount(e.target.value)} style={MS.inp}/>
              </div>
              <div>
                <label style={MS.lbl}>ملاحظة</label>
                <input value={note} onChange={e=>setNote(e.target.value)} style={MS.inp}/>
              </div>
            </div>

            {/* مقارنة المبالغ */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
              {[
                {l:"المبلغ القديم",v:oldTotal,c:"#94a3b8"},
                {l:"المبلغ الجديد",v:newTotal,c:"#93c5fd"},
                {l:"الفارق",v:diff,c:diff>0?"#f87171":diff<0?"#4ade80":"#64748b"},
              ].map((x,i)=>(
                <div key={i} style={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:8,padding:"10px 12px"}}>
                  <div style={{fontSize:".68rem",color:"#64748b"}}>{x.l}</div>
                  <div style={{fontFamily:"monospace",fontWeight:900,color:x.c,fontSize:"1rem"}}>{fmtC(Math.abs(x.v))}</div>
                  {i===2&&diff!==0&&<div style={{fontSize:".68rem",color:x.c,marginTop:3}}>{diff>0?"سيزداد الدين":"سيُخفَّض الدين"}</div>}
                </div>
              ))}
            </div>

            {err&&<div style={{padding:"6px 10px",background:"#450a0a",border:"1px solid #ef4444",borderRadius:6,color:"#f87171",fontWeight:600}}>⚠ {err}</div>}
          </>}
        </div>

        {/* أزرار */}
        <div style={{padding:"12px 16px",borderTop:"1px solid #1e293b",display:"flex",gap:10}}>
          <button onClick={save} disabled={saving||loading||!lines.length}
            style={{flex:1,padding:"10px",background:"#166534",border:"2px solid #16a34a",borderRadius:9,
              color:"#4ade80",fontWeight:900,fontSize:".9rem",fontFamily:"inherit",
              cursor:saving||loading?"not-allowed":"pointer",opacity:saving||loading?.5:1}}>
            {saving?"⏳ جاري الحفظ...":"✅ حفظ التعديل"}
          </button>
          <button onClick={onClose} style={{padding:"10px 18px",background:"#1e293b",border:"1px solid #334155",borderRadius:9,color:"#94a3b8",cursor:"pointer",fontFamily:"inherit"}}>
            إلغاء
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

const MS = {
  overlay:{position:"fixed",inset:0,background:"rgba(0,0,0,.85)",backdropFilter:"blur(5px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9999,padding:16},
  box    :{background:"#0a0f1e",border:"1px solid #1e293b",borderRadius:14,width:"min(90vw,780px)",maxHeight:"90vh",display:"flex",flexDirection:"column"},
  hdr    :{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"13px 16px",borderBottom:"1px solid #1e293b",background:"#070d1a",borderRadius:"14px 14px 0 0",flexShrink:0},
  xBtn   :{background:"none",border:"none",color:"#64748b",cursor:"pointer",fontSize:"1.1rem"},
  inp    :{width:"100%",padding:"7px 10px",background:"#0a0f1e",border:"1px solid #1e293b",borderRadius:7,color:"#e2e8f0",fontFamily:"inherit",fontSize:".86rem",outline:"none"},
  numIn  :{padding:"4px 6px",background:"#1e293b",border:"1px solid #334155",borderRadius:5,color:"#e2e8f0",fontFamily:"monospace",fontWeight:700,fontSize:".8rem",outline:"none",textAlign:"right"},
  qBtn   :{width:20,height:20,borderRadius:4,border:"1px solid #334155",background:"#1e293b",color:"#f87171",fontWeight:900,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:".9rem"},
  lbl    :{fontSize:".72rem",color:"#64748b",fontWeight:600,display:"block",marginBottom:4},
};
