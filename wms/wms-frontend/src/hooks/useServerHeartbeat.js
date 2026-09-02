// ============================================================
//  hooks/useServerHeartbeat.js
//  راقب اتصال الخادم وأظهر تحذيراً عند الانقطاع
// ============================================================
import { useState, useEffect, useRef } from "react";

const PING_INTERVAL = 30_000;   // 30 ثانية
const PING_TIMEOUT  =  5_000;   //  5 ثوانٍ

export function useServerHeartbeat() {
  const [isOnline, setIsOnline] = useState(true);
  const [lastCheck, setLastCheck] = useState(null);
  const timerRef = useRef(null);

  const ping = async () => {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), PING_TIMEOUT);
      const base = window.location.origin;
      await fetch(`${base}/api/health`, {
        signal: controller.signal,
        cache : "no-store",
      });
      clearTimeout(id);
      setIsOnline(true);
    } catch {
      setIsOnline(false);
    }
    setLastCheck(new Date());
  };

  useEffect(() => {
    ping(); // فحص فوري
    timerRef.current = setInterval(ping, PING_INTERVAL);
    return () => clearInterval(timerRef.current);
  }, []);

  return { isOnline, lastCheck, ping };
}
