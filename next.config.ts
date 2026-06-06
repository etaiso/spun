import type { NextConfig } from "next";
import path from "node:path";
import { version } from "./package.json";

const nextConfig: NextConfig = {
  // Emit a self-contained server (.next/standalone/server.js) so the Electron
  // desktop shell can spawn it without the full repo / node_modules.
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname),
  turbopack: {
    root: path.join(__dirname),
  },
  // Inlined at build time so the debug panel can show the running version.
  env: {
    appVersion: version,
  },
};

export default nextConfig;
