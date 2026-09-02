import { useEffect } from "react";
import { useWorkTabs } from "@/context/WorkTabsContext";

/** تسجيل تبويب عمل مفتوح — يُزال تلقائياً عند active=false */
export function useRegisterWorkTab({ id, title, path, state, active }) {
  const { upsertTab, removeTab } = useWorkTabs();

  useEffect(() => {
    if (active && id && path) {
      upsertTab({ id, title: title || path, path, state: state || null });
    } else if (id) {
      removeTab(id);
    }
  }, [active, id, title, path, upsertTab, removeTab]); // state يُقرأ عند التفعيل فقط
}
