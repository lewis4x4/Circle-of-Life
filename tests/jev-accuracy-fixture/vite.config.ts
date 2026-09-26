import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
// The page's client component, outside Next: navigation and links are stubbed,
// and the Supabase client points at https://dummy.supabase.co, which the spec
// intercepts. Nothing here can reach a hosted project.
export default defineConfig({
  root: __dirname,
  define: { "process.env": {} },
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^next\/navigation$/, replacement: path.resolve(__dirname, "next-navigation-stub.ts") },
      { find: /^next\/link$/, replacement: path.resolve(__dirname, "next-link-stub.tsx") },
      { find: "@", replacement: path.resolve(__dirname, "../../src") },
    ],
  },
  server: { host: "127.0.0.1", port: 4417, strictPort: true },
});
