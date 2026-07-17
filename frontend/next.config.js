/** @type {import('next').NextConfig} */
const nextConfig = {
  // ffmpeg-static ships a pre-built native binary. If webpack bundles the JS
  // that resolves its path, the path points into .next/vendor-chunks/ where
  // the .exe was never copied → ENOENT. Marking it external keeps it in
  // node_modules so Node can find the real binary at runtime.
  experimental: {
    serverComponentsExternalPackages: ["ffmpeg-static"],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
      {
        protocol: "https",
        hostname: "drive.google.com",
      },
      {
        protocol: "https",
        hostname: "m.media-amazon.com",
      },
      {
        protocol: "https",
        hostname: "image.tmdb.org",
      },
    ],
  },
};

module.exports = nextConfig;
