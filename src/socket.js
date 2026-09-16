// Socket.IO 客戶端:即時組隊 / 決鬥
// 不帶網址參數 = 連回目前頁面所在的同一個來源(origin),跟 api.js 的相對路徑同一個道理
import { io } from 'socket.io-client';
import { getToken } from './api.js';

let socket = null;

export function connectSocket() {
  if (socket) return socket;
  socket = io({ auth: { token: getToken() } });
  return socket;
}

export function getSocket() {
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
