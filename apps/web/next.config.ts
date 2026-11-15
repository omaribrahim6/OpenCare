import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Lane packages ship TypeScript source; Next compiles them for the app and API routes.
  transpilePackages: ["@abdulcare/core", "@abdulcare/contracts", "@abdulcare/ai", "@abdulcare/payments"],
  // The kiosk is retired for visitors: /kiosk and everything under it go to the home page.
  // Temporary (307), so it's easy to bring back. Mohamed's kiosk iPhone app (user agent
  // "OpenCareKiosk/…") still reaches it, at Musa's call.
  async redirects() {
    const notKioskApp = [{ type: "header" as const, key: "user-agent", value: ".*OpenCareKiosk/.*" }];
    return [
      { source: "/kiosk", destination: "/", permanent: false, missing: notKioskApp },
      { source: "/kiosk/:path*", destination: "/", permanent: false, missing: notKioskApp },
    ];
  },
};

export default nextConfig;
