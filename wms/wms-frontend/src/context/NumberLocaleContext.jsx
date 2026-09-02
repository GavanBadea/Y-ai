// ============================================================
//  src/context/NumberLocaleContext.jsx
//  Context عالمي لتبديل الأرقام: عربي (١٢٣) ↔ إنجليزي (123)
// ============================================================
import { createContext, useContext, useState, useCallback, useEffect } from "react";
import {
  setNumLocale,
  setCurrencySymbol,
  getCurrencySymbol,
  getNumLocale,
} from "@/utils/numFormat";
import { useCompany } from "@/context/CompanyContext";

const KEY = "wms_num_locale";
const DEFAULT = "en-US";
const LANG_NUM = { ar: "ar-IQ", en: "en-US", tr: "tr-TR" };

const safeFmtC = (n = 0, locale = DEFAULT) =>
  `${(Math.round((+n || 0) * 100) / 100).toLocaleString(locale)} ${getCurrencySymbol()}`;

const safeCtx = {
  locale  : DEFAULT,
  isArabic: false,
  toggle  : () => {},
  fmtN    : (n=0) => (Math.round((+n||0)*100)/100).toLocaleString(DEFAULT),
  fmtC    : (n=0) => safeFmtC(n, DEFAULT),
  currencySymbol: getCurrencySymbol(),
};

export const NumberLocaleContext = createContext(safeCtx);

export function NumberLocaleProvider({ children }) {
  const [locale, setLocale] = useState(() => {
    try { return localStorage.getItem(KEY) || DEFAULT; } catch { return DEFAULT; }
  });

  useEffect(() => {
    setNumLocale(locale);
  }, [locale]);

  const toggle = useCallback(() => {
    setLocale(prev => {
      const next = prev === "ar-IQ" ? "en-US" : "ar-IQ";
      try { localStorage.setItem(KEY, next); } catch {}
      setNumLocale(next);
      return next;
    });
  }, []);

  useEffect(() => {
    const onLang = (e) => {
      const next = LANG_NUM[e.detail] || DEFAULT;
      setLocale(next);
      try { localStorage.setItem(KEY, next); } catch {}
      setNumLocale(next);
    };
    window.addEventListener("wms-lang-change", onLang);
    return () => window.removeEventListener("wms-lang-change", onLang);
  }, []);

  const { company } = useCompany();
  const [currency, setCurrency] = useState(() => getCurrencySymbol());

  useEffect(() => {
    const sym = company?.CurrencySymbol === "$" ? "$" : "د.ع";
    setCurrencySymbol(sym);
    setCurrency(sym);
  }, [company?.CurrencySymbol]);

  useEffect(() => {
    const onCur = (e) => setCurrency(e.detail || getCurrencySymbol());
    window.addEventListener("wms-currency-change", onCur);
    return () => window.removeEventListener("wms-currency-change", onCur);
  }, []);

  useEffect(() => {
    const onNumLocale = (e) => {
      const next = e.detail || getNumLocale();
      setLocale(next);
    };
    window.addEventListener("wms-num-locale-change", onNumLocale);
    return () => window.removeEventListener("wms-num-locale-change", onNumLocale);
  }, []);

  const fmtN = useCallback(
    (n = 0) => (Math.round((+n || 0) * 100) / 100).toLocaleString(locale),
    [locale]
  );
  const fmtC = useCallback(
    (n = 0) => `${fmtN(n)} ${currency}`,
    [fmtN, currency]
  );

  return (
    <NumberLocaleContext.Provider
      value={{ locale, toggle, isArabic: locale === "ar-IQ", fmtN, fmtC, currencySymbol: currency }}
    >
      {children}
    </NumberLocaleContext.Provider>
  );
}

export function useNumberLocale() {
  return useContext(NumberLocaleContext) || safeCtx;
}
