// Player RPG surfaces: bevelled "material" panels (styles in globals.css).
//   stone     combat / HUD
//   wood      boards and frames
//   parchment cards, notes, the shop
//   inset     recessed dark well for bars and empty slots

export type PanelVariant = "stone" | "wood" | "parchment" | "inset";

/** Class string for elements that can't be a <Panel> (links, theme maps). */
export function panelClass(variant: PanelVariant) {
  return `panel panel-${variant}`;
}

export function Panel({
  variant,
  as: Tag = "div",
  className = "",
  ...props
}: React.ComponentPropsWithoutRef<"div"> & {
  variant: PanelVariant;
  as?: "div" | "section" | "li";
}) {
  // Block-level tags only; handlers are typed for <div>, which is fine here.
  const Element = Tag as "div";
  return <Element className={`${panelClass(variant)} ${className}`} {...props} />;
}
