/** تخزين الجلسة — sessionStorage لطلب تسجيل الدخول عند كل فتح جديد للبرنامج */
export const TOKEN_KEY = "wms_token";
export const USER_KEY  = "wms_user";
export const SETUP_TOKEN_KEY = "wms_setup_token";

export function getAuthStorage() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function getToken() {
  return getAuthStorage()?.getItem(TOKEN_KEY) || null;
}

export function clearAuthSession() {
  const s = getAuthStorage();
  if (!s) return;
  s.removeItem(TOKEN_KEY);
  s.removeItem(USER_KEY);
  s.removeItem(SETUP_TOKEN_KEY);
}
