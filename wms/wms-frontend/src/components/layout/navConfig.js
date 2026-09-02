// تعريف مسارات التنقل — مشترك بين الشريط الجانبي وتنقل الموبايل

export const GROUPS = [
  {
    labelKey: "nav.groups.main",
    items: [
      { to: "/dashboard", labelKey: "nav.dashboard", icon: "dashboard", permissions: null },
      { to: "/pos", labelKey: "nav.pos", icon: "pos", permissions: ["can_add_sales"] },
      { to: "/price-kiosk", labelKey: "nav.priceKiosk", icon: "stock", permissions: ["can_kiosk_scan"] },
    ],
  },
  {
    labelKey: "nav.groups.operations",
    items: [
      { to: "/invoices-in", labelKey: "nav.invoicesIn", icon: "invoicesIn", permissions: ["can_add_purchase"] },
      { to: "/invoices-out", labelKey: "nav.invoicesOut", icon: "invoicesOut", permissions: ["can_add_sales"] },
      { to: "/returns", labelKey: "nav.purchaseReturns", icon: "returns", permissions: ["can_add_purchase"] },
      { to: "/sales-returns", labelKey: "nav.salesReturns", icon: "returns", permissions: ["can_add_sales"] },
    ],
  },
  {
    labelKey: "nav.groups.inventory",
    items: [
      { to: "/materials", labelKey: "nav.materials", icon: "materials", permissions: ["can_view_materials", "can_add_materials", "can_edit_materials"] },
      { to: "/inventory", labelKey: "nav.inventory", icon: "stock", permissions: ["can_edit_stock"] },
      { to: "/stock-transfers", labelKey: "nav.stockTransfers", icon: "stock", permissions: ["can_edit_stock"] },
      { to: "/expired-stock", labelKey: "nav.expiredStock", icon: "expired", permissions: ["can_view_materials"] },
    ],
  },
  {
    labelKey: "nav.groups.parties",
    items: [
      { to: "/customers", labelKey: "nav.customers", icon: "customers", permissions: ["can_add_sales", "can_manage_finance", "can_add_purchase"] },
      { to: "/debts", labelKey: "nav.debts", icon: "debts", permissions: ["can_manage_finance"] },
    ],
  },
  {
    labelKey: "nav.groups.vouchers",
    items: [
      { to: "/documents", labelKey: "nav.documents", icon: "documents", permissions: ["can_manage_finance"] },
    ],
  },
  {
    labelKey: "nav.groups.lookup",
    items: [
      { to: "/lookup", labelKey: "nav.lookup", icon: "stock", permissions: ["can_view_materials", "can_add_purchase"] },
    ],
  },
  {
    labelKey: "nav.groups.statements",
    items: [
      { to: "/customer-statement", labelKey: "nav.customerStatement", icon: "customers", permissions: ["can_manage_finance"] },
      { to: "/supplier-statement", labelKey: "nav.supplierStatement", icon: "suppliers", permissions: ["can_manage_finance"] },
      { to: "/mandob-statement", labelKey: "nav.mandobStatement", icon: "customers", permissions: ["can_manage_finance"] },
    ],
  },
  {
    labelKey: "nav.groups.reports",
    items: [
      { to: "/reports", labelKey: "nav.reports", icon: "reports", permissions: ["can_view_reports"] },
      { to: "/advanced-reports", labelKey: "nav.advancedReports", icon: "reports", permissions: ["can_manage_finance"] },
    ],
  },
  {
    labelKey: "nav.groups.accounting",
    items: [
      { to: "/accounting", labelKey: "nav.accounting", icon: "accounting", permissions: ["can_manage_finance"] },
      { to: "/spending", labelKey: "nav.spending", icon: "spending", permissions: ["can_manage_finance"] },
      { to: "/tax-accountant-package", labelKey: "nav.taxAccountantPackage", icon: "documents", permissions: ["can_view_reports"] },
    ],
  },
];

export const ADMIN_ITEMS = [
  { to: "/fiscal-year", labelKey: "nav.fiscalYear", hintKey: "nav.fiscalYearHint", icon: "company" },
  { to: "/fiscal-year-switch", labelKey: "nav.fiscalYearSwitch", icon: "company" },
  { to: "/users-manager", labelKey: "nav.usersManager", icon: "users" },
  { to: "/company", labelKey: "nav.company", icon: "company" },
  { to: "/whatsapp", labelKey: "nav.whatsapp", icon: "pos" },
  { to: "/financial-settings", labelKey: "nav.financialSettings", icon: "spending" },
  { to: "/audit-log", labelKey: "nav.auditLog", icon: "documents" },
  { to: "/guides", labelKey: "nav.guides", icon: "documents" },
];

export const OWNER_ITEMS = [];

export function canSeeItem(item, { isAdmin, hasPermission }) {
  if (isAdmin) return true;
  if (!item.permissions) return true;
  return item.permissions.some((perm) => hasPermission(perm));
}
