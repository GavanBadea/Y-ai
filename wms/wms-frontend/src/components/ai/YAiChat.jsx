// ============================================================
//  src/components/ai/YAiChat.jsx  v3.0
//  دليل Y-ai المحلي — أقسام + بحث بالكلمات + روابط تنقل
// ============================================================
import { useState, useRef, useEffect, useCallback } from "react";
import { navigateInApp } from "@/services/api";
import { YAI_GUIDE_CATEGORIES, YAI_QUICK_QUESTIONS } from "@/data/yaiGuideContent";
import {
  searchGuide,
  getGuideQuestionById,
  buildNoMatchMessage,
} from "@/utils/yaiGuideSearch";

// ── ثيمات نافذة الدردشة ──────────────────────────────────────
const T = {
  dark: {
    bg:"rgba(13,17,23,0.97)", surface:"#161b24", card:"#1c2333",
    border:"#30363d", text:"#e6edf3", muted:"#8b949e",
    accent:"#d4a012", user:"#1c2333",
    bot:"rgba(212,160,18,0.08)", botB:"rgba(212,160,18,0.25)",
    input:"#0d1117", hdr:"linear-gradient(135deg,#1a2035,#0f1520)",
    blur:"none", tBg:"#1c2333", tHead:"#0d1117",
    tRow:"rgba(255,255,255,0.02)", tAlt:"rgba(255,255,255,0.04)",
    badge:"rgba(212,160,18,0.15)",
  },
  light: {
    bg:"rgba(248,250,252,0.98)", surface:"#fff", card:"#f8fafc",
    border:"#e2e8f0", text:"#1a1f2e", muted:"#64748b",
    accent:"#b8860b", user:"#f1f5f9",
    bot:"#fffbf0", botB:"rgba(184,134,11,0.25)",
    input:"#fff", hdr:"linear-gradient(135deg,#b8860b,#d4a012)",
    blur:"none", tBg:"#fff", tHead:"#f8fafc",
    tRow:"rgba(0,0,0,0.01)", tAlt:"rgba(0,0,0,0.03)",
    badge:"rgba(184,134,11,0.12)",
  },
  glass: {
    bg:"rgba(10,14,26,0.55)", surface:"rgba(255,255,255,0.06)", card:"rgba(255,255,255,0.08)",
    border:"rgba(255,255,255,0.13)", text:"#eef4ff", muted:"#8099bb",
    accent:"#90c8ff", user:"rgba(255,255,255,0.07)",
    bot:"rgba(144,200,255,0.08)", botB:"rgba(144,200,255,0.25)",
    input:"rgba(0,0,0,0.25)", hdr:"linear-gradient(135deg,rgba(29,78,216,0.6),rgba(124,58,237,0.6))",
    blur:"blur(20px) saturate(160%)", tBg:"rgba(255,255,255,0.05)", tHead:"rgba(255,255,255,0.08)",
    tRow:"rgba(255,255,255,0.02)", tAlt:"rgba(255,255,255,0.04)",
    badge:"rgba(144,200,255,0.15)",
  },
};

const WELCOME = {
  role: "assistant",
  content:
    "مرحباً! أنا **دليل Y-ai** — مساعدك داخل البرنامج.\n\n" +
    "• اختر **قسماً** من الشريط أعلاه ثم اضغط السؤال.\n" +
    "• أو **اكتب كلمات** في مربع البحث — مثل: *ميزان*، *كيف أبدأ*، *تقارير*.\n\n" +
    "الإجابات من دليل محلي ثابت — **بدون ذكاء اصطناعي خارجي**.",
};

