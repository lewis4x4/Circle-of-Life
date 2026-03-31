import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Pin Turbopack root so a parent package-lock.json does not steal the workspace root.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
