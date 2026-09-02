import { createContext, useContext, useEffect, useCallback, useMemo } from "react";
import { translate, resolvePageTitle } from "@/i18n";

const LanguageContext = createContext(null);

/** العربية فقط — بدون تبديل لغة */
export function LanguageProvider({ children }) {
  useEffect(() => {
    document.documentElement.lang = "ar";
    document.documentElement.dir = "rtl";
  }, []);

  const t = useCallback((key, params) => translate("ar", key, params), []);
  const tr = useCallback((text) => (text == null ? "" : String(text)), []);
  const translateTitle = useCallback((title) => resolvePageTitle("ar", title), []);

  const value = useMemo(
    () => ({
      lang: "ar",
      setLang: () => {},
      t,
      tr,
      translateTitle,
      isRtl: true,
      languages: [],
    }),
    [t, tr, translateTitle]
  );

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be inside <LanguageProvider>");
  return ctx;
}
