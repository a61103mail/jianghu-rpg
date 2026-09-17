// 存檔急救備份:Render 免費方案沒有永久磁碟,容器休眠喚醒或重新部署時本機 SQLite 檔案會被整個重置
// (見 DEPLOY.md 的說明)。在真正遷移到外部持久化資料庫之前,先用這個機制降低資料遺失風險:
// 1. exportSnapshot() 把所有資料表整份匯出成 JSON,透過受保護的 /api/admin/export 端點取得。
// 2. 把匯出結果存成 server/data-snapshot.json 並 commit 進 git——git 本身是會隨每次部署一起
//    重新拉下來的「持久化」內容,所以只要定期匯出、進版本控制,就能撐過休眠/重新部署。
// 3. importSnapshotIfEmpty() 在伺服器啟動時執行:只有在資料庫「目前完全是空的」(代表這是一個
//    剛啟動的全新容器)且 data-snapshot.json 存在時,才會自動還原,不會覆蓋掉正在使用中的真實資料。
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import db from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = path.join(__dirname, 'data-snapshot.json');

const TABLES = ['users', 'saves', 'market_state', 'auction_listings', 'fallen_loot'];

export function exportSnapshot() {
  const snapshot = { exportedAt: new Date().toISOString(), tables: {} };
  for (const table of TABLES) {
    snapshot.tables[table] = db.prepare(`SELECT * FROM ${table}`).all();
  }
  return snapshot;
}

// 只有在 users 資料表目前完全是空的(=剛啟動的全新容器,還沒有任何人註冊過)才還原,
// 避免不小心把正在使用中、比快照更新的真實資料蓋掉。
export function importSnapshotIfEmpty() {
  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (userCount > 0) {
    console.log('[backup] 資料庫已有資料,略過自動還原。');
    return { restored: false, reason: 'not_empty' };
  }
  if (!fs.existsSync(SNAPSHOT_PATH)) {
    console.log('[backup] 找不到 data-snapshot.json,略過自動還原(全新空資料庫)。');
    return { restored: false, reason: 'no_snapshot' };
  }
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf-8'));
  db.exec('BEGIN');
  try {
    for (const table of TABLES) {
      const rows = snapshot.tables?.[table] || [];
      if (rows.length === 0) continue;
      const columns = Object.keys(rows[0]);
      const placeholders = columns.map(() => '?').join(', ');
      const stmt = db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`);
      for (const row of rows) {
        stmt.run(...columns.map((c) => row[c]));
      }
    }
    db.exec('COMMIT');
    console.log(`[backup] 已從 data-snapshot.json(匯出於 ${snapshot.exportedAt})還原 ${snapshot.tables.users?.length || 0} 位玩家的資料。`);
    return { restored: true, exportedAt: snapshot.exportedAt, userCount: snapshot.tables.users?.length || 0 };
  } catch (err) {
    db.exec('ROLLBACK');
    console.error('[backup] 還原失敗,已復原成空資料庫:', err);
    return { restored: false, reason: 'error', error: String(err) };
  }
}
