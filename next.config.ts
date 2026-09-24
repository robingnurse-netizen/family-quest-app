import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev only (ignored by production builds): lets the dev server's HMR socket
  // and dev assets answer the ChromeOS Linux container's Network address,
  // used when ChromeOS's localhost forwarding stops working.
  allowedDevOrigins: ["100.115.92.26"],
  async headers() {
    return [
      {
        // Sprite frames: every URL the app uses carries a content hash
        // (?v=…, written into the manifests by scripts/sprite-manifests.mjs),
        // so they can be cached for good — each frame is downloaded once,
        // and new art comes with new URLs. (Next's default for public/ is
        // max-age=0: re-downloaded whenever the browser drops it.)
        source: "/sprites/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
