"use client";

import { setSoundMuted, useSoundMuted } from "@/lib/sound/sound-manager";
import { SpeakerIcon, SpeakerOffIcon } from "./icons";
import { pixelButtonClass } from "./pixel-button";

/** Sound effects on/off (remembered in this browser). A small stone button. */
export function SoundToggle({ className = "" }: { className?: string }) {
  const muted = useSoundMuted();
  return (
    <button
      type="button"
      aria-label={muted ? "Turn sound effects on" : "Turn sound effects off"}
      title={muted ? "Sound off" : "Sound on"}
      onClick={() => setSoundMuted(!muted)}
      className={`${pixelButtonClass("stone", "sm")} h-9 w-9 px-0 ${className}`}
    >
      {muted ? <SpeakerOffIcon className="h-5 w-5" /> : <SpeakerIcon className="h-5 w-5" />}
    </button>
  );
}
