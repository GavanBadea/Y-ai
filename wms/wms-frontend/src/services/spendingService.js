// ============================================================
//  src/services/spendingService.js
//  خدمات المصاريف ورأس المال — ملف مستقل
//
//  الخدمات:
//   spendingTopicsService  → CRUD لـ Spending_tbl (مواضيع الصرف)
//   spendingTxService      → CRUD لـ SpendingDetails_tbl (عمليات الصرف)
//   capitalService         → رأس المال وملخص الصندوق
// ============================================================
import api from "@/services/api";

// ── مواضيع الصرف (Spending_tbl) ─────────────────────────────
export const spendingTopicsService = {
  getAll : ()         => api.get("/spending"),
  getOne : (id)       => api.get(`/spending/${id}`),
  create : (data)     => api.post("/spending", data),
  update : (id, data) => api.put(`/spending/${id}`, data),
  remove : (id)       => api.delete(`/spending/${id}`),
  listGlAccounts: () => api.get("/spending/gl-accounts"),
};

// ── عمليات الصرف (SpendingDetails_tbl) ──────────────────────
export const spendingTxService = {
  getAll : (params)   => api.get("/spending-details", { params }),
  getOne : (id)       => api.get(`/spending-details/${id}`),
  create : (data)     => api.post("/spending-details", data),
  update : (id, data) => api.put(`/spending-details/${id}`, data),
  remove : (id)       => api.delete(`/spending-details/${id}`),
};

// ── رأس المال وملخص الصندوق ──────────────────────────────────
export const capitalService = {
  get     : ()     => api.get("/capital"),
  set     : (data) => api.post("/capital", data),
  history : ()     => api.get("/capital/history"),
  summary : ()     => api.get("/capital/summary"),
  update  : (id, data) => api.put(`/capital/history/${id}`, data),
  remove  : (id)       => api.delete(`/capital/history/${id}`),
};
