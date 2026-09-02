// ============================================================
//  src/components/invoices/PurchaseInvoiceEditModal.jsx
//  Modal تعديل فاتورة المشتريات
// ============================================================
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import api from "../../services/api";

const rp   = (n) => Math.round(+n || 0);
const r2   = (n) => Math.round((+n || 0) * 100) / 100;
const fmtN = (n) => r2(n).toLocaleString("en-US");
const fmtC = (n) => `${rp(n).toLocaleString("en-US")} د.ع`;
let _lid = 0;

export default function PurchaseInvoiceEditModal({ invoiceId, onClose, onSaved }) {
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

  const newTotal = rp(lines.reduce((s,l)=>s+rp(l.price)*r2(l.qty),0) - rp(+discount));
  const oldTotal = header
    ? rp((header.oldLines||[]).reduce((s,l)=>s+rp(l.PriceIN)*r2(l.AmountIN),0) - rp(header.Dis_FIN||0))
    : 0;
  const diff = rp(newTotal - oldTotal);

  useEffect(()=>{
    if (!invoiceId) return;
    setLoading(true);
    api.get(`/invoices-in/${invoiceId}/edit-data`)
      .then(r=>{
        const hdr = r?.data?.header || r?.header;
        const lns = r?.data?.lines  || r?.lines || [];
        setHeader({ ...hdr, oldLines: lns });
        setDiscount(rp(hdr?.Dis_FIN || 0));
        setNote(hdr?.Note_FIN || "");
        setLines(lns.map(l=>({
          _lid  : ++_lid,
          matId : l.id_Material_NoM,
          name  : l.MaterialName,
          band  : l.Band||"",
          qty   : r2(l.AmountIN),
          gift  : r2(l.Gift_IN || 0),
          price : rp(l.PriceIN),
        })));
      })
      .catch(e=>setErr(e?.response?.data?.message||e.message))
      .finally(()=>setLoading(false));
  },[invoiceId]);

  const searchMat = async (val) => {
    const v=(val||"").trim(); if(!v) return;
    setMatQ(""); setMatBusy(true);
    try {
      // البحث عن المادة في API المشتريات
      const r   = await api.get(`/invoices-out/material/${encodeURIComponent(v)}`);
      const mat = r?.data || r?.material;
      if (mat?.id_Material_NoM) {
        const costPrice = rp(mat.CostPrice || mat["Cost Price"] || 0);
        setLines(prev=>{
          const i=prev.findIndex(l=>l.matId===mat.id_Material_NoM);
          if(i>=0) return prev.map((l,x)=>x===i?{...l,qty:r2(l.qty+1)}:l);
          return [...prev,{_lid:++_lid,matId:mat.id_Material_NoM,
            name:mat.MaterialName,band:mat.Band||"",qty:1,gift:0,price:costPrice}];
        });
      }
    } catch {}
    finally { setMatBusy(false); matRef.current?.focus(); }
  };

  const updQty   = (lid,q) => setLines(p=>p.map(l=>l._lid===lid?{...l,qty:Math.max(0.001,r2(+q||1))}:l));
  const updGift  = (lid,v) => setLines(p=>p.map(l=>l._lid===lid?{...l,gift:Math.max(0,r2(+v||0))}:l));
  const updPrice = (lid,v) => setLines(p=>p.map(l=>l._lid===lid?{...l,price:rp(+v||0)}:l));
  const delLine  = (lid)   => setLines(p=>p.filter(l=>l._lid!==lid));

  const save = async () => {
    setErr(""); setSaving(true);
    try {
      await api.put(`/invoices-in/${invoiceId}`,{
        Dis_FIN  : rp(+discount),
        Note_FIN : note,
        lines: lines.map(l=>({ id_Material_NoM:l.matId, AmountIN:l.qty, PriceIN:l.price, Gift_IN:l.gift||0 })),
      });
      onSaved?.();
      onClose();
    } catch(e){ setErr(e?.response?.data?.message||e.message); }
    finally { setSaving(false); }
  };

  return createPortal(
    <div style={S.overlay} onClick={e=>{ if(e.target===e.currentTarget) onClose(); }}>
      <div style={S.box}>
        <div style={S.hdr}>
          <div>
            <div style={{fontWeight:800,fontSize:"1rem",color:"#e2e8f0"}}>✏️ تعديل فاتورة مشتريات #{invoiceId}</div>
            {header&&<div style={{fontSize:".74rem",color:"#64748b",marginTop:3}}>{header.AmilName} — {header.Date_FIN?.split("T")[0]}</div>}
          </div>
          <button onClick={onClose} style={S.xBtn}>✕</button>
        </div>

        <div style={{flex:1,overflowY:"auto",padding:16,display:"flex",flexDirection:"column",gap:14}}>
          {loading ? <div style={{textAlign:"center",padding:40,color:"#64748b"}}>⏳ جاري التحميل...</div> : <>

            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <input ref={matRef} value={matQ}
                onChange={e=>setMatQ(e.target.value)}
                onKeyDown={e=>{ if(e.key==="Enter") searchMat(matQ); }}
                placeholder="📦 أضف مادة — باركود أو اسم ثم Enter"
                style={S.inp}/>
              {matBusy&&<span style={{color:"#64748b"}}>⏳</span>}
            </div>

            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:".82rem"}}>
                <thead>
                  <tr style={{background:"#070d1a",borderBottom:"2px solid #1e293b"}}>
                    {["المادة","الكمية","الهدايا","سعر الشراء","الإجمالي",""].map((h,i)=>(
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
                          <button onClick={()=>updQty(l._lid,l.qty-1)} style={S.qBtn}>−</button>
                          <input type="number" min="0.001" step="any" value={l.qty}
                            onChange={e=>updQty(l._lid,e.target.value)} style={{width:44,...S.numIn}}/>
                          <button onClick={()=>updQty(l._lid,l.qty+1)} style={{...S.qBtn,background:"#166534",color:"#4ade80"}}>+</button>
                        </div>
                      </td>
                      <td style={{padding:"7px 10px"}}>
                        <input type="number" min="0" step="any" value={l.gift}
                          onChange={e=>updGift(l._lid,e.target.value)}
                          style={{width:44,...S.numIn,color:(+l.gift||0)>0?"#4ade80":"#e2e8f0"}}/>
                      </td>
                      <td style={{padding:"7px 10px"}}>
                        <input type="number" min="0" step="1" value={l.price}
                          onChange={e=>updPrice(l._lid,e.target.value)}
                          style={{width:90,...S.numIn,color:"#fbbf24"}}/>
                      </td>
                      <td style={{padding:"7px 10px",fontFamily:"monospace",fontWeight:700,color:"#4ade80"}}>
                        {fmtC(rp(l.price)*r2(l.qty))}
                      </td>
                      <td style={{padding:"7px 10px"}}>
                        <button onClick={()=>delLine(l._lid)} style={{background:"none",border:"none",color:"#ef4444",cursor:"pointer"}}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <div>
                <label style={S.lbl}>خصم (د.ع)</label>
                <input type="number" min="0" step="1" value={discount}
                  onChange={e=>setDiscount(rp(+e.target.value||0))} style={S.inp}/>
              </div>
              <div>
                <label style={S.lbl}>ملاحظة</label>
                <input value={note} onChange={e=>setNote(e.target.value)} style={S.inp}/>
              </div>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
              {[
                {l:"المبلغ القديم",v:oldTotal,c:"#94a3b8"},
                {l:"المبلغ الجديد",v:newTotal,c:"#93c5fd"},
                {l:"الفارق",v:diff,c:diff>0?"#f87171":diff<0?"#4ade80":"#64748b"},
              ].map((x,i)=>(
                <div key={i} style={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:8,padding:"10px 12px"}}>
                  <div style={{fontSize:".68rem",color:"#64748b"}}>{x.l}</div>
                  <div style={{fontFamily:"monospace",fontWeight:900,color:x.c,fontSize:"1rem"}}>{fmtC(Math.abs(x.v))}</div>
                  {i===2&&diff!==0&&<div style={{fontSize:".68rem",color:x.c,marginTop:2}}>{diff>0?"سيزداد الدين":"سيُخفَّض الدين"}</div>}
                </div>
              ))}
            </div>

            {err&&<div style={{padding:"6px 10px",background:"#450a0a",border:"1px solid #ef4444",borderRadius:6,color:"#f87171",fontWeight:600}}>⚠ {err}</div>}
          </>}
        </div>

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

const S = {
  overlay:{position:"fixed",inset:0,background:"rgba(0,0,0,.85)",backdropFilter:"blur(5px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9999,padding:16},
  box    :{background:"#0a0f1e",border:"1px solid #1e293b",borderRadius:14,width:"min(90vw,780px)",maxHeight:"90vh",display:"flex",flexDirection:"column"},
  hdr    :{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"13px 16px",borderBottom:"1px solid #1e293b",background:"#070d1a",borderRadius:"14px 14px 0 0",flexShrink:0},
  xBtn   :{background:"none",border:"none",color:"#64748b",cursor:"pointer",fontSize:"1.1rem"},
  inp    :{width:"100%",padding:"7px 10px",background:"#0a0f1e",border:"1px solid #1e293b",borderRadius:7,color:"#e2e8f0",fontFamily:"inherit",fontSize:".86rem",outline:"none"},
  numIn  :{padding:"4px 6px",background:"#1e293b",border:"1px solid #334155",borderRadius:5,color:"#e2e8f0",fontFamily:"monospace",fontWeight:700,fontSize:".8rem",outline:"none",textAlign:"right"},
  qBtn   :{width:20,height:20,borderRadius:4,border:"1px solid #334155",background:"#1e293b",color:"#f87171",fontWeight:900,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0},
  lbl    :{fontSize:".72rem",color:"#64748b",fontWeight:600,display:"block",marginBottom:4},
};
