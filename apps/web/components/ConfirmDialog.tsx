"use client";

import { useEffect, useRef } from "react";

/** Native modal dialog for explicit confirmations (approvals, payouts). Escape cancels. */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  confirmClass = "btn btn-primary",
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  confirmClass?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby="confirm-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
      onClick={(e) => {
        if (e.target === ref.current && !busy) onCancel();
      }}
    >
      <div className="dialog-body">
        <h2 id="confirm-title">{title}</h2>
        {children}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={confirmClass} onClick={onConfirm} disabled={busy} autoFocus>
            {busy && <span className="spinner" aria-hidden="true" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
