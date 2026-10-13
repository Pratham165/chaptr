/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "uploads.mangadex.org",
        pathname: "/covers/**",
      },
    ],
  },
  experimental: {
    serverComponentsExternalPackages: ["ws"],
  },
};

export default nextConfig;
