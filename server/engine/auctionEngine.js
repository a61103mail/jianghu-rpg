// 玩家交易所引擎:持久化上架列表(auction_listings 資料表),供玩家互相上架/購買裝備或素材。
// 上架收取小額手續費(向賣家收取,已於呼叫端 game.js 扣除金幣後才呼叫 listItem),上架有效期限一到自動下架。
import db from '../db.js';

export const LISTING_FEE_PCT = 0.05; // 上架手續費:開價的 5%(最低 1 金幣),於路由層向賣家收取
export const LISTING_DURATION_HOURS = 24;

const insertListingStmt = db.prepare(
  'INSERT INTO auction_listings (seller_id, seller_name, item_json, price, listed_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)'
);
const deleteExpiredStmt = db.prepare('DELETE FROM auction_listings WHERE expires_at < ?');
const selectAllStmt = db.prepare('SELECT * FROM auction_listings ORDER BY listed_at DESC');
const selectByIdStmt = db.prepare('SELECT * FROM auction_listings WHERE id = ?');
const deleteByIdStmt = db.prepare('DELETE FROM auction_listings WHERE id = ?');

function removeExpired() {
  return deleteExpiredStmt.run(new Date().toISOString());
}

export async function listItem(sellerId, sellerName, item, price) {
  const now = new Date();
  const expires = new Date(now.getTime() + LISTING_DURATION_HOURS * 3600 * 1000);
  await insertListingStmt.run(sellerId, sellerName, JSON.stringify(item), price, now.toISOString(), expires.toISOString());
}

export async function getListings() {
  await removeExpired();
  const rows = await selectAllStmt.all();
  return rows.map((row) => ({
    id: row.id,
    sellerId: row.seller_id,
    sellerName: row.seller_name,
    item: JSON.parse(row.item_json),
    price: row.price,
    listedAt: row.listed_at,
    expiresAt: row.expires_at,
  }));
}

export async function getListingById(id) {
  await removeExpired();
  const row = await selectByIdStmt.get(id);
  if (!row) return null;
  return {
    id: row.id,
    sellerId: row.seller_id,
    sellerName: row.seller_name,
    item: JSON.parse(row.item_json),
    price: row.price,
    listedAt: row.listed_at,
    expiresAt: row.expires_at,
  };
}

export async function removeListing(id) {
  await deleteByIdStmt.run(id);
}
