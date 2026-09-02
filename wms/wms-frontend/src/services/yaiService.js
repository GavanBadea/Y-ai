// src/services/yaiService.js
import axios from "axios";

const Y_AI_URL = import.meta.env.VITE_YAI_URL || "/yai";

const yai = axios.create({
  baseURL : Y_AI_URL,
  timeout : 90000,
  headers : { "Content-Type": "application/json" },
});

yai.interceptors.response.use(
  (r) => r.data,
  (e) => {
    // ECONNREFUSED = الخدمة متوقفة فعلاً
    const isOffline =
      !e.response &&
      (e.code === "ECONNREFUSED" ||
       e.code === "ERR_NETWORK" ||
       e.message?.includes("Network Error"));

    // TIMEOUT = الخدمة شغّالة لكن بطيئة (Ollama يفكّر)
    const isTimeout = e.code === "ECONNABORTED" || e.message?.includes("timeout");

    if (isOffline) {
      return Promise.reject({
        message: "Y-ai غير متاح — شغّل الخدمة: python Y-ai.py",
        offline: true,
        timeout: false,
      });
    }
    if (isTimeout) {
      return Promise.reject({
        message: "استغرق الرد وقتاً طويلاً. يرجى المحاولة مجدداً.",
        offline: false,
        timeout: true,
      });
    }
    return Promise.reject({
      message: e.response?.data?.detail || e.response?.data?.message || "خطأ في Y-ai",
      offline: false,
      timeout: false,
    });
  }
);

export const yaiHealth          = () => yai.get("/health").catch(() => null);
export const yaiInsights        = () => yai.get("/insights");
export const yaiDailyTip        = () => yai.get("/daily-tip");
export const yaiPredictStockout = (days = 7) => yai.get(`/predict/stockout?days=${days}`);
export const yaiPredictCashFlow = () => yai.get("/predict/cashflow");
export const yaiTopCustomers    = (limit = 5) => yai.get(`/analytics/top-customers?limit=${limit}`);
export const yaiReturnLosses    = () => yai.get("/analytics/return-losses");
export const yaiSuppliers       = () => yai.get("/analytics/suppliers");
export const yaiFinance         = () => yai.get("/analytics/finance");
export const yaiCheckPrice      = (id, price, type = "purchase") =>
  yai.post("/check-price", { id_Material_NoM: id, price, price_type: type });
export const yaiChat            = (message, history = [], token = null) =>
  yai.post("/chat", {
    message,
    history: history.map(h => ({ role: h.role, content: h.content })),
    token,
  });
export const yaiClearCache      = () => yai.post("/cache/clear");

// ── تحديث فوري للكاش المالي ─────────────────────────────────────
export const yaiForceRefresh      = () => yai.post("/quick/refresh");
export const yaiQuickBalanceFresh = () => yai.get("/quick/balance?refresh=true");
export const yaiQuickDebtsFresh   = () => yai.get("/quick/debts?refresh=true");

// ── بث الدردشة (Server-Sent Events) ─────────────────────────────
// يُرجع { promise, cancel }
// promise → Response object (fetch API) يمكن قراءته كـ stream
// cancel  → دالة لإلغاء الطلب عند الحاجة
export const yaiChatStream = (message, history = [], token = null) => {
  const controller = new AbortController();

  const promise = fetch(`${Y_AI_URL}/chat/stream`, {
    method : "POST",
    headers: { "Content-Type": "application/json" },
    signal : controller.signal,
    body   : JSON.stringify({
      message,
      history: history.map(h => ({ role: h.role, content: h.content })),
      token,
    }),
  });

  return {
    promise,
    cancel: () => controller.abort(),
  };
};
