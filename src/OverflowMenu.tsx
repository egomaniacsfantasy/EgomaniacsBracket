import type { ReactNode } from "react";

export type OverflowMenuItem = {
  id: string;
  label: string;
  onSelect: () => void;
  tone?: "default" | "accent";
};

type OverflowMenuProps = {
  primaryItems: OverflowMenuItem[];
  secondaryItems?: OverflowMenuItem[];
  chaosNode?: ReactNode;
};

export function OverflowMenu({
  primaryItems,
  secondaryItems = [],
  chaosNode,
}: OverflowMenuProps) {
  return (
    <div className="toolbar-dropdown toolbar-dropdown--overflow" role="menu" aria-label="More bracket actions">
      {chaosNode ? (
        <>
          <div className="toolbar-overflow-chaos">{chaosNode}</div>
          {primaryItems.length || secondaryItems.length ? <div className="toolbar-dropdown-divider" /> : null}
        </>
      ) : null}

      {primaryItems.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`toolbar-dropdown-item ${item.tone === "accent" ? "toolbar-dropdown-item--accent" : ""}`}
          onClick={item.onSelect}
        >
          {item.label}
        </button>
      ))}

      {primaryItems.length > 0 && secondaryItems.length > 0 ? <div className="toolbar-dropdown-divider" /> : null}

      {secondaryItems.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`toolbar-dropdown-item ${item.tone === "accent" ? "toolbar-dropdown-item--accent" : ""}`}
          onClick={item.onSelect}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
