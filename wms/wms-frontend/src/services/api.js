// ============================================================
//  src/services/api.js
//  Axios Instance — التواصل مع الباك أند
//
//  الميزات:
//   • Base URL موحّد
//   • إرسال التوكن تلقائياً في كل طلب
//   • معالجة أخطاء 401/403 بشكل مركزي
//   • إعادة توجيه المستخدم لصفحة الدخول عند انتهاء التوكن
// ============================================================
import axios from "axios";
import { getApiBase } from "@/utils/apiBase";
import { getToken, clearAuthSession } from "@/utils/authStorage";

// ── الرابط الأساسي للباك أند ───────────────────────────────
const BASE_URL = getApiBase();

/** توجيه SPA — يُسجَّل من App.jsx (بدون إعادة تحميل = السيرفر يبقى يعمل) */
let spaNavigate = null;
export function registerSpaNavigate(navigateFn) {
  spaNavigate = navigateFn;
}

export function navigateInApp(path, options = { replace: true }) {
  if (spaNavigate) {
    spaNavigate(path, options);
    return true;
  }
  return false;
}

function goToActivationPage() {
  if (window.location.pathname === "/activate") return;
  if (navigateInApp("/activate")) return;
  window.location.href = "/activate";
}

// ── إنشاء Instance مخصص ────────────────────────────────────
const api = axios.create({
  baseURL : BASE_URL + "/api",
  timeout : 30000,
  headers : {
    "Content-Type": "application/json",
    Accept         : "application/json",
  },
});

