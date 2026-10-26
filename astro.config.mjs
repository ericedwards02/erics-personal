// @ts-check
import { defineConfig } from "astro/config";

import tailwindcss from "@tailwindcss/vite";

// https://astro.build/config
export default defineConfig({
  site: "https://ericedwards.dev",
  prefetch: true,
  vite: {
    plugins: [tailwindcss()],
  },
});
