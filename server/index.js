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
import { exportSnapshot, importSnapshotIfEmpty, resetAllData } from './backup.js';
import { computeStats, addLog, checkLevelUp } from './engine/characterEngine.js';
import { depositFallenLoot } from './engine/fallenLootEngine.js';
import { generateCommonGear } from './engine/itemEngine.js';
import { getItem, getPotion, getEnhanceItem } from './data/itemData.js';
import {
  createParty,
  getParty,
  joinParty,
  leaveParty,
  findPartyByUser,
  updateMemberSocket,
  startBountyCombat,
  partyMemberAction,
  endCombat,
  purgeDisconnectedMembers,
} from './engine/partyEngine.js';
import { challenge, getPendingChallenge, declineChallenge, acceptChallenge, findDuelByUser, duelAttack, endDuel } from './engine/duelEngine.js';
import { initWorldBossState } from './engine/worldBossEngine.js';

const JWT_SECRET = process.env.JWT_SECRET || 'jianghu-dev-secret-please-change';
// 備份急救端點的存取密碼:此 repository 是 Public(公開)的,絕對不能在程式碼裡寫死一個「預設值」
// 當作密碼備援——那等於把密碼直接公開給所有人看。沒有設定 ADMIN_BACKUP_TOKEN 環境變數時,
// 這個端點就直接關閉(見下方 /api/admin/export),而不是退回某個寫在原始碼裡的固定字串。
const ADMIN_BACKUP_TOKEN = process.env.ADMIN_BACKUP_TOKEN || null;

// 伺服器啟動時:先確保資料表存在(Turso 是全新資料庫時需要建表),再檢查如果資料庫是全新空的
// (容器休眠喚醒/重新部署後的常態),嘗試從隨 git 一起保留下來的 data-snapshot.json 自動還原玩家資料,
// 把免費方案「沒有永久磁碟」的影響降到最低。ESM 支援頂層 await,故這裡直接等待完成才繼續往下執行。
await db.initSchema();
await importSnapshotIfEmpty();
await initWorldBossState(); // 世界真王重生計時記憶體快取,必須在接受任何請求之前載入完成(見 worldBossEngine.js)

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

// 存檔急救備份:受 token 保護,匯出全部資料表供人工存成 data-snapshot.json、commit 進版本控制。
// 沒有設定 ADMIN_BACKUP_TOKEN 時整個端點視同不存在(回 404),避免公開原始碼裡出現任何可用密碼。
app.get('/api/admin/export', async (req, res) => {
  if (!ADMIN_BACKUP_TOKEN) return res.status(404).end();
  if (req.query.token !== ADMIN_BACKUP_TOKEN) return res.status(403).json({ error: '無權限' });
  res.json(await exportSnapshot());
});

// 全部資料清空重來:不可逆操作,清空全部帳號/存檔/市場/交易所/遺物/真王計時,回到全新開局的狀態。
// 沿用跟 /api/admin/export 同一組 token 保護,GET 即可觸發(方便直接在瀏覽器網址列打開執行),
// 沒有設定 ADMIN_BACKUP_TOKEN 時整個端點視同不存在。
app.get('/api/admin/reset-all', async (req, res) => {
  if (!ADMIN_BACKUP_TOKEN) return res.status(404).end();
  if (req.query.token !== ADMIN_BACKUP_TOKEN) return res.status(403).json({ error: '無權限' });
  const result = await resetAllData();
  console.log('[admin] 已清空全部資料表,重新開始。');
  res.json(result);
});

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
const findUserByPlayerIdStmt = db.prepare('SELECT id, username FROM users WHERE player_id = ?');
const findPlayerIdStmt = db.prepare('SELECT player_id FROM users WHERE id = ?');
const deleteSaveStmt = db.prepare('DELETE FROM saves WHERE user_id = ?');
const deleteUserStmt = db.prepare('DELETE FROM users WHERE id = ?');

const onlineUsers = new Map(); // userId -> socketId,供決鬥挑戰指定對象使用
const onlineUsernames = new Map(); // userId -> { username, playerId },供「在線玩家名單」功能顯示(見 broadcastPresence)

// 廣播目前所有在線玩家名單給每一個人(不含自己),讓決鬥畫面能直接顯示可挑戰對象清單,
// 不用再自己輸入對方帳號——每次有人上線/離線都重新推播一次,確保名單即時。
// 畫面顯示一律用 playerId(遊戲暱稱),不曝光帳號 username;挑戰配對也改用 playerId(見 duel:challenge),
// 這裡仍附上 username 只是保留給伺服器端內部除錯用,前端不應該讀取這個欄位來顯示。
function broadcastPresence() {
  const all = Array.from(onlineUsernames.entries()).map(([userId, info]) => ({ userId, username: info.username, playerId: info.playerId }));
  onlineUsers.forEach((socketId, userId) => {
    io.to(socketId).emit('presence:update', { players: all.filter((p) => p.userId !== userId) });
  });
}

