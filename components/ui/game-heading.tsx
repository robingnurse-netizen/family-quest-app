// Game text heading: display font with a hard 2px pixel drop shadow.

const tones = {
  gold: "text-gold",
  parchment: "text-parchment",
} as const;

const sizes = {
  sm: "text-base", // section labels (never below 14px in the display font)
  md: "text-xl",
  lg: "text-2xl sm:text-3xl",
} as const;

export function GameHeading({
  as: Tag = "h2",
  tone = "gold",
  size = "md",
  className = "",
  children,
  ...props
}: React.ComponentPropsWithoutRef<"h2"> & {
  as?: "h1" | "h2" | "h3" | "p";
  tone?: keyof typeof tones;
  size?: keyof typeof sizes;
}) {
  return (
    <Tag
      className={`font-display font-semibold leading-tight text-shadow-pixel ${tones[tone]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </Tag>
  );
}
