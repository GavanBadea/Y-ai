// ============================================================
//  src/hooks/usePermissions.js
//  Hook مخصص — صلاحيات CRUD للاستخدام داخل أي صفحة/مكوّن
//
//  الاستخدام:
//    const { can } = usePermissions();
//    if (can.addSales)   → أظهر زر إضافة فاتورة
//    if (can.editStock)  → أظهر زر تعديل المخزون
//    ...إلخ
//
//  ملاحظة: المدير (id_Roles=1) تُعاد له true لكل شيء دائماً
// ============================================================
import { useAuth } from "@/context/AuthContext";

// ── الخريطة: اسم الصلاحية الإنجليزي → عمود قاعدة البيانات ─
const PERM_MAP = {
  // ── عرض ────────────────────────────────
  viewReports    : "can_view_reports",
  viewMaterials  : "can_view_materials",

  // ── مواد ────────────────────────────────
  addMaterials   : "can_add_materials",
  editMaterials  : "can_edit_materials",
  deleteMaterials: "can_delete_materials",

  // ── عمليات ──────────────────────────────
  addPurchase    : "can_add_purchase",
  addSales       : "can_add_sales",

  // ── مخزون ───────────────────────────────
  editStock      : "can_edit_stock",

  // ── مالية ───────────────────────────────
  manageFinance  : "can_manage_finance",
  kioskScan      : "can_kiosk_scan",

  // ── إعدادات ─────────────────────────────
  editSettings   : "can_edit_settings",
  manageUsers    : "can_manage_users",
};

/**
 * usePermissions()
 * ─────────────────
 * يُعيد كائنَين:
 *   • can   → { viewReports, addSales, ... }  (boolean لكل صلاحية)
 *   • check → دالة مرنة check("can_add_sales")
 */
export function usePermissions() {
  const { hasPermission, isAdmin } = useAuth();

  // ── بناء كائن can الجاهز ──────────────────────────────
  const can = {};
  Object.entries(PERM_MAP).forEach(([alias, dbKey]) => {
    can[alias] = isAdmin ? true : hasPermission(dbKey);
  });

  // ── دالة مرنة لفحص عمود DB مباشرة ───────────────────
  const check = (dbColumnName) => isAdmin ? true : hasPermission(dbColumnName);

  return { can, check, isAdmin };
}

export default usePermissions;
