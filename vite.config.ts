// Using @cloudflare/vite-plugin so Vite handles the full dev + build pipeline.
// This replaces `wrangler dev` — run `npm run dev` and Vite spins up a local
// server that proxies Worker requests through a wrangler miniflare instance.

import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    react(),
    cloudflare(),
  ],
});
