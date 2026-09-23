// Player RPG button: solid face on a 4px ledge that presses down when
// tapped; disabled is flat and grey (styles in globals.css). Labels use the
// display font.

export type PixelButtonVariant = "primary" | "gold" | "stone" | "danger";
export type PixelButtonSize = "sm" | "md" | "lg";

/** Class string for elements that can't be a <PixelButton> (links, forms). */
export function pixelButtonClass(variant: PixelButtonVariant = "stone", size: PixelButtonSize = "md") {
  return `btn-pixel btn-${variant} btn-${size}`;
}

export function PixelButton({
  variant = "stone",
  size = "md",
  className = "",
  type = "button",
  ...props
}: React.ComponentPropsWithoutRef<"button"> & {
  variant?: PixelButtonVariant;
  size?: PixelButtonSize;
}) {
  return <button type={type} className={`${pixelButtonClass(variant, size)} ${className}`} {...props} />;
}
