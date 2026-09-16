// 江湖行 RPG 伺服器入口:REST API(單人劇情/戰鬥/裝備) + Socket.IO(即時組隊共鬥)
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import authRoutes from './routes/auth.js';
import gameRoutes from './routes/game.js';
import db from './db.js';
import { computeStats, addLog, checkLevelUp } from './engine/characterEngine.js';
import { depositFallenLoot } from './engine/fallenLootEngine.js';
import {
  createParty,
  getParty,
  joinParty,
  leaveParty,
  findPartyByUser,
  updateMemberSocket,
  startBountyCombat,
  partyMemberAttack,
  endCombat,
} from './engine/partyEngine.js';
import { challenge, getPendingChallenge, declineChallenge, acceptChallenge, findDuelByUser, duelAttack, endDuel } from './engine/duelEngine.js';

const JWT_SECRET = process.env.JWT_SECRET || 'jianghu-dev-secret-please-change';

// 最後一道防線:任何沒被個別 try/catch 接住的例外,只記錄下來、不讓整個伺服器行程崩潰。
// (先前實際發生過:決鬥結算一個打字錯誤讓整台伺服器當機,所有人瞬間斷線——不能再讓單一錯誤波及所有玩家。)
process.on('uncaughtException', (err) => {
  console.error('[未捕捉的例外,伺服器繼續運行]', err);
});
process.on('unhandledRejection', (err) => {
  console.error('[未處理的 Promise rejection,伺服器繼續運行]', err);
});

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api/auth', authRoutes());
app.use('/api/game', gameRoutes());

// 正式環境:後端順便把前端打包後的靜態檔案(../dist,由 npm run build 產生)一起提供出去,
// 這樣對外只需要開放/分享「一個」連接埠,不用另外處理前後端跨網域問題(方便用 Cloudflare Tunnel 這類工具分享)。
// 開發模式(npm run dev)則是前端另外用 Vite(5173)+ proxy 轉發,不會用到這段。
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const getSaveStmt = db.prepare('SELECT data FROM saves WHERE user_id = ?');
const putSaveStmt = db.prepare(
  'INSERT INTO saves (user_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at'
);
const findUserByNameStmt = db.prepare('SELECT id, username FROM users WHERE username = ?');
const deleteSaveStmt = db.prepare('DELETE FROM saves WHERE user_id = ?');
const deleteUserStmt = db.prepare('DELETE FROM users WHERE id = ?');

const onlineUsers = new Map(); // userId -> socketId,供決鬥挑戰指定對象使用

// 生死決鬥落敗:輸家的帳號與存檔被永久刪除(不可復原)。
// 贏家獎勵不給裝備/道具這類「現成的」東西——裝備本就該靠玩家自己去打拼、製作取得。
// 真正的獎勵是大量經驗值,足以讓人當場升級、變得更強。
function applyDeathDuelOutcome(winnerId, loserId) {
  const winnerRow = getSaveStmt.get(winnerId);
  if (!winnerRow) return null;
  const winnerSave = JSON.parse(winnerRow.data);

  winnerSave.exp += 150;
  addLog(winnerSave, '生死一線之間,你對自身戰鬥經驗有了更深體悟。');
  const leveledTo = checkLevelUp(winnerSave);
  if (leveledTo) {
    addLog(winnerSave, `這份體悟直接推動你升級至 Lv.${leveledTo}!`);
  }
  putSaveStmt.run(winnerId, JSON.stringify(winnerSave), new Date().toISOString());

  deleteSaveStmt.run(loserId);
  deleteUserStmt.run(loserId);
  return { leveledTo };
}

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    socket.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    next(new Error('未登入'));
  }
});

function broadcastParty(party, event, payload) {
  party.members.forEach((m) => {
    if (m.socketId) io.to(m.socketId).emit(event, payload);
  });
}

