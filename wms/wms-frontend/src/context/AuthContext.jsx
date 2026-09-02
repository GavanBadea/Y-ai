// ============================================================
//  src/context/AuthContext.jsx
//  إدارة حالة المصادقة والصلاحيات عبر كامل التطبيق
// ============================================================
import { createContext, useContext, useReducer, useEffect, useCallback } from "react";
import { authService } from "@/services/api";
import { TOKEN_KEY, USER_KEY, SETUP_TOKEN_KEY, getAuthStorage, clearAuthSession } from "@/utils/authStorage";

// ── قائمة أعمدة الصلاحيات الفعلية ───────────────────────
const ALL_PERMISSION_KEYS = [
  "can_view_reports",
  "can_manage_users",
  "can_edit_stock",
  "can_view_materials",
  "can_add_materials",
  "can_edit_materials",
  "can_delete_materials",
  "can_add_purchase",
  "can_add_sales",
  "can_edit_settings",
  "can_manage_finance",
  "can_kiosk_scan",
];

function extractPermissions(user) {
  if (!user) return {};
  const isAdmin = Number(user.id_Roles) === 1;
  const perms = {};
  ALL_PERMISSION_KEYS.forEach((key) => {
    perms[key] = isAdmin ? true : !!user[key];
  });
  return perms;
}

const initialState = {
  user        : null,
  token       : null,
  setupToken  : null,
  isFirstRun  : false,
  isLoading   : true,
  error       : null,
  permissions : {},
};

function authReducer(state, action) {
  switch (action.type) {
    case "INIT_DONE":
      return {
        ...state,
        isLoading  : false,
        ...action.payload,
        permissions: extractPermissions(action.payload.user),
      };

    case "FIRST_RUN_DETECTED":
      return {
        ...state,
        isFirstRun : true,
        setupToken : action.payload.setupToken,
        isLoading  : false,
        error      : null,
      };

    case "FIRST_RUN_CLEARED":
      return {
        ...state,
        isFirstRun : false,
        setupToken : null,
        error      : null,
      };

    case "LOGIN_SUCCESS":
      return {
        ...state,
        user       : action.payload.user,
        token      : action.payload.token,
        isFirstRun : false,
        setupToken : null,
        isLoading  : false,
        error      : null,
        permissions: extractPermissions(action.payload.user),
      };

    case "ADMIN_CREATED":
      return {
        ...state,
        isFirstRun : false,
        setupToken : null,
        user       : null,
        token      : null,
        error      : null,
        permissions: {},
      };

    case "LOGOUT":
      return { ...initialState, isLoading: false, permissions: {} };

    case "SET_ERROR":
      return { ...state, error: action.payload, isLoading: false };

    case "CLEAR_ERROR":
      return { ...state, error: null };

    default:
      return state;
  }
}

const AuthContext = createContext(null);

// ══════════════════════════════════════════════════════════
//  AuthProvider
// ══════════════════════════════════════════════════════════
export function AuthProvider({ children }) {
  const [state, dispatch] = useReducer(authReducer, initialState);

  // ── تحقق من التوكن المحفوظ عند بدء التطبيق ────────────
  useEffect(() => {
    const storage = getAuthStorage();
    const token = storage?.getItem(TOKEN_KEY);
    const user  = (() => {
      try { return JSON.parse(storage?.getItem(USER_KEY)); }
      catch { return null; }
    })();

    if (token && user) {
      dispatch({
        type   : "INIT_DONE",
        payload: { token, user, isFirstRun: false },
      });
    } else {
      dispatch({ type: "INIT_DONE", payload: {} });
    }
  }, []);

  // ── checkFirstRun — كشف أول تشغيل بعد تحميل الواجهة ──
  const checkFirstRun = useCallback(async () => {
    try {
      const res = await authService.checkFirstRun();
      if (res.isFirstRun) {
        getAuthStorage()?.setItem(SETUP_TOKEN_KEY, res.setupToken);
        dispatch({
          type   : "FIRST_RUN_DETECTED",
          payload: { setupToken: res.setupToken },
        });
        return true;
      }
      getAuthStorage()?.removeItem(SETUP_TOKEN_KEY);
      dispatch({ type: "FIRST_RUN_CLEARED" });
      return false;
    } catch (err) {
      dispatch({ type: "FIRST_RUN_CLEARED" });
      const msg = err?.message || "تعذر التحقق من حالة النظام";
      dispatch({ type: "SET_ERROR", payload: msg });
      throw err;
    }
  }, []);

  // ── login ───────────────────────────────────────────────
  const login = useCallback(async (UserName, Password) => {
    dispatch({ type: "CLEAR_ERROR" });
    try {
      const res = await authService.login({ UserName, Password });

      getAuthStorage()?.setItem(TOKEN_KEY, res.token);
      getAuthStorage()?.setItem(USER_KEY, JSON.stringify(res.user));
      dispatch({
        type   : "LOGIN_SUCCESS",
        payload: { user: res.user, token: res.token },
      });
      return { isFirstRun: false, user: res.user };
    } catch (err) {
      const msg = err.message || "فشل تسجيل الدخول";
      dispatch({ type: "SET_ERROR", payload: msg });
      throw new Error(msg);
    }
  }, []);

  // ── setupAdmin ──────────────────────────────────────────
  const setupAdmin = useCallback(async (AdminUserName, AdminPassword) => {
    dispatch({ type: "CLEAR_ERROR" });
    try {
      const setupToken = state.setupToken || getAuthStorage()?.getItem(SETUP_TOKEN_KEY);
      const res = await authService.setupAdmin({ AdminUserName, AdminPassword }, {
        headers: { Authorization: `Bearer ${setupToken}` },
      });
      clearAuthSession();
      dispatch({ type: "ADMIN_CREATED" });
      return res;
    } catch (err) {
      const msg = err.message || "فشل إنشاء حساب المدير";
      dispatch({ type: "SET_ERROR", payload: msg });
      throw new Error(msg);
    }
  }, [state.setupToken]);

  // ── logout ──────────────────────────────────────────────
  const logout = useCallback(() => {
    clearAuthSession();
    dispatch({ type: "LOGOUT" });
  }, []);

  const clearError = useCallback(() => {
    dispatch({ type: "CLEAR_ERROR" });
  }, []);

  const hasPermission = useCallback((permKey) => {
    if (!state.user) return false;
    if (Number(state.user.id_Roles) === 1) return true;
    return !!state.permissions[permKey];
  }, [state.user, state.permissions]);

  const value = {
    user        : state.user,
    token       : state.token,
    setupToken  : state.setupToken,
    isFirstRun  : state.isFirstRun,
    isLoading   : state.isLoading,
    error       : state.error,
    permissions : state.permissions,
    hasPermission,
    isAdmin    : Number(state.user?.id_Roles) === 1,
    isOwner    : false,   // لم يعد هناك صاحب برنامج مدمج
    isLoggedIn : !!state.token && !state.isFirstRun,
    login,
    setupAdmin,
    logout,
    clearError,
    checkFirstRun,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth يجب أن يُستخدم داخل <AuthProvider>");
  return ctx;
}

export default AuthContext;