// ══════════════════════════════════════════════════════════
//  Request Interceptor — إضافة التوكن لكل طلب تلقائياً
// ══════════════════════════════════════════════════════════
api.interceptors.request.use(
  (config) => {
    const token = getToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ══════════════════════════════════════════════════════════
//  Response Interceptor — معالجة الأخطاء المركزية
// ══════════════════════════════════════════════════════════
api.interceptors.response.use(
  // ── النجاح: أرجع البيانات مباشرة ──────────────────────
  (response) => response.data,

  // ── الخطأ: معالجة موحّدة ──────────────────────────────
  async (error) => {
    const status  = error.response?.status;
    const data    = error.response?.data;
    const message = data?.message || "حدث خطأ في الاتصال — تأكد من تشغيل الخادم";

    // 402 → الترخيص مطلوب (توجيه داخلي — لا pagehide ولا إيقاف السيرفر)
    if (status === 402 && data?.licenseRequired) {
      goToActivationPage();
      return Promise.reject({ status, message, data });
    }

    // 401 أو 403 → التوكن منتهي أو غير صالح
    if (status === 401 || status === 403) {
      const url = error.config?.url || "";
      if (!url.includes("/users/login") && !url.includes("/users/admin-hint")) {
        clearAuthSession();
        window.location.href = "/login";
      }
    }

    // شبكة مقطوعة — إعادة المحاولة مرة واحدة بعد ثانيتين
    if (!error.response && !error.config?._retried) {
      error.config._retried = true;
      await new Promise((r) => setTimeout(r, 2000));
      try {
        return await api(error.config);
      } catch {
        // استمرار برفض الخطأ الأصلي
      }
    }

    const normalizedError = {
      status,
      message,
      data: data || null,
    };

    return Promise.reject(normalizedError);
  }
);

export default api;

// ══════════════════════════════════════════════════════════
//  Services جاهزة — تُستدعى من الصفحات والـ Hooks
// ══════════════════════════════════════════════════════════

// ── المصادقة ───────────────────────────────────────────────
export const authService = {
  checkFirstRun: ()                    => api.get("/users/check-first-run"),
  login        : (credentials)         => api.post("/users/login", credentials),
  setupAdmin   : (data, config = {})   => api.post("/users/setup-admin", data, config),
  adminHint    : (verifyPassword)        => api.post("/users/admin-hint", { verifyPassword }),
  getMe        : ()                    => api.get("/users/me"),
};

// ── الترخيص ────────────────────────────────────────────────
export const licenseService = {
  getStatus: ()         => api.get("/license/status"),
  activate : (key) => api.post("/license/activate", { key }),
};

// ── المواد ─────────────────────────────────────────────────
export const materialsService = {
  getAll        : (params) => api.get("/materials", { params }),
  getOne        : (id)     => api.get(`/materials/${id}`),
  scanBarcode   : (bc)     => api.get(`/materials/scan/${bc}`),
  create        : (data)   => api.post("/materials", data),
  update        : (id, d)  => api.put(`/materials/${id}`, d),
  updatePrices  : (id, d)  => api.patch(`/materials/${id}/prices`, d),
  remove        : (id)     => api.delete(`/materials/${id}`),
};

// ── POS ────────────────────────────────────────────────────
export const posService = {
  init                  : ()      => api.get("/pos/init"),
  getMaterialsByCategory: (id, p) => api.get(`/pos/categories/${id}/materials`, { params: p }),
  searchMaterial        : (q)     => api.get(`/pos/material/${encodeURIComponent(q)}`),
  cartPreview           : (data)  => api.post("/pos/cart-preview", data),
  checkout              : (data)  => api.post("/pos/checkout", data),
  navigate              : (id, d) => api.get(`/pos/navigate/${id}/${d}`),
  getBounds             : ()      => api.get("/pos/bounds"),
};

// ── الزبائن والموردون ──────────────────────────────────────
export const partyService = {
  getCustomers  : (p)     => api.get("/party/customers", { params: p }),
  getOneCustomer: (id)    => api.get(`/party/customers/${id}`),
  createCustomer: (data)  => api.post("/party/customers", data),
  updateCustomer: (id, d) => api.put(`/party/customers/${id}`, d),
  removeCustomer: (id)    => api.delete(`/party/customers/${id}`),
  getSuppliers  : (p)     => api.get("/party/suppliers", { params: p }),
  getOneSupplier: (id)    => api.get(`/party/suppliers/${id}`),
  createSupplier: (data)  => api.post("/party/suppliers", data),
  updateSupplier: (id, d) => api.put(`/party/suppliers/${id}`, d),
};

// ── سجل العمليات (مدير فقط) ───────────────────────────────
export const auditService = {
  getAll    : (params) => api.get("/audit", { params }),
  getOne    : (id)     => api.get(`/audit/${id}`),
  getTables : ()       => api.get("/audit/meta/tables"),
  getUsers  : ()       => api.get("/audit/meta/users"),
};

// ── المستودعات والنقل المخزني ─────────────────────────────
export const warehouseService = {
  listActive : ()     => api.get("/warehouses"),
  listAll    : ()     => api.get("/warehouses/all"),
  getQty     : (whId, matId) => api.get(`/warehouses/${whId}/stock/${matId}`),
  create     : (data) => api.post("/warehouses", data),
  update     : (id, d) => api.put(`/warehouses/${id}`, d),
  remove     : (id)    => api.delete(`/warehouses/${id}`),
};

export const stockTransferService = {
  list   : (p)    => api.get("/stock-transfers", { params: p }),
  getOne : (id)   => api.get(`/stock-transfers/${id}`),
  create : (data) => api.post("/stock-transfers", data),
};

// ── فواتير المشتريات ───────────────────────────────────────
export const purchasesService = {
  getAll       : (p)    => api.get("/invoices-in", { params: p }),
  getOne       : (id)   => api.get(`/invoices-in/${id}`),
  create       : (data) => api.post("/invoices-in", data),
  remove       : (id)   => api.delete(`/invoices-in/${id}`),
  navigate     : (id,d) => api.get(`/invoices-in/${id}/navigate/${d}`),
  getBounds    : ()     => api.get("/invoices-in/bounds"),
  previewLC    : (data) => api.post("/invoices-in/preview-landed-cost", data),
};

// ── فواتير المبيعات ────────────────────────────────────────
export const salesService = {
  getAll         : (p)    => api.get("/invoices-out", { params: p }),
  getOne         : (id)   => api.get(`/invoices-out/${id}`),
  create         : (data) => api.post("/invoices-out", data),
  remove         : (id)   => api.delete(`/invoices-out/${id}`),
  navigate       : (id,d) => api.get(`/invoices-out/${id}/navigate/${d}`),
  getBounds      : ()     => api.get("/invoices-out/bounds"),
  getMaterial    : (q)    => api.get(`/invoices-out/material/${encodeURIComponent(q)}`),
  getCustomerInfo: (id)   => api.get(`/invoices-out/customer/${id}`),
};

// ── المرتجعات ──────────────────────────────────────────────
export const returnsService = {
  getAll       : (p)    => api.get("/returns", { params: p }),
  getOne       : (id)   => api.get(`/returns/${id}`),
  create       : (data) => api.post("/returns", data),
  remove       : (id)   => api.delete(`/returns/${id}`),
  getPriceDefault: (p)  => api.get("/returns/price-default", { params: p }),
};

// ── تبديل السنة المالية (مدير) ─────────────────────────────
export const fiscalSwitchService = {
  getCurrent  : () => api.get("/fiscal-switch/current"),
  getBackups  : () => api.get("/fiscal-switch/backups"),
  switchBackup: (data) => api.post("/fiscal-switch/switch", data),
};

// ── الوثائق المالية ────────────────────────────────────────
export const documentsService = {
  getCashFlowSummary: (params) => api.get("/documents/cash-flow-summary", { params }),
  getCatch    : (p)    => api.get("/documents/catch", { params: p }),
  customerProfit: (zabonId) => api.get(`/documents/catch/customer-profit/${zabonId}`),
  createCatch : (data) => api.post("/documents/catch", data),
  updateCatch : (id, data) => api.put(`/documents/catch/${id}`, data),
  removeCatch : (id)   => api.delete(`/documents/catch/${id}`),
  getPay      : (p)    => api.get("/documents/pay", { params: p }),
  createPay   : (data) => api.post("/documents/pay", data),
  updatePay   : (id, data) => api.put(`/documents/pay/${id}`, data),
  removePay   : (id)   => api.delete(`/documents/pay/${id}`),
  createDirectCatchPay: (data) => api.post("/documents/direct-catch-pay", data),
  getPrintData: (t,id) => api.get(`/documents/print/${t}/${id}`),
  navigate    : (t,id,d)=> api.get(`/documents/navigate/${t}/${id}/${d}`),
};

// ── سندات الديون السابقة (افتتاحية/يدوية) ───────────────────
export const debtService = {
  // ديون الموردين
  getSupplierDebts   : (p)    => api.get("/dion-amil", { params: p }),
  getOneSupplierDebt : (id)   => api.get(`/dion-amil/${id}`),
  createSupplierDebt : (data) => api.post("/dion-amil", data),
  updateSupplierDebt : (id,d) => api.put(`/dion-amil/${id}`, d),
  removeSupplierDebt : (id)   => api.delete(`/dion-amil/${id}`),

  // ديون الزبائن
  getCustomerDebts   : (p)    => api.get("/dion-zabon", { params: p }),
  getOneCustomerDebt : (id)   => api.get(`/dion-zabon/${id}`),
  createCustomerDebt : (data) => api.post("/dion-zabon", data),
  updateCustomerDebt : (id,d) => api.put(`/dion-zabon/${id}`, d),
  removeCustomerDebt : (id)   => api.delete(`/dion-zabon/${id}`),
};

// ── التقارير ───────────────────────────────────────────────
export const reportsService = {
  dashboard   : (p) => api.get("/reports/dashboard",    { params: p }),
  statement   : (p) => api.get("/reports/statement",    { params: p }),
  inventory   : (p) => api.get("/reports/inventory",    { params: p }),
  profitLoss  : (p) => api.get("/reports/profit-loss",  { params: p }),
  salesReps   : (p) => api.get("/reports/sales-reps",   { params: p }),
};

// ── البيانات المرجعية ──────────────────────────────────────
export const commonService = {
  getLocations : () => api.get("/common/locations"),
  getMandobs   : () => api.get("/common/mandob"),
  getPayTypes  : () => api.get("/common/pay-types"),
  getCategories: () => api.get("/common/categories"),
  getTypes     : () => api.get("/common/types"),
};

// ── المخزون ────────────────────────────────────────────────
export const stockService = {
  getAll      : (p)    => api.get("/stock", { params: p }),
  getSummary  : ()     => api.get("/stock/summary"),
  getOne      : (id)   => api.get(`/stock/${id}`),
  getMovement : (id)   => api.get(`/stock/${id}/movement`),
  adjust      : (data) => api.patch("/stock/adjust", data),
};

// ── البيانات المرجعية — CRUD كامل ─────────────────────────
export const lookupService = {
  // الأصناف
  getCategories  : ()         => api.get("/common/categories"),
  createCategory : (data)     => api.post("/common/categories", data),
  updateCategory : (id, data) => api.put(`/common/categories/${id}`, data),
  deleteCategory : (id)       => api.delete(`/common/categories/${id}`),

  // الأنواع (مع فلترة حسب الصنف للـ cascade)
  getTypes       : ()         => api.get("/common/types"),
  createType     : (data)     => api.post("/common/types", data),
  updateType     : (id, data) => api.put(`/common/types/${id}`, data),
  deleteType     : (id)       => api.delete(`/common/types/${id}`),

  // المناطق
  getLocations   : ()         => api.get("/common/locations"),
  createLocation : (data)     => api.post("/common/locations", data),
  updateLocation : (id, data) => api.put(`/common/locations/${id}`, data),
  deleteLocation : (id)       => api.delete(`/common/locations/${id}`),

  // طرق الدفع
  getPayTypes    : ()         => api.get("/common/pay-types"),
  createPayType  : (data)     => api.post("/common/pay-types", data),
  updatePayType  : (id, data) => api.put(`/common/pay-types/${id}`, data),
  deletePayType  : (id)       => api.delete(`/common/pay-types/${id}`),

  // المندوبون
  getMandobs     : ()         => api.get("/common/mandob"),
  createMandob   : (data)     => api.post("/common/mandob", data),
  updateMandob   : (id, data) => api.put(`/common/mandob/${id}`, data),
  deleteMandob   : (id)       => api.delete(`/common/mandob/${id}`),

  // الصناديق النقدية
  getCashBoxes   : ()         => api.get("/common/cash-boxes"),
  createCashBox  : (data)     => api.post("/common/cash-boxes", data),
  updateCashBox  : (id, data) => api.put(`/common/cash-boxes/${id}`, data),
  deleteCashBox  : (id)       => api.delete(`/common/cash-boxes/${id}`),
};

// ── فواتير المشتريات (PurchaseController) ─────────────────
export const purchaseService = {
  getAll   : (p)    => api.get("/purchases",              { params: p }),
  getOne   : (id)   => api.get(`/purchases/${id}`),
  create   : (data) => api.post("/purchases",             data),
  remove   : (id)   => api.delete(`/purchases/${id}`),
  navigate : (id,d) => api.get(`/purchases/${id}/navigate/${d}`),
  getBounds: ()     => api.get("/purchases/bounds"),
  previewLC: (data) => api.post("/purchases/preview-lc",  data),
};

export const systemService = {
  getUpdateMeta: () => api.get("/system/update-meta"),
};
