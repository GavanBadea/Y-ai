import ar from "./locales/ar";
import { translateText } from "./reverse";

export { translateText };

export const LANGUAGES = [];

const LOCALES = { ar };

/** @param {string} path @param {Record<string, string>} [params] */
export function translate(lang, path, params) {
  const dict = LOCALES.ar;
  const val = path.split(".").reduce((o, k) => (o && o[k] != null ? o[k] : null), dict);
  if (val == null) return path;
  if (!params) return String(val);
  return String(val).replace(/\{(\w+)\}/g, (_, k) => params[k] ?? "");
}

/** عناوين الصفحات العربية → مفتاح الترجمة */
export const PAGE_TITLE_MAP = {
  "لوحة القيادة": "pages.dashboard",
  "فواتير المبيعات": "pages.salesInvoices",
  "فاتورة مبيعات جديدة": "pages.salesInvoiceNew",
  "فواتير الشراء": "pages.purchaseInvoices",
  "فاتورة شراء جديدة": "pages.purchaseInvoiceNew",
  "مرتجعات المبيعات": "pages.salesReturns",
  "مرتجعات المشتريات": "pages.purchaseReturns",
  "مرتجعات مشتريات": "pages.purchaseReturns",
  "المواد": "pages.materials",
  "لوحة المخزون": "pages.inventory",
  "نقل مخزني": "pages.stockTransfers",
  "منتهية الصلاحية": "pages.expiredStock",
  "الأطراف التجارية": "pages.parties",
  "الديون السابقة": "pages.debts",
  "السندات المالية": "pages.documents",
  "المصاريف": "pages.spending",
  "المحاسبة": "pages.accounting",
  "حزمة المحاسب الضريبية": "pages.taxAccountantPackage",
  "التقارير": "pages.reports",
  "الجداول المرجعية": "pages.lookup",
  "التقارير التفصيلية": "pages.advancedReports",
  "كشف حساب الزبائن": "pages.customerStatement",
  "كشف حساب الموردين": "pages.supplierStatement",
  "إعدادات الشركة": "pages.company",
  "إدارة المستخدمين": "pages.users",
  "ربط واتساب": "pages.whatsapp",
  "الإعدادات المالية": "pages.financialSettings",
  "إدارة المستودعات": "pages.warehouses",
  "سجل العمليات": "pages.auditLog",
  "الشروحات": "pages.guides",
  "السنة المالية": "pages.fiscalYear",
  "المخزون": "pages.stock",
  "وصول مرفوض": "pages.forbidden",
  "نقطة البيع": "nav.pos",
};

export function resolvePageTitle(lang, title) {
  if (!title) return "";
  const key = PAGE_TITLE_MAP[String(title).trim()];
  return key ? translate("ar", key) : String(title);
}
