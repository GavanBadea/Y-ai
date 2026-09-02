// src/context/CompanyContext.jsx
import { createContext, useContext, useState, useEffect, useCallback } from "react";
import api from "@/services/api";
import { getApiBase } from "@/utils/apiBase";
import { getToken } from "@/utils/authStorage";
import { useAuth } from "@/context/AuthContext";

const CompanyContext = createContext({ company: {}, refresh: () => {} });

const CACHE_KEY = "wms_company_info";

function readCompanyCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeCompanyCache(data) {
  try {
    if (!data || typeof data !== "object") return;
    if (!data.CompanyInformation_Name && !data.CompanyInformation_Logo && !data.id_CompanyInformation) return;
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch { /* ignore */ }
}

function clearCompanyCache() {
  try { localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
}

function hasCompanyData(data) {
  return !!(data && (
    data.CompanyInformation_Name ||
    data.CompanyInformation_Logo ||
    data.CompanyInformation_Mobile ||
    data.CompanyInformation_Adress ||
    data.id_CompanyInformation
  ));
}

export function CompanyProvider({ children }) {
  const { isLoggedIn, isLoading } = useAuth();
  const [company, setCompany] = useState(() => readCompanyCache() || {});

  const refresh = useCallback(async () => {
    if (!getToken()) return;
    try {
      const res = await api.get("/company");
      const data = res?.data;
      if (data && typeof data === "object") {
        setCompany(data);
        if (hasCompanyData(data)) writeCompanyCache(data);
        return;
      }
    } catch { /* ignore */ }

    const cached = readCompanyCache();
    if (cached) setCompany(cached);
  }, []);

  useEffect(() => {
    if (isLoading) return;
    if (isLoggedIn) {
      refresh();
      return;
    }
    setCompany({});
    clearCompanyCache();
  }, [isLoggedIn, isLoading, refresh]);

  useEffect(() => {
    if (!isLoggedIn || isLoading) return;
    const retry = () => { refresh(); };
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [isLoggedIn, isLoading, refresh]);

  return (
    <CompanyContext.Provider value={{ company, refresh }}>
      {children}
    </CompanyContext.Provider>
  );
}

export function useCompany() {
  return useContext(CompanyContext);
}

export function companyLogoUrl(logoPath) {
  if (!logoPath) return null;
  if (logoPath.startsWith("http")) return logoPath;
  const base = getApiBase();
  return `${base}${logoPath}`;
}
