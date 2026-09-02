// إيقاف الخادم + حماية الإغلاق مع نافذة تسجيل الخروج
// السيرفر يُوقَف فقط عند تسجيل الخروج الصريح — لا عند التنقل داخل التطبيق
import { useEffect } from "react";
import { getApiBase } from "@/utils/apiBase";

const EXIT_ATTEMPT_KEY = "wms_exit_attempt";

export function isClientProductionApp() {
  const { port } = window.location;
  return !import.meta.env.DEV && port !== "5173";
}

export function requestServerShutdown() {
  if (!isClientProductionApp()) return;

  const url = `${getApiBase()}/api/system/shutdown`;
  try {
    const blob = new Blob(["{}"], { type: "application/json" });
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, blob);
    } else {
      fetch(url, {
        method  : "POST",
        keepalive: true,
        headers : { "Content-Type": "application/json" },
        body    : "{}",
      }).catch(() => {});
    }
  } catch { /* ignore */ }
}

export function useAppExit({ isLoggedIn, onExitAttempt }) {
  useEffect(() => {
    if (!isLoggedIn) return;

    const onBeforeUnload = (e) => {
      if (window.__WMS_EXIT_ALLOWED) return;
      try { sessionStorage.setItem(EXIT_ATTEMPT_KEY, "1"); } catch { /* ignore */ }
      onExitAttempt?.();
      e.preventDefault();
      e.returnValue = "يجب تسجيل الخروج بالفعل قبل إغلاق البرنامج";
      return e.returnValue;
    };

    const onFocus = () => {
      try {
        if (sessionStorage.getItem(EXIT_ATTEMPT_KEY) === "1") {
          sessionStorage.removeItem(EXIT_ATTEMPT_KEY);
          onExitAttempt?.();
        }
      } catch { /* ignore */ }
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("focus", onFocus);
    };
  }, [isLoggedIn, onExitAttempt]);
}

export function confirmLogoutAndShutdown(logout) {
  window.__WMS_EXIT_ALLOWED = true;
  try { sessionStorage.removeItem(EXIT_ATTEMPT_KEY); } catch { /* ignore */ }
  logout?.();
  requestServerShutdown();
}
