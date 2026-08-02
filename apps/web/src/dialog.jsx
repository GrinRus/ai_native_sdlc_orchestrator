import React, { useEffect, useRef } from "react";

const FOCUSABLE = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function Dialog({ open, onClose, labelledBy, className = "", backdropClassName = "", children }) {
  const dialogRef = useRef(null);
  const openerRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open || typeof document === "undefined") return undefined;
    openerRef.current = document.activeElement;
    const dialog = dialogRef.current;
    const backdrop = dialog?.parentElement;
    const siblings = backdrop?.parentElement
      ? Array.from(backdrop.parentElement.children).filter((element) => element !== backdrop)
      : [];
    siblings.forEach((element) => {
      element.inert = true;
      element.setAttribute("aria-hidden", "true");
    });
    const focusable = () => Array.from(dialog?.querySelectorAll(FOCUSABLE) ?? []);
    (focusable()[0] ?? dialog)?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        dialog?.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog?.addEventListener("keydown", onKeyDown);
    return () => {
      dialog?.removeEventListener("keydown", onKeyDown);
      siblings.forEach((element) => {
        element.inert = false;
        element.removeAttribute("aria-hidden");
      });
      const opener = openerRef.current;
      if (opener?.isConnected && typeof opener.focus === "function") opener.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className={`drawer-backdrop ${backdropClassName}`.trim()} role="presentation">
      <aside
        ref={dialogRef}
        className={className}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex="-1"
      >
        {children}
      </aside>
    </div>
  );
}
