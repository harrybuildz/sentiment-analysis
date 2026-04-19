import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite config — React plugin, default port 5173.
// The backend's CORS_ORIGINS must include http://localhost:5173.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
});
