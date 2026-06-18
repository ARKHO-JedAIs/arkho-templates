import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Path alias "@/..." maps to src/. Keep in sync with tsconfig.json paths.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
  },
});
