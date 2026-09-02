import { StrictMode, Component } from "react";
import { createRoot }           from "react-dom/client";
import { AuthProvider }         from "@/context/AuthContext";
import { ThemeProvider }        from "@/context/ThemeContext";
import { CompanyProvider } from "@/context/CompanyContext";
import { NumberLocaleProvider } from "@/context/NumberLocaleContext";
import { LanguageProvider }     from "@/context/LanguageContext";
import App                      from "@/App";
import "@/index.css";
import "@/mobile.css";

// عند التمرير بعجلة الماوس فوق حقل — أزل التركيز ليتحرك الصف
document.addEventListener("wheel", (e) => {
  const el = document.activeElement;
  if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT")) {
    el.blur();
  }
}, { passive: true });

// ── Error Boundary — يعرض الخطأ بدلاً من الشاشة السوداء ──
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) {
      return (
        <div dir="rtl" style={{
          padding:40, fontFamily:"monospace", background:"#0f172a",
          color:"#f8fafc", minHeight:"100vh"
        }}>
          <h2 style={{color:"#ef4444"}}>❌ خطأ في التطبيق</h2>
          <pre style={{
            background:"#1e293b", padding:20, borderRadius:8,
            color:"#fca5a5", whiteSpace:"pre-wrap", fontSize:13
          }}>
            {this.state.error?.message}
            {"\n\n"}
            {this.state.error?.stack}
          </pre>
          <button onClick={()=>window.location.reload()}
            style={{marginTop:20,padding:"10px 24px",background:"#3b82f6",
              color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontSize:15}}>
            🔄 إعادة تحميل
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <CompanyProvider>
            <NumberLocaleProvider>
              <LanguageProvider>
                <App />
              </LanguageProvider>
            </NumberLocaleProvider>
          </CompanyProvider>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>
);
