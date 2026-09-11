import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "BobCall",
        short_name: "BobCall",
        description: "Approve Bob IDE tool calls from anywhere",
        start_url: "/",
        display: "standalone",
        background_color: "#0f0f0f",
        theme_color: "#6366f1",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" }
        ]
      },
      workbox: {
        // Cache the app shell; all API calls go to the relay (external), skip them
        globPatterns: ["**/*.{js,css,html,png,svg,ico}"],
        navigateFallback: "index.html",
        runtimeCaching: []
      }
    })
  ],
  server: {
    port: 5173,
    // Proxy /api to the relay so the PWA can be served on a different port in dev
    proxy: {
      "/api": {
        target: "http://localhost:3456",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, "")
      }
    }
  }
});
