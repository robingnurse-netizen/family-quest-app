// A red wax seal (the quest board's "today", the shop's parcels).

/**
 * A red wax seal: irregular poured edge, a raised ring pressed into the wax,
 * and the date stamped inside it. The number is kept small (≤ ~55% of the
 * seal's width even for two digits) so it reads as an impression, not a
 * sticker.
 */
export function WaxSeal({ children, size = "md" }: { children?: React.ReactNode; size?: "md" | "sm" }) {
  return (
    <span
      className={`relative flex shrink-0 items-center justify-center ${size === "md" ? "h-10 w-10" : "h-7 w-7"}`}
    >
      <svg viewBox="0 0 40 40" className="absolute inset-0 h-full w-full" aria-hidden>
        {/* Poured wax: a lumpy edge with a darker rim. */}
        <path
          d="M20 1.6 L24.2 3.9 L28.9 3 L31.1 7.2 L35.8 8.9 L35.4 13.8 L38.3 17.6 L36.2 22 L37.3 26.8 L33.3 29.6 L32.1 34.4 L27.2 34.9 L23.7 38.4 L19.3 36.3 L14.6 38 L12.1 33.7 L7.3 32.5 L7.1 27.6 L3.3 24.5 L5.3 20 L3.7 15.3 L7.5 12.4 L8.3 7.5 L13.1 6.6 L15.9 2.6 Z"
          fill="#c92a2a"
          stroke="#7a1414"
          strokeWidth="1.6"
        />
        {/* A soft highlight on the poured wax, top-left. */}
        <path d="M10.5 12 Q14 8.4 18.5 7.8" fill="none" stroke="#ff8787" strokeWidth="1.5" strokeLinecap="round" />
        {/* The pressed face: slightly darker, recessed. */}
        <circle cx="20" cy="20" r="12.2" fill="#b32424" />
        {/* Raised ring: shadow down-right, highlight up-left (embossed). */}
        <circle cx="20.6" cy="20.7" r="12.2" fill="none" stroke="#6e1111" strokeWidth="1.8" />
        <circle cx="19.5" cy="19.4" r="12.2" fill="none" stroke="#ef6b6b" strokeWidth="1.2" />
        <circle cx="20" cy="20" r="12.2" fill="none" stroke="#d63a3a" strokeWidth="1" />
      </svg>
      {/* 14px black digits: "23" is ~16px wide (40% of the seal), "5" ~8px.
          Nunito's digits sit a touch high in their line box; nudge down. */}
      {/* sm (28px, calendar cells): 11px digits, "23" ≈ 13px ≈ 46%. */}
      <span className={`relative translate-y-px font-black leading-none tabular-nums ${size === "md" ? "text-sm" : "text-[11px]"} text-[#fff5f5] [text-shadow:0_1px_0_#6e1111,0_-1px_0_rgb(255_255_255/0.2)]`}>
        {children}
      </span>
    </span>
  );
}
