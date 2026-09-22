// Pool colours. Stored as hex in weekly_pools.color; limited to this palette
// so every card stays readable with white text on both dashboards.

export const POOL_COLORS = [
  { hex: "#6366f1", name: "Indigo" },
  { hex: "#0ea5e9", name: "Sky" },
  { hex: "#10b981", name: "Emerald" },
  { hex: "#f59e0b", name: "Amber" },
  { hex: "#f43f5e", name: "Rose" },
  { hex: "#a855f7", name: "Purple" },
  { hex: "#14b8a6", name: "Teal" },
  { hex: "#f97316", name: "Orange" },
] as const;

export const DEFAULT_POOL_COLOR = POOL_COLORS[0].hex;

export function isPoolColor(value: string) {
  return POOL_COLORS.some((c) => c.hex === value);
}

/** Colour to render for a pool (falls back if the stored value is unknown). */
export function poolColor(value: string | null | undefined) {
  return value && isPoolColor(value) ? value : DEFAULT_POOL_COLOR;
}
