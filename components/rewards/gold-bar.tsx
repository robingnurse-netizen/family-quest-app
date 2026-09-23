/** A small inset progress bar filling with gold (toward a reward). */
export function GoldBar({
  value,
  label,
  current,
  max,
  size = "md",
}: {
  /** 0–1 */
  value: number;
  label: string;
  current: number;
  max: number;
  size?: "sm" | "md";
}) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(current, max)}
      className={`overflow-hidden rounded-[3px] border-2 border-wood-edge bg-well p-px shadow-[inset_2px_2px_0_rgb(0_0_0/0.5)] ${
        size === "md" ? "h-4" : "h-3"
      }`}
    >
      <div className="bar-fill rounded-[1px] bg-gold" style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}
