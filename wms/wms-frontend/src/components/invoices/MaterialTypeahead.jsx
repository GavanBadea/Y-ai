import { useState, useMemo, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";

const norm = (s) => String(s || "").trim().toLowerCase();
const contains = (text, q) => norm(text).includes(q);

const DROPDOWN_Z = 10000;

export default function MaterialTypeahead({
  materials = [],
  loading = false,
  onPick,
  placeholder = "اكتب اسم المادة...",
  style = {},
  inputRef: externalRef,
}) {
  const [query, setQuery]     = useState("");
  const [open, setOpen]       = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [menuPos, setMenuPos] = useState(null);
  const wrapRef = useRef(null);
  const innerRef = useRef(null);
  const ref = externalRef || innerRef;

  const q = norm(query);
  const filtered = useMemo(() => {
    if (!q) return materials.slice(0, 60);
    return materials
      .filter((m) =>
        contains(m.MaterialName, q) ||
        contains(m.Barcode, q) ||
        contains(String(m.id_Material_NoM), q)
      )
      .slice(0, 40);
  }, [materials, q]);

  const updateMenuPos = () => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setMenuPos({
      top: rect.bottom + 2,
      left: rect.left,
      width: rect.width,
      maxHeight: Math.min(280, window.innerHeight - rect.bottom - 12),
    });
  };

  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    updateMenuPos();
    const onScrollOrResize = () => updateMenuPos();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, filtered.length, query]);

  useEffect(() => {
    const close = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        const portal = document.getElementById("material-typeahead-portal");
        if (portal?.contains(e.target)) return;
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const select = (mat) => {
    setQuery("");
    setOpen(false);
    onPick?.(mat);
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, Math.max(0, filtered.length - 1)));
      setOpen(true);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter" && open && filtered[highlight]) {
      e.preventDefault();
      e.stopPropagation();
      select(filtered[highlight]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const lineInputStyle = {
    width: "100%",
    padding: "7px 9px",
    boxSizing: "border-box",
    background: "var(--bg-input)",
    border: "1px solid var(--accent)",
    borderRadius: "var(--radius-sm)",
    color: "var(--text-primary)",
    fontFamily: "var(--font-main)",
    fontSize: ".84rem",
    outline: "none",
    ...style,
  };

  const menuBaseStyle = {
    position: "fixed",
    zIndex: DROPDOWN_Z,
    overflowY: "auto",
    background: "var(--bg-card)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    boxShadow: "var(--shadow-md)",
  };

  const dropdownPortal = open && menuPos && (
    <div id="material-typeahead-portal">
      {filtered.length > 0 ? (
        <div
          style={{
            ...menuBaseStyle,
            top: menuPos.top,
            left: menuPos.left,
            width: menuPos.width,
            maxHeight: menuPos.maxHeight,
          }}
        >
          {filtered.map((mat, i) => (
            <button
              key={mat.id_Material_NoM}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); select(mat); }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "right",
                padding: "8px 10px",
                border: "none",
                cursor: "pointer",
                background: i === highlight ? "var(--accent-glow)" : "transparent",
                color: "var(--text-primary)",
                fontSize: ".82rem",
                borderBottom: "1px solid var(--border-subtle)",
              }}
            >
              <div style={{ fontWeight: 700 }}>{mat.MaterialName}</div>
              {mat.Barcode && (
                <div style={{ fontSize: ".7rem", color: "var(--text-muted)" }}>{mat.Barcode}</div>
              )}
            </button>
          ))}
        </div>
      ) : q ? (
        <div
          style={{
            ...menuBaseStyle,
            top: menuPos.top,
            left: menuPos.left,
            width: menuPos.width,
            padding: 10,
            fontSize: ".8rem",
            color: "var(--text-muted)",
          }}
        >
          لا توجد مواد تحتوي على «{query}»
        </div>
      ) : null}
    </div>
  );

  return (
    <div ref={wrapRef} style={{ position: "relative", minWidth: 0 }}>
      <input
        ref={ref}
        type="text"
        data-line-material-input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setHighlight(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={loading ? "جاري تحميل المواد..." : placeholder}
        disabled={loading}
        autoComplete="off"
        style={lineInputStyle}
      />
      {typeof document !== "undefined" && dropdownPortal
        ? createPortal(dropdownPortal, document.body)
        : null}
    </div>
  );
}
