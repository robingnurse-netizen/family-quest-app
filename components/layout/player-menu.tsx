"use client";

import { useEffect, useId, useRef, useState } from "react";
import { GearIcon } from "@/components/ui/icons";
import { pixelButtonClass } from "@/components/ui/pixel-button";
import { SignOutButton } from "./sign-out-button";

/**
 * The player's settings menu: a small gear button with a dropdown holding
 * Sign out, so signing out isn't a prominent button on the dashboard.
 * Closes on Escape, on a click outside, or when focus leaves it.
 */
export function PlayerMenu() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="relative shrink-0"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-label="Settings"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
        className={`${pixelButtonClass("stone", "sm")} h-9 w-9 px-0`}
      >
        <GearIcon className="h-5 w-5" />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          className="panel panel-stone absolute right-0 top-full z-40 mt-1 w-40 p-2"
        >
          <SignOutButton className={`${pixelButtonClass("stone", "sm")} w-full`} />
        </div>
      )}
    </div>
  );
}
