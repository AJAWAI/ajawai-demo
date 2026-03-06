import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/ajawai-demo/",
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts"
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      workbox: {
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024
      },
      manifest: {
        name: "AJAWAI Demo",
        short_name: "AJAWAI",
        description: "AJAWAI mobile-first demo PWA",
        theme_color: "#111827",
        background_color: "#ffffff",
        display: "standalone",
        start_url: "/ajawai-demo/",
        scope: "/ajawai-demo/",
        icons: [
          {
            src: "icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "maskable"
          }
        ]
      }
    })
  ]
});
