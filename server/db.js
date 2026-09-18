// 資料庫初始化:users(帳號) + saves(存檔,JSON blob 儲存角色/裝備/同行/恩怨等完整狀態)
// 改用 Turso(@libsql/client,libSQL/SQLite 相容的雲端持久化資料庫)——Render 免費方案沒有永久磁碟,
// 本機 SQLite 檔案在容器休眠喚醒或重新部署時會被整個重置,Turso 是獨立於 Render 容器生命週期之外的
// 外部服務,資料才能真正撐過重啟。沒有設定 TURSO_DATABASE_URL 時退回本機檔案(方便沒有憑證也能開發)。
//
// libSQL client 全面是非同步(Promise)API(即使指向本機檔案也一樣),不像先前 node:sqlite 的
// DatabaseSync 是同步的——這是這次改動唯一的行為差異,呼叫端一律要 await。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const client = createClient(
  process.env.TURSO_DATABASE_URL
    ? { url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN }
    : { url: `file:${path.join(__dirname, 'jianghu.db')}` }
);

// 相容層:維持原本 db.prepare(sql).get/all/run(...) 的呼叫寫法(只是從同步變非同步,呼叫端要加 await),
// 讓既有程式碼的改動盡量只需要補上 async/await,不用整個重寫成 client.execute({sql, args}) 的寫法。
function prepare(sql) {
  return {
    async get(...args) {
      const r = await client.execute({ sql, args });
      return r.rows[0];
    },
    async all(...args) {
      const r = await client.execute({ sql, args });
      return r.rows;
    },
    async run(...args) {
      const r = await client.execute({ sql, args });
      return { lastInsertRowid: r.lastInsertRowid, changes: r.rowsAffected };
    },
  };
}

// 建表:一律用 IF NOT EXISTS,伺服器每次啟動都會呼叫,但不會影響已存在的資料表與資料。
// 必須在 index.js 接受任何請求之前 await 完成(見 initSchema 的呼叫端)。
async function initSchema() {
  await client.executeMultiple(`
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

    -- 世界真王重生計時:全服共享的單一列(id 固定為 1),data 是 { [mapId]: readyAtEpochMs } 的 JSON,
    -- 取代小王/大王原本的個人存檔計時(save.bossCooldowns)——真王的重生是「全服共同」而非每人各自獨立,
    -- 見 engine/worldBossEngine.js。
    CREATE TABLE IF NOT EXISTS world_boss_state (
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

  // player_id(玩家自訂遊戲暱稱,取代畫面上顯示帳號用):既有資料庫可能是舊 schema 沒有這個欄位,
  // ALTER TABLE ADD COLUMN 補上去,欄位已存在時 libSQL 會丟錯,直接忽略該錯誤即可(讓這段可重複執行)。
  // 唯一性另外用獨立索引處理(而不是欄位本身宣告 UNIQUE)——SQLite 的唯一索引允許多個 NULL 並存,
  // 剛好符合「舊玩家尚未設定過暱稱」的情況,只有兩人都設定「相同的非 NULL 字串」才會真正衝突。
  try {
    await client.execute('ALTER TABLE users ADD COLUMN player_id TEXT');
  } catch (e) {
    if (!String(e?.message || e).toLowerCase().includes('duplicate column')) throw e;
  }
  await client.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_player_id ON users(player_id)');
}

// 供 backup.js 的還原流程包一層交易(BEGIN/COMMIT/ROLLBACK)使用——單一陳述式,跟 initSchema
// 的多陳述式(executeMultiple)分開,避免混用。
async function exec(sql) {
  await client.execute(sql);
}

const db = { prepare, initSchema, exec };
export default db;
