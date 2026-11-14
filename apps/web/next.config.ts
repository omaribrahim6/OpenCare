import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Lane packages ship TypeScript source; Next compiles them for the app and API routes.
  transpilePackages: ["@abdulcare/core", "@abdulcare/contracts", "@abdulcare/ai", "@abdulcare/payments"],
};

export default nextConfig;
