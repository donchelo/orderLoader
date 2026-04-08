import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 and imapflow use native modules — keep them server-side only
  serverExternalPackages: ["better-sqlite3", "imapflow"],
  output: "standalone",
};

export default nextConfig;
