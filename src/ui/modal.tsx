import React, { useEffect } from "react";

export type ModalProps = {
  open: boolean;
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  onClose: () => void;
};

export function Modal({ open, title, children, actions, onClose }: ModalProps): React.ReactElement | null {
  useEffect(() => {
    if (!open) return;
    const on_keydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", on_keydown);
    return () => window.removeEventListener("keydown", on_keydown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="modal_backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal_panel">
        <div className="modal_header">
          <div className="modal_title">{title}</div>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="modal_body">{children}</div>
        {actions ? <div className="modal_footer">{actions}</div> : null}
      </div>
    </div>
  );
}
