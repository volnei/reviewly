import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: path.resolve(__dirname, "site"),
  base: "/reviewly/",
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, "dist-site"),
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
    port: 4174,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 4174,
    strictPort: true,
  },
});
