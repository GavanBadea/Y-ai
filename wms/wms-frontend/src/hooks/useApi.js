// ============================================================
//  src/hooks/useApi.js
//  Hook عام لجلب البيانات من الـ API
//
//  الاستخدام:
//    const { data, loading, error, refetch } = useApi(
//      () => materialsService.getAll({ search }),
//      [search]    ← dependencies تُعيد الجلب عند تغيّرها
//    );
// ============================================================
import { useState, useEffect, useCallback, useRef } from "react";

export function useApi(fetcher, deps = []) {
  const [data,    setData   ] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError  ] = useState(null);
  const abortRef = useRef(null);

  const fetch = useCallback(async () => {
    // إلغاء الطلب السابق إذا لم ينتهِ
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    setLoading(true);
    setError(null);
    try {
      const result = await fetcher();
      setData(result);
    } catch (err) {
      if (err.name !== "AbortError") {
        setError(err.message || "حدث خطأ");
      }
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => { fetch(); }, [fetch]);

  return { data, loading, error, refetch: fetch };
}

// ── Hook مخصص للعمليات (POST / PUT / DELETE) ────────────────
export function useAction() {
  const [loading, setLoading] = useState(false);
  const [error,   setError  ] = useState(null);

  const execute = useCallback(async (actionFn, { onSuccess, onError } = {}) => {
    setLoading(true);
    setError(null);
    try {
      const result = await actionFn();
      onSuccess?.(result);
      return result;
    } catch (err) {
      const msg = err.message || "حدث خطأ";
      setError(msg);
      onError?.(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { loading, error, execute, clearError: () => setError(null) };
}
