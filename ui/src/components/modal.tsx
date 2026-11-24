"use client";

import { useEffect, useRef } from "react";

/** A modal the browser keeps: focus stays inside, Escape closes it. */
export function Modal({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={label}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="m-auto w-[min(560px,calc(100vw-32px))] rounded-[16px] border border-rule bg-surface p-0 text-left text-ink shadow-soft backdrop:bg-black/40"
    >
      <div className="flex max-h-[calc(100dvh-64px)] flex-col gap-4 overflow-y-auto p-6">{children}</div>
    </dialog>
  );
}
