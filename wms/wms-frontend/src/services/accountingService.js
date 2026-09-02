// ============================================================
//  src/services/accountingService.js
// ============================================================
import api from "./api";

export const accountingService = {
  getChart           : (params) => api.get("/accounting/chart", { params }),
  getIncomeStatement : (params) => api.get("/accounting/income-statement", { params }),
  getGeneralTaxDetails: (params) => api.get("/accounting/general-tax-details", { params }),
  getAccountDetails  : (params) => api.get("/accounting/account-details", { params }),
  getBalanceSheet    : (params) => api.get("/accounting/balance-sheet", { params }),
  listGlAccounts     : () => api.get("/accounting/gl-accounts"),
  listGlParents      : () => api.get("/accounting/gl-parents"),
  createGlAccount    : (data) => api.post("/accounting/gl-accounts", data),
  listAssets         : () => api.get("/accounting/fixed-assets"),
  createAsset        : (data) => api.post("/accounting/fixed-assets", data),
  updateAsset        : (id, data) => api.put(`/accounting/fixed-assets/${id}`, data),
  removeAsset        : (id) => api.delete(`/accounting/fixed-assets/${id}`),
  listDepreciation   : (params) => api.get("/accounting/depreciation", { params }),
  createDepreciation : (data) => api.post("/accounting/depreciation", data),
  removeDepreciation : (id) => api.delete(`/accounting/depreciation/${id}`),
};
