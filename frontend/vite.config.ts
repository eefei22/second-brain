import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Docker Desktop on Windows doesn't reliably forward host filesystem
    // change events into the container for bind mounts, so Vite's default
    // (native fs events) misses edits — HMR silently stops working. Polling
    // is slightly heavier but actually fires.
    watch: { usePolling: true },
  },
});
