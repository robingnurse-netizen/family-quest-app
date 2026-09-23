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
  /** Which way this pose faces as drawn (scripts/slice-sprites.mjs FACING). */
  facing: Facing;
};

export type SpriteManifest = {
  character: string;
  animations: Record<string, SpriteAnimation>;
};
