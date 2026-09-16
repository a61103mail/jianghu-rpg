// Vite 設定:開發模式下前端(5173)透過 proxy 把 /api 與 Socket.IO 轉發到後端(3002),
// 這樣 src/api.js、src/socket.js 才能統一用「相對路徑/同來源」的寫法,
// 正式環境(後端直接提供前端靜態檔案)則完全不需要 proxy,自然就是同一個來源。
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '/api': 'http://localhost:3002',
      '/socket.io': { target: 'http://localhost:3002', ws: true },
    },
  },
});