// 生死決鬥落敗:輸家的帳號與存檔被永久刪除(不可復原)。
// 贏家獎勵不給裝備/道具這類「現成的」東西——裝備本就該靠玩家自己去打拼、製作取得。
// 真正的獎勵是大量經驗值,足以讓人當場升級、變得更強。
async function applyDeathDuelOutcome(winnerId, loserId) {
  const winnerRow = await getSaveStmt.get(winnerId);
  if (!winnerRow) return null;
  const winnerSave = JSON.parse(winnerRow.data);

  winnerSave.exp += 150;
  addLog(winnerSave, '生死一線之間,你對自身戰鬥經驗有了更深體悟。');
  const leveledTo = checkLevelUp(winnerSave);
  if (leveledTo) {
    addLog(winnerSave, `這份體悟直接推動你升級至 Lv.${leveledTo}!`);
  }
  await putSaveStmt.run(winnerId, JSON.stringify(winnerSave), new Date().toISOString());

  await deleteSaveStmt.run(loserId);
  await deleteUserStmt.run(loserId);
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
// fn 可能是 async function(讀寫資料庫),故這裡也要 async + await,才能接住非同步拋出的例外
// (若只是原本的同步 try/catch,await 之後才發生的錯誤會變成沒人接住的 rejected promise)。
function safeHandler(socket, errorEvent, fn) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (err) {
      console.error(`[socket 事件錯誤] ${errorEvent}:`, err);
      socket.emit(errorEvent, { error: '伺服器處理時發生未預期的錯誤,請稍後再試。' });
    }
  };
}

