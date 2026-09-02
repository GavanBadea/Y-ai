import { useWorkTabs } from "@/context/WorkTabsContext";

export default function WorkTabsBar() {
  const { tabs, activateTab, closeTab, currentPath } = useWorkTabs();

  if (!tabs.length) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "stretch",
        gap: 4,
        padding: "6px 12px 0",
        overflowX: "auto",
        borderBottom: "1px solid var(--border-subtle)",
        background: "var(--bg-surface)",
        flexShrink: 0,
      }}
    >
      {tabs.map((tab) => {
        const isActive = currentPath === tab.path;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => activateTab(tab)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 10px 8px",
              border: "1px solid",
              borderColor: isActive ? "var(--accent)" : "var(--border)",
              borderBottom: isActive ? "2px solid var(--accent)" : "1px solid var(--border)",
              borderRadius: "var(--radius-sm) var(--radius-sm) 0 0",
              background: isActive ? "var(--accent-glow)" : "var(--bg-card)",
              color: isActive ? "var(--accent)" : "var(--text-secondary)",
              fontSize: ".78rem",
              fontWeight: isActive ? 700 : 500,
              cursor: "pointer",
              fontFamily: "var(--font-main)",
              whiteSpace: "nowrap",
              maxWidth: 200,
            }}
            title={tab.title}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{tab.title}</span>
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => closeTab(tab.id, e)}
              onKeyDown={(e) => e.key === "Enter" && closeTab(tab.id, e)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 16,
                height: 16,
                borderRadius: 4,
                fontSize: ".7rem",
                lineHeight: 1,
                opacity: 0.7,
              }}
              title="إغلاق التبويب"
            >
              ✕
            </span>
          </button>
        );
      })}
    </div>
  );
}