// ── محوّل Markdown بسيط يدعم الجداول ──────────────────────────
function Md({ text, c }) {
  if (!text) return null;
  const lines = text.split("\n");
  const out = [];
  let tRows = [], inT = false, i = 0;
  const flush = () => {
    if (!tRows.length) return;
    const [hdr,,,...body] = tRows;
    const heads = hdr.split("|").map(s=>s.trim()).filter(Boolean);
    out.push(
      <div key={"t"+i} style={{overflowX:"auto",margin:"8px 0",borderRadius:8,border:"1px solid "+c.border,fontSize:".82rem"}}>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead>
            <tr style={{background:c.tHead}}>
              {heads.map((h,j)=>(
                <th key={j} style={{padding:"7px 12px",textAlign:"right",color:c.accent,fontWeight:700,borderBottom:"1px solid "+c.border,whiteSpace:"nowrap"}}>
                  {h.replace(/\*\*/g,"")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row,ri)=>{
              const cells=row.split("|").map(s=>s.trim()).filter(Boolean);
              return(
                <tr key={ri} style={{background:ri%2===0?c.tRow:c.tAlt}}>
                  {cells.map((cl,ci)=>(
                    <td key={ci} style={{padding:"7px 12px",color:c.text,borderBottom:"1px solid "+c.border}}>
                      <Inline text={cl} c={c}/>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
    tRows=[]; inT=false;
  };
  while(i<lines.length){
    const l=lines[i];
    if(l.includes("|")&&l.trim().startsWith("|")){inT=true;tRows.push(l);}
    else{
      if(inT)flush();
      if(l.trim()==="") out.push(<div key={i} style={{height:5}}/>);
      else if(l.startsWith("• ")||l.startsWith("- "))
        out.push(<div key={i} style={{display:"flex",gap:6,margin:"3px 0",color:c.text,fontSize:".9rem"}}><span style={{color:c.accent,flexShrink:0}}>•</span><Inline text={l.slice(2)} c={c}/></div>);
      else
        out.push(<p key={i} style={{margin:"3px 0",color:c.text,fontSize:".9rem",lineHeight:1.7}}><Inline text={l} c={c}/></p>);
    }
    i++;
  }
  if(inT)flush();
  return <div>{out}</div>;
}
function Inline({text,c}){
  return<>{text.split(/(\*\*.*?\*\*)/g).map((p,i)=>
    p.startsWith("**")&&p.endsWith("**")
      ?<strong key={i} style={{color:c.text,fontWeight:700}}>{p.slice(2,-2)}</strong>
      :<span key={i}>{p}</span>
  )}</>;
}

function NavLinks({ links, c, onNavigate }) {
  if (!links?.length) return null;
  return (
    <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid " + c.border, display: "flex", flexWrap: "wrap", gap: 6 }}>
      {links.map((lnk) => (
        <button
          key={lnk.path + lnk.label}
          type="button"
          onClick={() => onNavigate(lnk.path)}
          style={{
            padding: "5px 10px",
            background: c.badge,
            border: "1px solid " + c.border,
            borderRadius: 8,
            color: c.accent,
            cursor: "pointer",
            fontSize: ".72rem",
            fontWeight: 700,
            fontFamily: "inherit",
          }}
        >
          ↗ {lnk.label}
        </button>
      ))}
    </div>
  );
}

function SuggestionButtons({ suggestions, c, onPick }) {
  if (!suggestions?.length) return null;
  return (
    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 5 }}>
      {suggestions.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onPick(s)}
          style={{
            textAlign: "right",
            padding: "7px 10px",
            background: c.card,
            border: "1px solid " + c.border,
            borderRadius: 8,
            color: c.text,
            cursor: "pointer",
            fontSize: ".85rem",
            lineHeight: 1.45,
            fontFamily: "inherit",
          }}
        >
          {s.categoryIcon} {s.title}
        </button>
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
export default function YAiChat() {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState("dark");
  const [msgs, setMsgs] = useState([WELCOME]);
  const [input, setInput] = useState("");
  const [pulse, setPulse] = useState(false);
  const endRef = useRef(null);
  const inputRef = useRef(null);
  const dragRef = useRef({ dragging: false, moved: false, ox: 0, oy: 0, sx: 0, sy: 0 });
  const c = T[theme];

  const [pos, setPos] = useState(() => {
    const w = typeof window !== "undefined" ? window.innerWidth : 400;
    const h = typeof window !== "undefined" ? window.innerHeight : 800;
    const clampFab = (p) => {
      const x = Math.max(8, Math.min(w - 68, p.x));
      if (p.y != null) {
        return { x, y: Math.max(8, Math.min(h - 68, p.y)), bottom: null };
      }
      const bottom = Math.max(72, Math.min(h - 68, p.bottom ?? 80));
      return { x, y: null, bottom };
    };
    try {
      const s = JSON.parse(localStorage.getItem("yai-position") || "null");
      if (s && typeof s.x === "number") return clampFab(s);
    } catch { /* ignore */ }
    // افتراضي: أسفل يمين الشاشة (مناسب لـ RTL) وفوق شريط الموبايل
    return clampFab({ x: w - 88, y: null, bottom: 80 });
  });

  const savePos = useCallback((p) => {
    setPos(p);
    localStorage.setItem("yai-position", JSON.stringify(p));
  }, []);

  const fabStyle = pos.y != null
    ? { position: "fixed", left: pos.x, top: pos.y, zIndex: 1000 }
    : { position: "fixed", left: pos.x, bottom: pos.bottom ?? 28, zIndex: 1000 };

  const PANEL_W = Math.min(1040, typeof window !== "undefined" ? window.innerWidth - 24 : 1040);
  const PANEL_H = Math.min(
    typeof window !== "undefined" ? Math.round(window.innerHeight * 0.9) : 860,
    typeof window !== "undefined" ? window.innerHeight - 24 : 860
  );
  const SIDEBAR_W = Math.min(420, Math.round(PANEL_W * 0.4));

  const panelStyle = {
    position: "fixed",
    left: Math.max(12, Math.round((window.innerWidth - PANEL_W) / 2)),
    top: Math.max(12, Math.round((window.innerHeight - PANEL_H) / 2)),
    zIndex: 999,
  };

  const onFabMouseDown = (e) => {
    if (e.button !== 0) return;
    dragRef.current = {
      dragging: true, moved: false,
      ox: e.clientX, oy: e.clientY,
      sx: pos.x, sy: pos.y ?? (window.innerHeight - (pos.bottom ?? 28) - 60),
    };
    e.preventDefault();
  };

  const onFabTouchStart = (e) => {
    const t = e.touches[0];
    if (!t) return;
    dragRef.current = {
      dragging: true, moved: false,
      ox: t.clientX, oy: t.clientY,
      sx: pos.x, sy: pos.y ?? (window.innerHeight - (pos.bottom ?? 28) - 60),
    };
  };

  const moveFab = useCallback((clientX, clientY) => {
    const d = dragRef.current;
    if (!d.dragging) return;
    const dx = clientX - d.ox;
    const dy = clientY - d.oy;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) d.moved = true;
    const nx = Math.max(8, Math.min(window.innerWidth - 68, d.sx + dx));
    const ny = Math.max(8, Math.min(window.innerHeight - 68, d.sy + dy));
    savePos({ x: nx, y: ny, bottom: null });
  }, [savePos]);

  useEffect(() => {
    const onMove = (e) => moveFab(e.clientX, e.clientY);
    const onTouchMove = (e) => {
      if (!dragRef.current.dragging) return;
      const t = e.touches[0];
      if (!t) return;
      e.preventDefault();
      moveFab(t.clientX, t.clientY);
    };
    const onUp = () => { dragRef.current.dragging = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onUp);
    window.addEventListener("touchcancel", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onUp);
      window.removeEventListener("touchcancel", onUp);
    };
  }, [moveFab]);

  useEffect(() => {
    if (open) return;
    const iv = setInterval(() => { setPulse(true); setTimeout(() => setPulse(false), 1200); }, 25000);
    return () => clearInterval(iv);
  }, [open]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 150); }, [open]);

  const goToSection = useCallback((path) => {
    navigateInApp(path);
    setOpen(false);
  }, []);

  const pushAnswer = useCallback((question) => {
    setMsgs((p) => [
      ...p,
      { role: "user", content: question.title },
      {
        role: "assistant",
        content: question.answer,
        links: question.links || [],
      },
    ]);
  }, []);

  const handleSearch = useCallback((txt) => {
    const trimmed = txt.trim();
    if (!trimmed) return;

    setMsgs((p) => [...p, { role: "user", content: trimmed }]);

    const byId = getGuideQuestionById(trimmed);
    if (byId) {
      pushAnswer(byId);
      return;
    }

    const result = searchGuide(trimmed);

    if (result.type === "match") {
      pushAnswer(result.question);
      return;
    }

    if (result.type === "ambiguous") {
      setMsgs((p) => [
        ...p,
        {
          role: "assistant",
          content: "وجدت أكثر من سؤال قريب — اختر المناسب:",
          suggestions: result.suggestions,
        },
      ]);
      return;
    }

    if (result.type === "none" || result.type === "empty") {
      setMsgs((p) => [
        ...p,
        {
          role: "assistant",
          content: buildNoMatchMessage(result.suggestions || []),
          suggestions: result.suggestions || [],
        },
      ]);
    }
  }, [pushAnswer]);

  const send = useCallback(() => {
    const txt = input.trim();
    if (!txt) return;
    setInput("");
    handleSearch(txt);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [input, handleSearch]);

  const onKey = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } };

  const THEMES = [{ id: "dark", l: "🌙" }, { id: "light", l: "☀️" }, { id: "glass", l: "🔷" }];
  const quickQuestions = YAI_QUICK_QUESTIONS.map((id) => getGuideQuestionById(id)).filter(Boolean);

  return (
    <>
      <button
        className={["yai-fab", pulse && !open ? "is-pulsing" : "", pos.y != null ? "yai-fab--custom-pos" : ""].filter(Boolean).join(" ")}
        style={{ ...fabStyle, bottom: fabStyle.bottom, left: fabStyle.left, top: fabStyle.top, position: "fixed" }}
        onMouseDown={onFabMouseDown}
        onTouchStart={onFabTouchStart}
        onClick={() => { if (!dragRef.current.moved) setOpen((v) => !v); dragRef.current.moved = false; }}
        title="Y-ai — اسحب لتحريك | انقر للدليل"
      >
        <span className="yai-ring" />
        <span className="yai-core">
          {open
            ? <span style={{ fontSize: "1rem", color: "var(--text-muted,#94a3b8)", fontWeight: 700, lineHeight: 1 }}>✕</span>
            : <>
                <span className="yai-y">Y</span>
                <span className="yai-dots">
                  {[0, 1, 2].map((d) => (
                    <span key={d} style={{ animationDelay: d * 0.18 + "s" }} />
                  ))}
                </span>
              </>
          }
          <span className="yai-dot is-online" />
        </span>
      </button>

      {open && (
        <div style={{
          ...panelStyle,
          width: PANEL_W,
          height: PANEL_H,
          borderRadius: 20, overflow: "hidden", zIndex: 999,
          display: "flex", flexDirection: "column", direction: "rtl",
          background: c.bg, border: "1px solid " + c.border,
          backdropFilter: c.blur, WebkitBackdropFilter: c.blur,
          boxShadow: "0 12px 48px rgba(0,0,0,.45),0 2px 8px rgba(0,0,0,.3)",
        }}>

          <div style={{ background: c.hdr, padding: "14px 18px", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: "50%", border: "1.5px dashed rgba(255,255,255,.7)", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,.1)", flexShrink: 0 }}>
                  <span style={{ fontWeight: 900, fontSize: "1.1rem", color: "#fff", lineHeight: 1 }}>Y</span>
                </div>
                <div>
                  <div style={{ fontWeight: 800, color: "#fff", fontSize: "1rem" }}>دليل Y-ai</div>
                  <div style={{ fontSize: ".78rem", color: "rgba(255,255,255,.75)", display: "flex", alignItems: "center", gap: 5 }}>
                    <span className="yai-dot is-online" style={{ width: 7, height: 7, position: "static", border: "none", transform: "scale(.7)", flexShrink: 0 }} />
                    جاهز — بحث بالكلمات
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMsgs([WELCOME])}
                style={{ background: "rgba(255,255,255,.15)", border: "none", color: "#fff", borderRadius: 6, padding: "5px 12px", cursor: "pointer", fontSize: ".78rem", fontWeight: 600, fontFamily: "inherit" }}
              >
                مسح المحادثة
              </button>
            </div>
            <div style={{ display: "flex", gap: 3, background: "rgba(0,0,0,.2)", borderRadius: 20, padding: "3px", width: "fit-content" }}>
              {THEMES.map(({ id, l }) => (
                <button key={id} type="button" onClick={() => setTheme(id)} style={{ padding: "4px 12px", borderRadius: 20, border: "none", background: theme === id ? "rgba(255,255,255,.9)" : "transparent", color: theme === id ? "#1a1f2e" : "rgba(255,255,255,.75)", fontSize: ".78rem", fontWeight: theme === id ? 700 : 500, cursor: "pointer", fontFamily: "inherit", transition: "all .2s" }}>
                  {l}
                </button>
              ))}
            </div>
          </div>

          <div style={{ flex: 1, display: "flex", minHeight: 0, direction: "rtl" }}>
            {/* الشريط الجانبي — جميع الأقسام والأسئلة */}
            <div style={{
              width: SIDEBAR_W,
              flexShrink: 0,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              borderLeft: "1px solid " + c.border,
              background: c.surface,
            }}>
              <div style={{ padding: "12px 14px 8px", fontSize: ".85rem", fontWeight: 700, color: c.accent, flexShrink: 0 }}>
                الأقسام والأسئلة
              </div>
              <div style={{
                flex: 1,
                minHeight: 0,
                overflowY: "auto",
                padding: "0 12px 12px",
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}>
                {YAI_GUIDE_CATEGORIES.map((cat) => (
                  <section key={cat.id}>
                    <div style={{
                      fontSize: ".84rem",
                      color: c.accent,
                      fontWeight: 800,
                      padding: "6px 8px",
                      marginBottom: 6,
                      background: c.badge,
                      borderRadius: 8,
                      border: "1px solid " + c.border,
                      lineHeight: 1.5,
                    }}>
                      {cat.icon} {cat.title}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {cat.questions.map((q) => (
                        <button
                          key={q.id}
                          type="button"
                          onClick={() => pushAnswer({ ...q, categoryIcon: cat.icon, categoryTitle: cat.title })}
                          style={{
                            width: "100%",
                            textAlign: "right",
                            padding: "10px 12px",
                            background: c.card,
                            border: "1px solid " + c.border,
                            borderRadius: 10,
                            color: c.text,
                            cursor: "pointer",
                            fontSize: ".86rem",
                            lineHeight: 1.55,
                            fontFamily: "inherit",
                            whiteSpace: "normal",
                            wordBreak: "break-word",
                          }}
                        >
                          {q.title}
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>

            {/* منطقة الإجابات */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
              <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px 10px", display: "flex", flexDirection: "column", gap: 14, background: c.bg }}>
                {msgs.map((m, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-start" : "flex-end" }}>
                    {m.role === "assistant" && (
                      <div style={{ width: 30, height: 30, borderRadius: "50%", border: "1.5px dashed " + c.accent, display: "flex", alignItems: "center", justifyContent: "center", background: c.card, flexShrink: 0, marginLeft: 8, marginTop: 2 }}>
                        <span style={{ fontSize: ".8rem", fontWeight: 900, color: c.accent }}>Y</span>
                      </div>
                    )}
                    <div style={{
                      maxWidth: "92%",
                      padding: "12px 16px",
                      borderRadius: m.role === "user" ? "14px 14px 14px 3px" : "14px 14px 3px 14px",
                      background: m.role === "user" ? c.user : c.bot,
                      border: "1px solid " + (m.role === "user" ? c.border : c.botB),
                      color: c.text,
                    }}>
                      <Md text={m.content} c={c} />
                      <NavLinks links={m.links} c={c} onNavigate={goToSection} />
                      {m.suggestions?.length > 0 && (
                        <SuggestionButtons
                          suggestions={m.suggestions}
                          c={c}
                          onPick={(q) => pushAnswer(q)}
                        />
                      )}
                    </div>
                  </div>
                ))}
                <div ref={endRef} />
              </div>

              <div style={{ padding: "8px 14px", borderTop: "1px solid " + c.border, display: "flex", gap: 6, flexWrap: "wrap", flexShrink: 0, background: c.surface }}>
                {quickQuestions.map((q) => (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => handleSearch(q.title)}
                    style={{ padding: "5px 11px", background: c.badge, border: "1px solid " + c.border, borderRadius: 20, color: c.muted, cursor: "pointer", fontSize: ".78rem", fontFamily: "inherit", fontWeight: 600, whiteSpace: "nowrap", transition: "all .15s" }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = c.accent; e.currentTarget.style.borderColor = c.accent; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = c.muted; e.currentTarget.style.borderColor = c.border; }}
                  >
                    {q.categoryIcon || "📌"} {q.title}
                  </button>
                ))}
              </div>

              <div style={{ padding: "12px 14px", borderTop: "1px solid " + c.border, display: "flex", gap: 10, flexShrink: 0, background: c.surface }}>
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKey}
                  placeholder='ابحث بالكلمات... مثل "ميزان" أو "كيف أبدأ"'
                  style={{ flex: 1, padding: "11px 14px", background: c.input, border: "1px solid " + c.border, borderRadius: 12, color: c.text, fontSize: ".92rem", fontFamily: "inherit", outline: "none", direction: "rtl" }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = c.accent; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = c.border; }}
                />
                <button
                  type="button"
                  onClick={send}
                  disabled={!input.trim()}
                  style={{ padding: "11px 18px", background: !input.trim() ? c.card : "linear-gradient(135deg,#1d4ed8,#7c3aed)", border: "none", borderRadius: 12, color: !input.trim() ? c.muted : "#fff", cursor: !input.trim() ? "not-allowed" : "pointer", fontWeight: 700, fontSize: ".9rem", transition: "all .2s", flexShrink: 0, fontFamily: "inherit" }}
                >
                  بحث
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
