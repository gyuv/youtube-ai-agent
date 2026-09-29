import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
