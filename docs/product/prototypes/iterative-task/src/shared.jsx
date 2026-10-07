import { useEffect, useRef } from "react";
export { Button, Icon, useRovingTabs } from "../../../../../apps/web/src/ui/components.jsx";
import { Icon, Button } from "../../../../../apps/web/src/ui/components.jsx";

export const originalRequest = "When a request times out, show a clear error and let me retry manually. Do not retry automatically.";
export const manualOutcome = "Show a timeout error and a Retry button. Send another request only after the user chooses Retry.";
export const autoOutcome = "Retry once automatically after a timeout. If it fails again, show the error and a manual Retry button.";

export function seed(screen = "prepared") {
  const isReview = screen === "review";
  return {
    screen, adopted: isReview, revision: isReview ? 4 : 3,
    candidate: isReview ? manualOutcome : "Show timeout feedback and retry the request once automatically.",
    policy: "manual", selected: "manual", dirty: false, rejected: false,
    started: isReview, proof: "missing", condition: "normal", budget: 20,
    completed: false, tab: "overview", decisionAcknowledged: false,
  };
}

export function criteria(policy) {
  return [
    { id: "C01", title: "Make the timeout visible", expected: "Show a clear timeout error when the request fails.", observed: "The timeout message appears after the simulated failure.", source: "Original request", icon: "eye" },
    { id: "C02", title: "Let the user recover", expected: policy === "manual" ? "A Retry button sends one new request only when clicked." : "After the automatic attempt fails, a Retry button allows manual recovery.", observed: "One click on Retry sends one new request; the error then clears.", source: policy === "manual" ? "Original request" : "Decision DEC-07", icon: "refresh" },
    { id: "C03", title: policy === "manual" ? "No automatic retries" : "Stop after one automatic retry", expected: policy === "manual" ? "Zero additional requests before the user chooses Retry." : "Exactly one automatic retry; no further requests without a user action.", observed: policy === "manual" ? "Request count stayed at 1 for 30 seconds. Automatic retries: 0." : "Automatic retries: 1. Further requests over 30 seconds: 0.", source: policy === "manual" ? "Original request · negative requirement" : "Decision DEC-07 · changed requirement", icon: "shield" },
  ];
}

export function Badge({ tone = "neutral", icon, children }) {
  return <span className={`badge badge-${tone}`}>{icon && <Icon name={icon} />}{children}</span>;
}

export function SectionHeading({ eyebrow, title, action }) {
  return <div className="section-heading"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h2>{title}</h2></div>{action}</div>;
}

export function Callout({ tone = "warning", title, children, action }) {
  return <div className={`callout callout-${tone}`}><Icon name={tone === "success" ? "check" : tone === "info" ? "signal" : "alertCircle"} /><div><strong>{title}</strong>{children && <p>{children}</p>}{action}</div></div>;
}

export function Bounds({ state, onProject }) {
  return <section className="bounds">
    <SectionHeading eyebrow="Delegated authority" title="Work within these bounds" />
    <dl className="facts">
      <div><dt>Repository</dt><dd><button className="text-button" onClick={onProject}>Project Atlas <Icon name="external" /></button></dd></div>
      <div><dt>Scope</dt><dd><code>src/auth/</code><br /><code>tests/auth/</code></dd></div>
      <div><dt>Write mode</dt><dd>Isolated local workspace</dd></div>
      <div><dt>Execution cap</dt><dd>{state.budget} minutes · 2 attempts</dd></div>
      <div><dt>Runner</dt><dd>Fixture simulation</dd></div>
    </dl>
    <details className="command-details"><summary>Allowed commands</summary><code>pnpm test:auth</code><code>pnpm lint:auth</code><p>Scoped edits and these checks only.</p></details>
    <div className="permission-note"><Icon name="lock" /><span>Upstream writes, publishing, dependencies, and deployment require a separate decision.</span></div>
  </section>;
}

export function Dialog({ title, children, onClose, wide = false }) {
  const ref = useRef(null);
  const heading = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current.showModal();
    heading.current.focus();
    return () => {
      ref.current?.close();
      if (previous?.isConnected) previous.focus();
      else document.getElementById("task-title")?.focus();
    };
  }, []);
  return <dialog ref={ref} className={`dialog ${wide ? "dialog-wide" : ""}`} aria-labelledby="dialog-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="dialog-header"><h2 id="dialog-title" ref={heading} tabIndex={-1}>{title}</h2><Button size="compact" className="icon-button" aria-label="Close dialog" onClick={onClose}><Icon name="close" /></Button></div>
    {children}
  </dialog>;
}
