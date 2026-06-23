import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  build: {
    rollupOptions: {
      output: {
        // Split big, independently-cacheable vendor groups out of the entry
        // chunk so a code change doesn't bust the whole bundle and rarely-used
        // libs (charts, markdown, syntax highlighting) load on demand.
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return;
          if (/recharts|d3-|victory|internmap/.test(id)) return "charts";
          if (/react-markdown|remark|rehype|micromark|mdast|hast|unist|unified/.test(id))
            return "markdown";
          if (/refractor|prismjs|highlight\.js/.test(id)) return "prism";
          if (/@tanstack/.test(id)) return "tanstack";
          if (/react-dom|react\/|scheduler/.test(id)) return "react";
        },
      },
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
}));