io.on('connection', async (socket) => {
  const { userId, username } = socket.user;
  const userRow = await findPlayerIdStmt.get(userId);
  const playerId = userRow?.player_id || null;
  onlineUsers.set(userId, socket.id);
  onlineUsernames.set(userId, { username, playerId });
  broadcastPresence();

  // 玩家進入決鬥畫面時主動要求一份「當下」的在線名單快照,避免因為連線時機
  // (例如先逛了別的畫面,才第一次切到決鬥畫面)錯過先前的廣播、名單顯示過期。
  socket.on('presence:request', () => {
    const all = Array.from(onlineUsernames.entries()).map(([uid, info]) => ({ userId: uid, username: info.username, playerId: info.playerId }));
    socket.emit('presence:update', { players: all.filter((p) => p.userId !== userId) });
  });

  socket.on('party:create', safeHandler(socket, 'party:error', async () => {
    const row = await getSaveStmt.get(userId);
    const save = JSON.parse(row.data);
    const stats = computeStats(save);
    // partyEngine.js 內部用 username 欄位生成戰報文字(「XX 施展 YY」之類);這裡直接傳入 playerId
    // 頂替其值,讓組隊戰鬥全程顯示玩家ID而非帳號,不需要改動 partyEngine.js 任何一行。
    const party = createParty({ userId, username: playerId, classId: save.classId, stats, equipment: save.equipment, socketId: socket.id });
    socket.join(party.code);
    socket.emit('party:joined', { code: party.code, members: party.members.map((m) => ({ userId: m.userId, username: m.username })) });
  }));

  socket.on('party:join', safeHandler(socket, 'party:error', async ({ code }) => {
    const row = await getSaveStmt.get(userId);
    const save = JSON.parse(row.data);
    const stats = computeStats(save);
    const party = joinParty(code, { userId, username: playerId, classId: save.classId, stats, equipment: save.equipment, socketId: socket.id });
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

  // 副本內成員的戰鬥行動:action = 'basic'/'aoe'/'buff'/'defend'/'potion'
  // (potion 由這裡先讀取行動者自己的存檔藥水庫存並扣除,再把算好的回復量交給 partyEngine 套用)
  socket.on('party:action', safeHandler(socket, 'party:error', async ({ action, targetIndex, potionId }) => {
    const party = findPartyByUser(userId);
    if (!party || !party.combat) return socket.emit('party:error', { error: '目前沒有進行中的副本' });

    let extra = { targetIndex };
    if (action === 'potion') {
      const potion = getPotion(potionId);
      if (!potion) return socket.emit('party:error', { error: '無此藥水' });
      const row = await getSaveStmt.get(userId);
      const save = JSON.parse(row.data);
      if (!(save.potions?.[potionId] > 0)) return socket.emit('party:error', { error: '藥水數量不足' });
      save.potions[potionId] -= 1;
      await putSaveStmt.run(userId, JSON.stringify(save), new Date().toISOString());
      const member = party.combat.members[userId];
      if (potion.kind === 'hp') extra = { healAmount: Math.round(member.maxHp * potion.healPct), potionName: potion.name };
      else extra = { manaAmount: Math.round(member.maxMp * potion.healPct), potionName: potion.name };
    }

    const result = partyMemberAction(party, userId, action === 'potion' ? 'potionHeal' : action, extra);
    if (!result) return;
    broadcastParty(party, 'party:combat-update', { combat: party.combat, lines: result.lines, actorId: userId });

    if (result.ended === 'win') {
      // 依序(非平行)處理每位成員的獎勵存檔,避免同時大量並發寫入 Turso。
      for (const m of party.members) {
        const row = await getSaveStmt.get(m.userId);
        const memberSave = JSON.parse(row.data);
        memberSave.exp += result.totalExp;
        const leveledTo = checkLevelUp(memberSave);
        const drops = [];
        // 每位成員各自獨立擲骰所有已擊敗敵人的掉落表——不用搶最後一擊,人人依機率各自判定。
        // 卷軸/方塊屬於強化消耗品,要存進 save.consumables(跟單人戰鬥 game.js 的邏輯一致),
        // 不能跟一般材料混在一起存進 save.materials——先前這裡沒有區分,王掉的卷軸/方塊會被
        // 誤存進 materials,材料介面完全沒有對應分類可顯示,形同憑空消失、也無法拿去強化裝備。
        result.defeatedDropTables.forEach(({ dropTable, tier, level }) => {
          (dropTable || []).forEach((d) => {
            if (Math.random() < d.chance) {
              const amt = d.min + Math.floor(Math.random() * (d.max - d.min + 1));
              if (amt <= 0) return; // min:0 的掉落(如抉擇方塊)骰到0時,不加背包也不顯示戰報
              const enhanceItem = getEnhanceItem(d.id);
              if (enhanceItem) {
                memberSave.consumables[d.id] = (memberSave.consumables[d.id] || 0) + amt;
                drops.push(`${enhanceItem.name} x${amt}`);
              } else {
                memberSave.materials[d.id] = (memberSave.materials[d.id] || 0) + amt;
                drops.push(`${getItem(d.id)?.name || d.id} x${amt}`);
              }
            }
          });
          const gearChance = tier === 'boss' ? 0.35 : tier === 'miniboss' ? 0.25 : 0.12;
          if (Math.random() < gearChance) {
            const gear = generateCommonGear(level);
            memberSave.inventory.push(gear);
            drops.push(`裝備:${gear.name}`);
          }
        });
        // 把副本戰鬥中實際累積的氣血/真力損耗寫回真正的存檔——先前這裡完全沒有同步,通關後
        // save.hp/save.mp 還停留在「進副本前」的數值,玩家會看到自己好像「打完就自動全滿血」,
        // 其實是壓根沒扣血記錄過,不是真的恢復。跟單人戰鬥(game.js)的 save.hp = combat.playerHp
        // 是同一件事,只是組隊這邊先前漏掉了。裝備耐久度消耗同理,也要把戰鬥中直接修改過的
        // combatMember.equipment 寫回真正的 memberSave.equipment(組隊也是打怪,理應跟單人一致)。
        const combatMember = party.combat.members[m.userId];
        if (combatMember) {
          memberSave.hp = Math.max(1, combatMember.hp);
          memberSave.mp = Math.max(0, combatMember.mp);
          if (combatMember.equipment) memberSave.equipment = combatMember.equipment;
        }
        addLog(memberSave, `與同伴合力通關副本,獲得 ${result.totalExp} 點經驗${drops.length ? `,戰利品:${drops.join('、')}` : ''}。`);
        if (leveledTo) addLog(memberSave, `升級至 Lv.${leveledTo}。`);
        await putSaveStmt.run(m.userId, JSON.stringify(memberSave), new Date().toISOString());
        const sid = onlineUsers.get(m.userId);
        if (sid) io.to(sid).emit('party:reward', { totalExp: result.totalExp, drops, leveledTo });
      }
      endCombat(party);
      purgeDisconnectedMembers(party);
    } else if (result.ended === 'lose') {
      // 落敗同樣要把氣血/真力寫回存檔——全隊落敗時每個人在戰鬥中都是 0 氣血,直接照抄會變成
      // 「打輸了氣血歸零、下次連城鎮都進不去」,故套用跟單人戰敗一致的 35% 氣血保底恢復。
      // 裝備耐久度變化(同上)也要先寫回,才能讓 computeStats 算出的 maxHp 正確反映耐久耗盡的裝備已失效。
      for (const m of party.members) {
        const row = await getSaveStmt.get(m.userId);
        const memberSave = JSON.parse(row.data);
        const combatMember = party.combat.members[m.userId];
        if (combatMember) {
          if (combatMember.equipment) memberSave.equipment = combatMember.equipment;
          const stats = computeStats(memberSave);
          memberSave.hp = Math.max(1, Math.round(stats.maxHp * 0.35));
          memberSave.mp = Math.max(0, combatMember.mp);
        }
        addLog(memberSave, '副本挑戰落敗,狼狽退回城鎮。');
        await putSaveStmt.run(m.userId, JSON.stringify(memberSave), new Date().toISOString());
      }
      endCombat(party);
      purgeDisconnectedMembers(party);
    }
  }));

  // ---- 決鬥(1v1,論勝負 或 決生死)----
  // 統一用玩家ID(遊戲暱稱)查找對象,不要求玩家知道對方的登入帳號——不論是點選線上名單
  // 還是手動輸入,一律走同一套查找邏輯。
  socket.on('duel:challenge', safeHandler(socket, 'duel:error', async ({ targetPlayerId, stakes }) => {
    const target = await findUserByPlayerIdStmt.get(targetPlayerId);
    if (!target) return socket.emit('duel:error', { error: '查無此人' });
    if (target.id === userId) return socket.emit('duel:error', { error: '不能向自己下戰帖' });
    if (!onlineUsers.has(target.id)) return socket.emit('duel:error', { error: '對方不在線上' });
    challenge({ userId, displayName: playerId }, target.id, stakes === 'death' ? 'death' : 'win');
    io.to(onlineUsers.get(target.id)).emit('duel:challenged', { challengerName: playerId, stakes: stakes === 'death' ? 'death' : 'win' });
    socket.emit('duel:challenge-sent', { targetPlayerId });
  }));

  socket.on('duel:decline', safeHandler(socket, 'duel:error', () => {
    declineChallenge(userId);
  }));

  socket.on('duel:accept', safeHandler(socket, 'duel:error', async () => {
    const pending = getPendingChallenge(userId);
    if (!pending) return socket.emit('duel:error', { error: '沒有待處理的戰帖' });
    const challengerRow = await getSaveStmt.get(pending.challengerId);
    const targetRow = await getSaveStmt.get(userId);
    const challengerStats = computeStats(JSON.parse(challengerRow.data));
    const targetStats = computeStats(JSON.parse(targetRow.data));
    const duel = acceptChallenge(
      { userId: pending.challengerId, displayName: pending.challengerName, stats: challengerStats },
      { userId, displayName: playerId, stats: targetStats },
      pending.stakes
    );
    const payload = { duel, lines: duel.log };
    socket.emit('duel:start', payload);
    const challengerSocket = onlineUsers.get(pending.challengerId);
    if (challengerSocket) io.to(challengerSocket).emit('duel:start', payload);
  }));

  socket.on('duel:attack', safeHandler(socket, 'duel:error', async () => {
    const duel = findDuelByUser(userId);
    if (!duel) return socket.emit('duel:error', { error: '目前沒有進行中的決鬥' });
    const result = duelAttack(duel, userId);
    if (result.rejected) return socket.emit('duel:error', { error: result.lines[0] });
    const payload = { duel, lines: result.lines };
    [duel.a.userId, duel.b.userId].forEach((uid) => {
      const sid = onlineUsers.get(uid);
      if (sid) io.to(sid).emit('duel:update', payload);
    });

    if (result.ended === 'death') {
      const winnerId = result.loserUserId === duel.a.userId ? duel.b.userId : duel.a.userId;
      const loserUsername = duel.a.userId === result.loserUserId ? duel.a.username : duel.b.username;
      // 陣亡前先把裝備/背包留存為遺物,供其他玩家日後闖蕩時透過奇遇拾獲(見 fallenLootEngine.js)
      const loserRow = await getSaveStmt.get(result.loserUserId);
      if (loserRow) await depositFallenLoot(loserUsername, JSON.parse(loserRow.data));

      const outcome = await applyDeathDuelOutcome(winnerId, result.loserUserId);
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
    onlineUsernames.delete(userId);
    broadcastPresence();
    const party = findPartyByUser(userId);
    if (party) {
      // 只有「戰鬥進行中」才保留成員資格(socketId 設為 null,允許重新連線後歸隊,不會被踢出戰鬥)。
      // 若隊伍還在組隊大廳(尚未開打),斷線就直接視同離隊——先前不分情況一律「軟保留」,
      // 導致玩家隨手關掉分頁、隔天再打開遊戲,舊隊伍裡仍卡著他的殘影,下次真正組隊時人數對不上,
      // 也會讓王波規模(依人數決定)被幽靈成員錯誤放大。
      if (party.combat) {
        const member = party.members.find((m) => m.userId === userId);
        if (member) member.socketId = null;
      } else {
        leaveParty(userId);
      }
    }
  });
});

const PORT = process.env.PORT || 3002;
server.listen(PORT, () => {
  console.log(`江湖行 伺服器已啟動,監聽埠號 ${PORT}`);
});
