import type { ReactNode } from "react";

export type DebugTabId = "tuning" | "camera" | "network" | "diagnostics";

type DebugDrawerProps = {
  open: boolean;
  onToggle: () => void;
  activeTab: DebugTabId;
  onTabChange: (tab: DebugTabId) => void;
  tabs: { id: DebugTabId; label: string }[];
  children: ReactNode;
};

export function DebugDrawer({
  open,
  onToggle,
  activeTab,
  onTabChange,
  tabs,
  children,
}: DebugDrawerProps) {
  return (
    <div className="debugDrawer">
      <button
        type="button"
        className="debugDrawerToggle"
        onClick={onToggle}
        aria-label={open ? "Close Debug Drawer" : "Open Debug Drawer"}
      >
        {open ? "Close" : "Menu"}
      </button>

      {open ? (
        <div className="debugDrawerPanel" role="dialog" aria-label="Debug Drawer">
          <div className="debugDrawerHeader">
            <p>Debug Drawer</p>
            <button type="button" onClick={onToggle}>
              Close
            </button>
          </div>

          <div className="debugTabs" role="tablist" aria-label="Debug sections">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                className={activeTab === tab.id ? "active" : ""}
                onClick={() => onTabChange(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="debugContent">{children}</div>
        </div>
      ) : null}
    </div>
  );
}
