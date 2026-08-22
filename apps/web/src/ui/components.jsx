import React, { useId, useRef } from "react";
import { Dialog } from "../dialog.jsx";
import { requireSemanticTone } from "./semantics.js";
export { Icon } from "./icon.jsx";

export function Button({ variant = "secondary", size = "default", busy = false, className = "", children, ...props }) { return <button {...props} className={`aor-button ${className}`.trim()} data-variant={variant} data-size={size} aria-busy={busy ? "true" : undefined} disabled={props.disabled || busy}>{children}</button>; }
export function IconButton({ label, children, ...props }) { return <Button {...props} className={`aor-icon-button ${props.className ?? ""}`.trim()} aria-label={label}>{children}</Button>; }
export function Field({ label, helper, error, children }) { const id = useId(); const describedBy = [helper ? `${id}-helper` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined; return <label className="aor-field"><span className="aor-field__label">{label}</span>{React.cloneElement(children, { className: `aor-field__control ${children.props.className ?? ""}`.trim(), "aria-invalid": error ? "true" : undefined, "aria-describedby": describedBy })}{helper ? <span id={`${id}-helper`} className="aor-field__helper">{helper}</span> : null}{error ? <span id={`${id}-error`} className="aor-field__error">{error}</span> : null}</label>; }
export function Drawer(props) { return <Dialog {...props} />; }
export function StatusBadge({ tone = "neutral", children }) { return <span className="aor-status" data-tone={requireSemanticTone(tone)}>{children}</span>; }
export function CountBadge({ children, label }) { return <span className="aor-count" aria-label={label}>{children}</span>; }
export function Alert({ tone = "information", className = "", children }) { return <div className={`aor-alert ${className}`.trim()} data-tone={requireSemanticTone(tone, "information")} role={tone === "danger" ? "alert" : "status"}>{children}</div>; }
export function Card({ children, className = "" }) { return <div className={`aor-card ${className}`.trim()}>{children}</div>; }
export function Section({ title, children }) { return <section className="aor-section"><h2 className="aor-section__heading">{title}</h2>{children}</section>; }
export function EmptyState({ title, children }) { return <div className="aor-empty">{title ? <h3>{title}</h3> : null}<p>{children}</p></div>; }
export function Disclosure({ label, children, open = false }) { return <details className="aor-disclosure" open={open}><summary>{label}</summary>{children}</details>; }
export function useRovingTabs({ tabs, selected, onSelect }) {
  const tabRefs = useRef([]);
  const enabledIndexes = tabs.map((tab, index) => (!tab.disabled ? index : -1)).filter((index) => index >= 0);
  const selectedIndex = enabledIndexes.find((index) => tabs[index].id === selected) ?? enabledIndexes[0] ?? -1;
  const getTabProps = (tab, index) => ({
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
export function Tabs({ label, tabs, selected, onSelect }) { const { getTabProps } = useRovingTabs({ tabs, selected, onSelect }); return <div className="aor-tabs" role="tablist" aria-label={label}>{tabs.map((tab, index) => <button {...getTabProps(tab, index)} key={tab.id} type="button" className="aor-tab" role="tab" aria-selected={selected === tab.id} disabled={tab.disabled} onClick={() => onSelect(tab.id)}>{tab.label}</button>)}</div>; }
export function ProgressPath({ stages, current }) { return <ol className="aor-progress-path" aria-label="Lifecycle progress">{stages.map((stage) => <li key={stage.id} data-state={stage.state} aria-current={current === stage.id ? "step" : undefined}><span aria-hidden="true">{stage.state === "complete" ? "✓" : "•"}</span>{stage.label}</li>)}</ol>; }
export function ResponsiveActions({ children }) { return <div className="aor-responsive-actions">{children}</div>; }
