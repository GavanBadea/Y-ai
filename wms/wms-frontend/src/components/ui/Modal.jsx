import { createPortal } from "react-dom";

/** نافذة منبثقة في وسط الشاشة — تُعرض عبر portal لتجاوز تأثيرات الحاويات الأب */
export default function Modal({ title, onClose, children, width, panelStyle }) {
  return createPortal(
    <div className="wms-modal-root" onClick={onClose}>
      <div
        className="wms-modal-panel"
        style={{ ...(width ? { width } : null), ...panelStyle }}
        onClick={(e) => e.stopPropagation()}
      >
        {title != null && (
          <div className="wms-modal-header">
            <h3 className="wms-modal-title">{title}</h3>
            <button type="button" className="wms-modal-close" onClick={onClose} aria-label="إغلاق">
              ✕
            </button>
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body
  );
}

/** خلفية مرنة لنوافذ مخصّصة الهيكل */
export function ModalOverlay({ onClose, children, zIndex = 1000, className = "" }) {
  return createPortal(
    <div
      className={`wms-modal-root ${className}`.trim()}
      style={{ zIndex }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      {children}
    </div>,
    document.body
  );
}
