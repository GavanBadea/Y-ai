import { useNavigate, useLocation } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useVisibleNavItems } from "@/hooks/useVisibleNavItems";

export default function MobileBottomNav({ onOpenMenu }) {
  const isMobile = useIsMobile();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const items = useVisibleNavItems();

  const isActive = (to) => pathname === to || pathname.startsWith(`${to}/`);

  if (!isMobile) return null;

  const quickItems = items.filter((item) => item.to !== "/dashboard").slice(0, 8);

  return (
    <nav className="mobile-bottom-nav" aria-label="تنقل سريع">
      <button type="button" className="mobile-bottom-nav__item" onClick={onOpenMenu}>
        <span className="mobile-bottom-nav__icon" aria-hidden>☰</span>
        <span className="mobile-bottom-nav__label">القائمة</span>
      </button>
      <button
        type="button"
        className={`mobile-bottom-nav__item${isActive("/dashboard") ? " mobile-bottom-nav__item--active" : ""}`}
        onClick={() => navigate("/dashboard")}
      >
        <span className="mobile-bottom-nav__icon" aria-hidden>🏠</span>
        <span className="mobile-bottom-nav__label">الرئيسية</span>
      </button>
      <div className="mobile-bottom-nav__scroll">
        {quickItems.map((item) => (
          <button
            key={item.to}
            type="button"
            className={`mobile-bottom-nav__chip${isActive(item.to) ? " mobile-bottom-nav__chip--active" : ""}`}
            onClick={() => navigate(item.to)}
          >
            {t(item.labelKey)}
          </button>
        ))}
      </div>
    </nav>
  );
}
