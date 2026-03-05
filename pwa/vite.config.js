import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
export default defineConfig({
    plugins: [
        react(),
        VitePWA({
            registerType: "autoUpdate",
            includeAssets: ["icon.svg"],
            manifest: {
                name: "AJAWAI Demo",
                short_name: "AJAWAI",
                description: "AJAWAI mobile-first demo PWA",
                theme_color: "#111827",
                background_color: "#ffffff",
                display: "standalone",
                start_url: "/",
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
