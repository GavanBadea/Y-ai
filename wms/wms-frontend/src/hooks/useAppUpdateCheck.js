import { useCallback, useEffect, useState } from "react";
import { systemService } from "@/services/api";

const CACHE_MS = 5 * 60 * 1000;

let cachedAt = 0;
let cachedResult = null;
let inFlight = null;

function normalizeVersion(v) {
  return String(v || "")
    .trim()
    .replace(/^v/i, "");
}

function compareVersions(a, b) {
  const pa = normalizeVersion(a).split(".").map((x) => Number.parseInt(x, 10) || 0);
  const pb = normalizeVersion(b).split(".").map((x) => Number.parseInt(x, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

function normalizeManifest(raw) {
  return {
    version: normalizeVersion(raw?.version),
    releaseDate: String(raw?.releaseDate || ""),
    notes: Array.isArray(raw?.notes) ? raw.notes.map((n) => String(n)) : [],
    installerUrl: String(raw?.installerUrl || ""),
    mandatory: !!raw?.mandatory,
  };
}

async function loadUpdateState(force = false) {
  if (!force && cachedResult && Date.now() - cachedAt < CACHE_MS) return cachedResult;
  if (!force && inFlight) return inFlight;

  inFlight = (async () => {
    const meta = await systemService.getUpdateMeta();
    const current = normalizeManifest(meta?.data?.current || {});
    const manifestUrl = String(meta?.data?.manifestUrl || "").trim();

    if (!manifestUrl) {
      cachedResult = {
        enabled: false,
        checking: false,
        available: false,
        current,
        latest: null,
        error: "",
      };
      cachedAt = Date.now();
      return cachedResult;
    }

    const res = await fetch(manifestUrl, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`تعذّر قراءة ملف التحديث (${res.status})`);
    }
    const raw = await res.json();
    const latest = normalizeManifest(raw);
    if (!latest.version) {
      throw new Error("ملف version.json على GitHub فارغ أو غير صالح — راجع docs/دليل-التحديثات.md");
    }
    const available = compareVersions(latest.version, current.version) > 0;

    cachedResult = {
      enabled: true,
      checking: false,
      available,
      current,
      latest,
      error: "",
    };
    cachedAt = Date.now();
    return cachedResult;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

export function useAppUpdateCheck() {
  const [state, setState] = useState(() => cachedResult || {
    enabled: true,
    checking: true,
    available: false,
    current: null,
    latest: null,
    error: "",
  });

  const refresh = useCallback(async (force = false) => {
    setState((prev) => ({ ...prev, checking: true, error: "" }));
    try {
      const next = await loadUpdateState(force);
      setState(next);
      return next;
    } catch (e) {
      const failed = {
        ...(cachedResult || {}),
        enabled: true,
        checking: false,
        available: false,
        current: cachedResult?.current || null,
        latest: cachedResult?.latest || null,
        error: e?.message || "تعذّر فحص التحديثات",
      };
      setState(failed);
      return failed;
    }
  }, []);

  useEffect(() => {
    refresh(false);
  }, [refresh]);

  return { ...state, refresh };
}
