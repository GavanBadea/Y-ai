// مسودات فواتير — تبقى عند الانتقال لقسم آخر حتى الحفظ أو الإغلاق الصريح

export const SALES_DRAFT_KEY    = "wms_draft_sales_invoice";
export const PURCHASE_DRAFT_KEY = "wms_draft_purchase_invoice";

export function loadInvoiceDraft(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveInvoiceDraft(key, data) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ ...data, savedAt: Date.now() }));
  } catch { /* quota */ }
}

export function clearInvoiceDraft(key) {
  sessionStorage.removeItem(key);
}

export function hasInvoiceDraft(key) {
  return !!sessionStorage.getItem(key);
}
