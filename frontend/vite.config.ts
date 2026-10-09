import path from "node:path";
import { defineConfig, type UserConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(__dirname, "./src") },
      // lucide 1.x dropped brand logos; src/lib/lucide-react.tsx restores them on top of the real package.
      { find: /^lucide-react$/, replacement: path.resolve(__dirname, "./src/lib/lucide-react.tsx") },
      { find: "lucide-react-upstream", replacement: path.resolve(__dirname, "./node_modules/lucide-react") },
      // recharts 3's Tooltip callback types reject some annotations; src/lib/recharts.tsx adapts them.
      { find: /^recharts$/, replacement: path.resolve(__dirname, "./src/lib/recharts.tsx") },
      { find: "recharts-upstream", replacement: path.resolve(__dirname, "./node_modules/recharts") },
    ],
  },
  build: {
    // O app é grande (CRM completo); separa bibliotecas pesadas para o primeiro carregamento ficar leve.
    chunkSizeWarningLimit: 1500,
  },
  server: {
    host: true,
    port: 3000,
    // Em desenvolvimento o frontend chama /api/* relativo; o Vite repassa para o FastAPI local.
    // Em produção (Vercel) o vercel.json reescreve /api/* para a função Python.
    proxy: {
      "/api": {
        target: "http://localhost:8001",
        changeOrigin: true,
      },
    },
  },
} satisfies UserConfig);
