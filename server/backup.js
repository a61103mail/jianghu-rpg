// 存檔急救備份:現在資料庫已改用 Turso(見 db.js),資料本身已經能撐過休眠/重新部署了,
// 這套機制降級為「萬一 Turso 本身出狀況或想換其他資料庫」時的次要保險,平常不需要主動使用:
// 1. exportSnapshot() 把所有資料表整份匯出成 JSON,透過受保護的 /api/admin/export 端點取得。
// 2. 把匯出結果存成 server/data-snapshot.json 並 commit 進 git,可作為離線備份存檔。
// 3. importSnapshotIfEmpty() 在伺服器啟動時執行:只有在資料庫「目前完全是空的」(代表這是一個
//    全新資料庫,例如換了新的 Turso 資料庫)且 data-snapshot.json 存在時,才會自動還原,
//    不會覆蓋掉正在使用中的真實資料。
// 4. resetAllData() 清空全部資料表(全新開始用),透過受保護的 /api/admin/reset-all 端點觸發。
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import db from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = path.join(__dirname, 'data-snapshot.json');

const TABLES = ['users', 'saves', 'market_state', 'auction_listings', 'fallen_loot', 'world_boss_state'];

export async function exportSnapshot() {
  const snapshot = { exportedAt: new Date().toISOString(), tables: {} };
  for (const table of TABLES) {
    snapshot.tables[table] = await db.prepare(`SELECT * FROM ${table}`).all();
  }
  return snapshot;
}

// 清空全部資料表(帳號/存檔/市場/交易所/遺物/真王計時),回到全新空資料庫的狀態。
// 不可逆操作,由呼叫端(index.js 的 /api/admin/reset-all)先驗證 token 才會執行到這裡。
// saves 有外鍵參照 users,必須先清子表(saves)再清父表(users),否則違反外鍵約束。
export async function resetAllData() {
  const deleteOrder = ['saves', 'users', 'market_state', 'auction_listings', 'fallen_loot', 'world_boss_state'];
  for (const table of deleteOrder) {
    await db.exec(`DELETE FROM ${table}`);
  }
  return { reset: true, tables: deleteOrder, resetAt: new Date().toISOString() };
}

// 只有在 users 資料表目前完全是空的(=剛啟動的全新容器,還沒有任何人註冊過)才還原,
// 避免不小心把正在使用中、比快照更新的真實資料蓋掉。
export async function importSnapshotIfEmpty() {
  const userCount = (await db.prepare('SELECT COUNT(*) AS c FROM users').get()).c;
  if (userCount > 0) {
    console.log('[backup] 資料庫已有資料,略過自動還原。');
    return { restored: false, reason: 'not_empty' };
  }
  if (!fs.existsSync(SNAPSHOT_PATH)) {
    console.log('[backup] 找不到 data-snapshot.json,略過自動還原(全新空資料庫)。');
    return { restored: false, reason: 'no_snapshot' };
  }
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf-8'));
  await db.exec('BEGIN');
  try {
    for (const table of TABLES) {
      const rows = snapshot.tables?.[table] || [];
      if (rows.length === 0) continue;
      const columns = Object.keys(rows[0]);
      const placeholders = columns.map(() => '?').join(', ');
      const stmt = db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`);
      for (const row of rows) {
        await stmt.run(...columns.map((c) => row[c]));
      }
    }
    await db.exec('COMMIT');
    console.log(`[backup] 已從 data-snapshot.json(匯出於 ${snapshot.exportedAt})還原 ${snapshot.tables.users?.length || 0} 位玩家的資料。`);
    return { restored: true, exportedAt: snapshot.exportedAt, userCount: snapshot.tables.users?.length || 0 };
  } catch (err) {
    await db.exec('ROLLBACK');
    console.error('[backup] 還原失敗,已復原成空資料庫:', err);
    return { restored: false, reason: 'error', error: String(err) };
  }
}
