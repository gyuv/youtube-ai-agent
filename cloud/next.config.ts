import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The repo root has its own package-lock.json (the legacy agent); anchor Turbopack to cloud/.
  turbopack: {
    root: __dirname,
  },
  images: {
    // Scene thumbnails in the studio come from these free providers and Supabase Storage.
    remotePatterns: [
      { protocol: "https", hostname: "image.pollinations.ai" },
      { protocol: "https", hostname: "images.pexels.com" },
      { protocol: "https", hostname: "*.supabase.co" },
    ],
  },
};

export default nextConfig;
