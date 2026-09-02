import { useEffect, useState } from "react";

/** كمية افتراضية 1 — عند التركيز والحذف يُفرَّغ الحقل فوراً */
export default function FlexibleQtyInput({ value = 1, onChange, style = {}, width = 56 }) {
  const [str, setStr] = useState(String(value ?? 1));

  useEffect(() => {
    setStr(String(value ?? 1));
  }, [value]);

  return (
    <input
      type="text"
      inputMode="decimal"
      value={str}
      onFocus={() => setStr(String(value ?? 1))}
      onKeyDown={(e) => {
        if ((e.key === "Backspace" || e.key === "Delete") && str.length <= 1) {
          setStr("");
          e.preventDefault();
        }
      }}
      onChange={(e) => {
        const v = e.target.value.replace(/[^\d.]/g, "");
        setStr(v);
        if (v === "" || v === ".") return;
        const n = Math.max(0.001, parseFloat(v) || 0);
        onChange(n);
      }}
      onBlur={() => {
        const n = Math.max(0.001, parseFloat(str) || 1);
        setStr(String(n));
        onChange(n);
      }}
      style={{ textAlign: "center", fontWeight: 800, width, ...style }}
    />
  );
}
