import { useRef } from "react";
export { Icon } from "./icon.jsx";

export function Button({ variant = "secondary", size = "default", busy = false, className = "", children, ...props }) { return <button {...props} className={`aor-button ${className}`.trim()} data-variant={variant} data-size={size} aria-busy={busy ? "true" : undefined} disabled={props.disabled || busy}>{children}</button>; }
export function EmptyState({ title, children }) { return <div className="aor-empty">{title ? <h3>{title}</h3> : null}<p>{children}</p></div>; }
export function useRovingTabs({ tabs, selected, onSelect }) {
  const tabRefs = useRef([]);
  const enabledIndexes = tabs.map((tab, index) => (!tab.disabled ? index : -1)).filter((index) => index >= 0);
  const selectedIndex = enabledIndexes.find((index) => tabs[index].id === selected) ?? enabledIndexes[0] ?? -1;
  const getTabProps = (_tab, index) => ({
    ref: (element) => { tabRefs.current[index] = element; },
    tabIndex: index === selectedIndex ? 0 : -1,
    onKeyDown: (event) => {
      if (enabledIndexes.length === 0) return;
      const currentPosition = enabledIndexes.indexOf(index);
      let nextPosition = null;
      if (event.key === "ArrowRight") nextPosition = (currentPosition + 1) % enabledIndexes.length;
      if (event.key === "ArrowLeft") nextPosition = (currentPosition - 1 + enabledIndexes.length) % enabledIndexes.length;
      if (event.key === "Home") nextPosition = 0;
      if (event.key === "End") nextPosition = enabledIndexes.length - 1;
      if (nextPosition === null) return;
      event.preventDefault();
      const nextIndex = enabledIndexes[nextPosition];
      onSelect(tabs[nextIndex].id);
      tabRefs.current[nextIndex]?.focus();
    },
  });
  return { getTabProps };
}
