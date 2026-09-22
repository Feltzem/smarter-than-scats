import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const isStandalone = mode === "standalone";

  return {
    base: isStandalone ? "./" : process.env.VITE_BASE_PATH || "/",
    publicDir: isStandalone ? false : "public",
    plugins: [react(), ...(isStandalone ? [viteSingleFile()] : [])],
    clearScreen: false,
    server: {
      port: 5173,
      strictPort: false,
    },
    build: isStandalone
      ? {
          cssCodeSplit: false,
          assetsInlineLimit: () => true,
        }
      : undefined,
  };
});
