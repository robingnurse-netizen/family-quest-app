/**
 * One animation, as written by scripts/slice-sprites.mjs. Every frame shares
 * the same canvas (width × height); `anchor` is the character's feet on that
 * canvas, so animations of one character line up when swapped.
 */
/** Which way a sprite faces as drawn on its sheet. */
export type Facing = "left" | "right" | "front";

export type SpriteAnimation = {
  frames: string[];
  fps: number;
  loop: boolean;
  width: number;
  height: number;
  anchor: { x: number; y: number };
  /** Grid sheets: the standing body's height in art pixels (the row's
   *  first frame), where later frames can make the canvas taller. */
  bodyHeight?: number;
  /**
   * Ground shadow per frame (scripts/sprite-shadows.mjs): frame path →
   * [centreX, width, lift, band] in canvas pixels (band: the contact band's
   * height, far feet to lowest pixel). Keyed by path, so animations built
   * from these frames (reordered, trimmed, reversed) keep it.
   */
  shadow?: Record<string, [number, number, number, number]>;
  /** Frames exempt from grounding (indices into `frames`): jumps, hovering. */
  airborne?: number[];
  /** Which way this pose faces as drawn (scripts/slice-sprites.mjs FACING). */
  facing: Facing;
};

export type SpriteManifest = {
  character: string;
  animations: Record<string, SpriteAnimation>;
};
