/** عنوان الباك أند — يتكيّف تلقائياً عند الفتح من الموبايل على نفس الواي فاي */
export function getApiBase() {
  const env = import.meta.env.VITE_API_URL?.trim();
  if (env) return env.replace(/\/$/, "");

  if (typeof window !== "undefined") {
    const { protocol, hostname, port } = window.location;
    // وضع التطوير: Vite على 5173 والـ API على 3000 لنفس الجهاز
    if (port === "5173") return `${protocol}//${hostname}:3000`;
    return window.location.origin;
  }

  return "http://localhost:3000";
}
