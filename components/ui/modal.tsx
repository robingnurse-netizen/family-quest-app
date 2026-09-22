"use client";

import { useEffect, useRef } from "react";
import { XIcon } from "./icons";

/**
 * Native <dialog> modal: Esc, focus trapping and backdrop come for free.
 * Children only render while open, so forms reset between openings.
 */
export function Modal({
  open,
  onClose,
  title,
  className,
  titleClassName,
  closeClassName,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  className: string;
  titleClassName: string;
  closeClassName: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className={`m-auto w-[calc(100%-2rem)] max-w-md p-0 ${className}`}
    >
      {open && (
        <div className="p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <h2 className={titleClassName}>{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className={`-mr-1 -mt-1 rounded-lg p-1.5 hover:opacity-80 ${closeClassName}`}
            >
              <XIcon className="h-5 w-5" />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
