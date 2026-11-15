import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Lane packages ship TypeScript source; Next compiles them for the app and API routes.
  transpilePackages: ["@abdulcare/core", "@abdulcare/contracts", "@abdulcare/ai", "@abdulcare/payments"],
  // The kiosk is retired: /kiosk and everything under it go to the home page. Temporary (307),
  // so it's easy to bring back by deleting these two lines.
  async redirects() {
    return [
      { source: "/kiosk", destination: "/", permanent: false },
      { source: "/kiosk/:path*", destination: "/", permanent: false },
    ];
  },
};

export default nextConfig;
