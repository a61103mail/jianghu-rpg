// 陣亡者遺物引擎:生死決鬥落敗的玩家,其裝備/背包物品會留存於此(fallen_loot 資料表),
// 供其他玩家闖蕩時透過「奇遇」偶然拾獲。撿到時只能從中「挑選一件」帶走,其餘遺物隨之消散(不重複發放)。
import db from '../db.js';

const insertStmt = db.prepare('INSERT INTO fallen_loot (fallen_username, items_json, created_at) VALUES (?, ?, ?)');
const countStmt = db.prepare('SELECT COUNT(*) as c FROM fallen_loot');
const randomOneStmt = db.prepare('SELECT * FROM fallen_loot ORDER BY RANDOM() LIMIT 1');
const deleteByIdStmt = db.prepare('DELETE FROM fallen_loot WHERE id = ?');

// 玩家死亡時呼叫:蒐集其裝備欄+背包內的裝備類物品(材料/藥水不列入,避免遺物列表過長),存成一筆遺物紀錄
export function depositFallenLoot(username, save) {
  const items = [];
  Object.values(save.equipment || {}).forEach((item) => {
    if (item) items.push(item);
  });
  (save.inventory || []).forEach((item) => items.push(item));
  if (items.length === 0) return;
  insertStmt.run(username, JSON.stringify(items), new Date().toISOString());
}

export function hasFallenLoot() {
  return countStmt.get().c > 0;
}

// 隨機取得一筆遺物紀錄(供奇遇事件展示選擇用),不會刪除——需玩家實際選擇後才呼叫 claimFallenLoot 刪除
export function peekRandomFallenLoot() {
  const row = randomOneStmt.get();
  if (!row) return null;
  return { id: row.id, fallenUsername: row.fallen_username, items: JSON.parse(row.items_json) };
}

// 玩家挑選其中一件帶走後,整筆遺物紀錄即消散(其餘未被選走的物品不會留下)。
// 回傳是否確實刪除成功——若同一份遺物已被其他玩家搶先拾獲(見 game.js 的競態處理),回傳 false。
export function claimFallenLoot(id) {
  const result = deleteByIdStmt.run(id);
  return result.changes > 0;
}
