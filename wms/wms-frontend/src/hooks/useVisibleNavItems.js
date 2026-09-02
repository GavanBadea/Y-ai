import { useMemo } from "react";
import { useAuth } from "@/context/AuthContext";
import { GROUPS, ADMIN_ITEMS, OWNER_ITEMS, canSeeItem } from "@/components/layout/navConfig";

export function useVisibleNavItems() {
  const { isAdmin, isOwner, hasPermission } = useAuth();
  const authContext = { isAdmin, hasPermission };

  return useMemo(() => {
    const items = [];
    GROUPS.forEach((group) => {
      group.items
        .filter((item) => canSeeItem(item, authContext))
        .forEach((item) => items.push({ ...item, groupKey: group.labelKey }));
    });
    if (isAdmin) {
      ADMIN_ITEMS.forEach((item) => items.push({ ...item, groupKey: "__admin__" }));
    }
    if (isOwner) {
      OWNER_ITEMS.forEach((item) => items.push({ ...item, groupKey: "__owner__" }));
    }
    return items;
  }, [isAdmin, isOwner, hasPermission]);
}
