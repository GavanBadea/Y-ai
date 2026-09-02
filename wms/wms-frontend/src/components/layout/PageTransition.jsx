// انتقالات مرنة على نمط iOS — تُطبَّق مركزياً عند تغيير الصفحة
import { useEffect } from "react";
import { useLocation } from "react-router-dom";

export default function PageTransition({ children }) {
  const { pathname } = useLocation();

  useEffect(() => {
    const main = document.querySelector("main");
    if (main) main.scrollTo({ top: 0, behavior: "smooth" });
  }, [pathname]);

  return (
    <div key={pathname} className="ios-page ios-page--enter">
      {children}
    </div>
  );
}