// 安全包裝:任何事件處理器內部拋出例外時,先前完全沒有防護,一個沒抓到的錯誤就會讓整個
// Node 行程崩潰、所有玩家瞬間斷線(實際發生過:一次生死決鬥的善後邏輯有錯字,直接打垮整台伺服器)。
// 包一層 try/catch,讓錯誤只影響「這一次操作」,回報給該玩家,其餘人不受影響。
function safeHandler(socket, errorEvent, fn) {
  return (...args) => {
    try {
      fn(...args);
    } catch (err) {
      console.error(`[socket 事件錯誤] ${errorEvent}:`, err);
      socket.emit(errorEvent, { error: '伺服器處理時發生未預期的錯誤,請稍後再試。' });
    }
  };
}

io.on('connection', (socket) => {
  const { userId, username } = socket.user;
  onlineUsers.set(userId, socket.id);

  socket.on('party:create', safeHandler(socket, 'party:error', () => {
    const row = getSaveStmt.get(userId);
    const save = JSON.parse(row.data);
    const stats = computeStats(save);
    const party = createParty({ userId, username, stats, socketId: socket.id });
    socket.join(party.code);
    socket.emit('party:joined', { code: party.code, members: party.members.map((m) => ({ userId: m.userId, username: m.username })) });
  }));

  socket.on('party:join', safeHandler(socket, 'party:error', ({ code }) => {
    const row = getSaveStmt.get(userId);
    const save = JSON.parse(row.data);
    const stats = computeStats(save);
    const party = joinParty(code, { userId, username, stats, socketId: socket.id });
    if (!party) return socket.emit('party:error', { error: '找不到隊伍,或隊伍已滿/戰鬥中' });
    socket.join(party.code);
    broadcastParty(party, 'party:joined', { code: party.code, members: party.members.map((m) => ({ userId: m.userId, username: m.username })) });
  }));

  socket.on('party:leave', safeHandler(socket, 'party:error', () => {
    const party = findPartyByUser(userId);
    if (!party) return;
    socket.leave(party.code);
    const updated = leaveParty(userId);
    if (updated) broadcastParty(updated, 'party:joined', { code: updated.code, members: updated.members.map((m) => ({ userId: m.userId, username: m.username })) });
  }));

  socket.on('party:start-bounty', safeHandler(socket, 'party:error', ({ mapId }) => {
    const party = findPartyByUser(userId);
    if (!party) return socket.emit('party:error', { error: '尚未加入隊伍' });
    updateMemberSocket(userId, socket.id);
    const combat = startBountyCombat(party, mapId);
    if (!combat) return socket.emit('party:error', { error: '找不到懸賞目標' });
    broadcastParty(party, 'party:combat-update', { combat, lines: combat.log });
  }));

  socket.on('party:attack', safeHandler(socket, 'party:error', () => {
    const party = findPartyByUser(userId);
    if (!party || !party.combat) return socket.emit('party:error', { error: '目前沒有進行中的共鬥' });
    const result = partyMemberAttack(party, userId);
    broadcastParty(party, 'party:combat-update', { combat: party.combat, lines: result.lines, actorId: userId });

    if (result.ended === 'win') {
      const enemy = party.combat.enemyId;
      party.members.forEach((m) => {
        const row = getSaveStmt.get(m.userId);
        const memberSave = JSON.parse(row.data);
        memberSave.exp += 40; // 懸賞共鬥固定歷練獎勵(不依賴誰打最後一擊,人人有份)
        addLog(memberSave, `與同伴合力擊敗懸賞要犯,獲得歷練。`);
        putSaveStmt.run(m.userId, JSON.stringify(memberSave), new Date().toISOString());
      });
      endCombat(party);
    } else if (result.ended === 'lose') {
      endCombat(party);
    }
  }));

  // ---- 決鬥(1v1,論勝負 或 決生死)----
  socket.on('duel:challenge', safeHandler(socket, 'duel:error', ({ targetUsername, stakes }) => {
    const target = findUserByNameStmt.get(targetUsername);
    if (!target) return socket.emit('duel:error', { error: '查無此人' });
    if (target.id === userId) return socket.emit('duel:error', { error: '不能向自己下戰帖' });
    if (!onlineUsers.has(target.id)) return socket.emit('duel:error', { error: '對方不在線上' });
    challenge({ userId, username }, target.id, stakes === 'death' ? 'death' : 'win');
    io.to(onlineUsers.get(target.id)).emit('duel:challenged', { challengerName: username, stakes: stakes === 'death' ? 'death' : 'win' });
    socket.emit('duel:challenge-sent', { targetUsername });
  }));

  socket.on('duel:decline', safeHandler(socket, 'duel:error', () => {
    declineChallenge(userId);
  }));

  socket.on('duel:accept', safeHandler(socket, 'duel:error', () => {
    const pending = getPendingChallenge(userId);
    if (!pending) return socket.emit('duel:error', { error: '沒有待處理的戰帖' });
    const challengerRow = getSaveStmt.get(pending.challengerId);
    const targetRow = getSaveStmt.get(userId);
    const challengerStats = computeStats(JSON.parse(challengerRow.data));
    const targetStats = computeStats(JSON.parse(targetRow.data));
    const duel = acceptChallenge(
      { userId: pending.challengerId, username: pending.challengerName, stats: challengerStats },
      { userId, username, stats: targetStats },
      pending.stakes
    );
    const payload = { duel, lines: duel.log };
    socket.emit('duel:start', payload);
    const challengerSocket = onlineUsers.get(pending.challengerId);
    if (challengerSocket) io.to(challengerSocket).emit('duel:start', payload);
  }));

  socket.on('duel:attack', safeHandler(socket, 'duel:error', () => {
    const duel = findDuelByUser(userId);
    if (!duel) return socket.emit('duel:error', { error: '目前沒有進行中的決鬥' });
    const result = duelAttack(duel, userId);
    const payload = { duel, lines: result.lines };
    [duel.a.userId, duel.b.userId].forEach((uid) => {
      const sid = onlineUsers.get(uid);
      if (sid) io.to(sid).emit('duel:update', payload);
    });

    if (result.ended === 'death') {
      const winnerId = result.loserUserId === duel.a.userId ? duel.b.userId : duel.a.userId;
      const loserUsername = duel.a.userId === result.loserUserId ? duel.a.username : duel.b.username;
      // 陣亡前先把裝備/背包留存為遺物,供其他玩家日後闖蕩時透過奇遇拾獲(見 fallenLootEngine.js)
      const loserRow = getSaveStmt.get(result.loserUserId);
      if (loserRow) depositFallenLoot(loserUsername, JSON.parse(loserRow.data));

      const outcome = applyDeathDuelOutcome(winnerId, result.loserUserId);
      const loserSocket = onlineUsers.get(result.loserUserId);
      if (loserSocket) {
        io.to(loserSocket).emit('duel:eliminated', { message: '此戰落敗,依生死戰約,帳號已被永久刪除。' });
        io.sockets.sockets.get(loserSocket)?.disconnect(true);
      }
      const winnerSocket = onlineUsers.get(winnerId);
      if (winnerSocket) io.to(winnerSocket).emit('duel:victory', { outcome });
      onlineUsers.delete(result.loserUserId);
      endDuel(duel);
    } else if (result.ended === 'win') {
      endDuel(duel);
    }
  }));

  socket.on('disconnect', () => {
    onlineUsers.delete(userId);
    const party = findPartyByUser(userId);
    if (party) {
      const member = party.members.find((m) => m.userId === userId);
      if (member) member.socketId = null; // 保留隊伍成員資格,允許重新連線後歸隊
    }
  });
});

const PORT = process.env.PORT || 3002;
server.listen(PORT, () => {
  console.log(`江湖行 伺服器已啟動,監聽埠號 ${PORT}`);
});
