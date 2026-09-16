// 資料庫初始化:users(帳號) + saves(存檔,JSON blob 儲存角色/裝備/同行/恩怨等完整狀態)
// 使用 Node.js 內建的 node:sqlite(DatabaseSync),避免 better-sqlite3 需要原生編譯環境(Python/node-gyp)的問題。
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(path.join(__dirname, 'jianghu.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS saves (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- 雜貨店回收市場:全服共享的單一列(id 固定為 1),記錄每種雜物目前的回收庫存與藥水特惠庫存,
  -- 玩家越常賣同一種雜物,該項庫存越高、回收價越低;由 marketEngine.js 的排程每 5 分鐘銷毀部分庫存並轉換成藥水特惠庫存。
  CREATE TABLE IF NOT EXISTS market_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- 玩家交易所:持久化上架列表,買賣雙方皆為玩家
  CREATE TABLE IF NOT EXISTS auction_listings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seller_id INTEGER NOT NULL REFERENCES users(id),
    seller_name TEXT NOT NULL,
    item_json TEXT NOT NULL,
    price INTEGER NOT NULL,
    listed_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  -- 陣亡者遺物:生死決鬥落敗、帳號被刪除時,把該玩家的裝備/背包物品留存於此,
  -- 供其他玩家闖蕩時透過「奇遇」偶然拾獲,只能從中挑選一件帶走(見 game.js 的 pendingLootChoice)。
  CREATE TABLE IF NOT EXISTS fallen_loot (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fallen_username TEXT NOT NULL,
    items_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

export default db;
