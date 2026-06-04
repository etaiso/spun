import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Emit a self-contained server (.next/standalone/server.js) so the Electron
  // desktop shell can spawn it without the full repo / node_modules.
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname),
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
