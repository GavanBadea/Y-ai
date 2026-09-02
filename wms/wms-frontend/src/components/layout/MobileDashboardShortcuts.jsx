import { NavLink } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import { useVisibleNavItems } from "@/hooks/useVisibleNavItems";

export default function MobileDashboardShortcuts({ onOpenMenu }) {
  const { t } = useLanguage();
  const items = useVisibleNavItems().filter((item) => item.to !== "/dashboard");

  return (
    <section className="mobile-dashboard-shortcuts" aria-label="الانتقال إلى الأقسام">
      <div className="mobile-dashboard-shortcuts__head">
        <h2 className="mobile-dashboard-shortcuts__title">الأقسام</h2>
        <button type="button" className="mobile-dashboard-shortcuts__menu" onClick={onOpenMenu}>
          كل القائمة ☰
        </button>
      </div>
      <div className="mobile-dashboard-shortcuts__grid">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `mobile-dashboard-shortcuts__card${isActive ? " mobile-dashboard-shortcuts__card--active" : ""}`
            }
          >
            {t(item.labelKey)}
          </NavLink>
        ))}
      </div>
    </section>
  );
}
