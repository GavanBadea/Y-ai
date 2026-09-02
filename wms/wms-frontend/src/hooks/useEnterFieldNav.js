import { useEffect } from "react";

const FOCUSABLE =
  'input:not([disabled]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]),' +
  "select:not([disabled]),textarea:not([disabled])";

/** Enter ينتقل للحقل التالي حسب ترتيب الصفحة */
export function useEnterFieldNav(enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (e) => {
      if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.altKey) return;
      const el = e.target;
      if (!el || el.dataset?.enterNav === "false") return;
      if (el.tagName === "TEXTAREA") return;
      if (el.tagName === "BUTTON" || el.type === "submit") return;

      // آخر حقل في سطر الفاتورة → سطر جديد (فواتير المبيعات/المشتريات)
      if (el.dataset?.invoiceLineLast === "true") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("wms-invoice-add-line"));
        return;
      }

      const list = [...document.querySelectorAll(FOCUSABLE)].filter(
        (node) => node.offsetParent !== null && !node.closest("[aria-hidden='true']")
      );
      const idx = list.indexOf(el);
      if (idx < 0 || idx >= list.length - 1) return;

      e.preventDefault();
      const next = list[idx + 1];
      next.focus();
      if (typeof next.select === "function" && next.tagName !== "SELECT") {
        try {
          next.select();
        } catch {
          /* ignore */
        }
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [enabled]);
}
