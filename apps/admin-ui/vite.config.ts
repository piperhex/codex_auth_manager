import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  root: currentDir,
  base: "/",
  server: {
    port: 1421,
    host: "127.0.0.1",
    proxy: {
      "/auth": "http://127.0.0.1:8080",
      "/sync": "http://127.0.0.1:8080",
      "/admin/api": "http://127.0.0.1:8080",
    },
  },
  build: {
    outDir: "../backend/public",
    emptyOutDir: false,
    assetsDir: "admin-assets",
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      input: resolve(currentDir, "admin.html"),
      output: {
        manualChunks: {
          antd: ["antd"],
          icons: ["lucide-react"],
        },
      },
    },
  },
});
