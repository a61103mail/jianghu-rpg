// 世界真王重生計時(奇幻練功MMO):全服共享單一列狀態(world_boss_state 資料表,固定 id=1),
// 取代小王/大王原本的個人存檔計時(save.bossCooldowns)——真王重生是「全服共同」而非每人各自獨立進度。
//
// 採記憶體快取 + 持久化寫回的模式(而非每次讀取都查 DB):伺服器啟動時從 DB 載入一次到記憶體,
// 之後 isTrueBossReady()/getTrueBossReadyAt() 皆為同步讀取記憶體,不需要把呼叫鏈(如 publicState)
// 整條改成 async——真王被擊敗、需要寫回新的重生時間時,才在該次 async 路由處理內 await 寫回 DB。
// 併發:Node.js 單執行緒事件迴圈保證同步賦值不會被其他請求打斷,即使兩位玩家「幾乎同時」擊敗
// 同一隻真王,最終寫入 DB 的只會是其中一次呼叫的結果,不會造成資料損毀,是可接受的簡化。
import db from '../db.js';

const getStmt = db.prepare('SELECT data FROM world_boss_state WHERE id = 1');
const putStmt = db.prepare(
  'INSERT INTO world_boss_state (id, data, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at'
);

let cache = null; // { [mapId]: readyAtEpochMs }

// 伺服器啟動時務必先呼叫並 await 完成,才能接受任何請求(見 index.js)
export async function initWorldBossState() {
  const row = await getStmt.get();
  cache = row ? JSON.parse(row.data) : {};
}

function ensureCache() {
  if (!cache) cache = {}; // 極端防呆:萬一有呼叫端在 initWorldBossState 完成前就用到,視為「全部可挑戰」而非拋錯卡住玩家
  return cache;
}

// 同步讀取,供 publicState 這類同步函式鏈直接呼叫
export function getTrueBossReadyAt(mapId) {
  return ensureCache()[mapId] || 0;
}

export function isTrueBossReady(mapId) {
  return Date.now() >= getTrueBossReadyAt(mapId);
}

export function trueBossStatusFor(map) {
  const now = Date.now();
  const readyAt = getTrueBossReadyAt(map.id);
  return {
    alive: now >= readyAt,
    respawnInSec: Math.max(0, Math.ceil((readyAt - now) / 1000)),
  };
}

// 真王被實際擊敗時呼叫(戰鬥結算的 async 路由內 await 這個函式):更新記憶體快取 + 寫回 DB
export async function markTrueBossDefeated(mapId, respawnMin) {
  const c = ensureCache();
  c[mapId] = Date.now() + respawnMin * 60000;
  await putStmt.run(JSON.stringify(c), new Date().toISOString());
}
