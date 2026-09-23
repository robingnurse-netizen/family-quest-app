/**
 * One animation, as written by scripts/slice-sprites.mjs. Every frame shares
 * the same canvas (width × height); `anchor` is the character's feet on that
 * canvas, so animations of one character line up when swapped.
 */
export type SpriteAnimation = {
  frames: string[];
  fps: number;
  loop: boolean;
  width: number;
  height: number;
  anchor: { x: number; y: number };
};

export type SpriteManifest = {
  character: string;
  animations: Record<string, SpriteAnimation>;
};
