import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const api = "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@kit": path.resolve(__dirname, "../renderer") } },
  server: {
    port: 5173,
    fs: { allow: [path.resolve(__dirname, "..")] },
    proxy: {
      "/api": api,
      "/media": api,
      "/ws": { target: api.replace("http", "ws"), ws: true },
    },
  },
});
