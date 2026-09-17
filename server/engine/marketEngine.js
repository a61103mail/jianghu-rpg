// 雜貨店回收市場(奇幻練功MMO):全服共享單一列狀態(market_state 資料表,固定 id=1)。
// 玩家越常賣同一種東西,該項回收庫存越高、回收價越低;每 5 分鐘銷毀部分庫存並轉換成藥水的特惠庫存(半價)。
// 可回收範圍涵蓋 junk(雜物)/material(一般製作素材)/rare_material(稀有素材)/party_material(組隊限定素材)——
// 材料要留著做裝備還是賣錢換現金,由玩家自己決定,不強制材料只能拿去製作。
import db from '../db.js';
import { ITEMS, POTION_ORDER, getPotion } from '../data/itemData.js';

const SELLABLE_KINDS = ['junk', 'material', 'rare_material', 'party_material'];

const DECAY_INTERVAL_MS = 5 * 60 * 1000;
const DECAY_PCT = 0.25; // 每次銷毀目前庫存的 25%
const CONVERSION_RATIO = 0.5; // 每銷毀 2 份雜物 -> 1 份藥水特惠庫存
const DISCOUNT_PCT = 0.5; // 特惠庫存還有時,半價出售藥水
const STOCK_PRICE_FLOOR_PCT = 0.25; // 回收價格最低跌到基礎價的 25%
const STOCK_DECAY_THRESHOLD = 50; // 累積庫存達 50 時,價格已跌到底

const getMarketStmt = db.prepare('SELECT data FROM market_state WHERE id = 1');
const putMarketStmt = db.prepare(
  'INSERT INTO market_state (id, data, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at'
);

function defaultMarket() {
  return { stock: {}, bonusPotionStock: {}, lastDecayAt: Date.now() };
}

async function saveMarket(market) {
  await putMarketStmt.run(JSON.stringify(market), new Date().toISOString());
}

function runDecayTick(market) {
  Object.keys(market.stock).forEach((itemId) => {
    const stock = market.stock[itemId] || 0;
    if (stock <= 0) return;
    const destroyed = Math.ceil(stock * DECAY_PCT);
    market.stock[itemId] = Math.max(0, stock - destroyed);
    const credits = Math.floor(destroyed * CONVERSION_RATIO);
    if (credits > 0) {
      const share = Math.ceil(credits / POTION_ORDER.length);
      POTION_ORDER.forEach((pid) => {
        market.bonusPotionStock[pid] = (market.bonusPotionStock[pid] || 0) + share;
      });
    }
  });
}

// 讀取市場狀態,並依實際經過時間補算漏掉的銷毀週期(即使伺服器重啟過也能追上進度)。
// 只要補算到任何週期,立即存回資料庫,避免下次讀取時在同一段時間內重複套用衰減。
async function loadMarket() {
  const row = await getMarketStmt.get();
  const market = row ? JSON.parse(row.data) : defaultMarket();
  const now = Date.now();
  let ticks = Math.floor((now - market.lastDecayAt) / DECAY_INTERVAL_MS);
  if (ticks > 0) {
    ticks = Math.min(ticks, 500); // 避免離線超久時一次跑出天文數字的迴圈次數
    for (let i = 0; i < ticks; i += 1) runDecayTick(market);
    market.lastDecayAt += ticks * DECAY_INTERVAL_MS;
    await saveMarket(market);
  } else if (!row) {
    await saveMarket(market);
  }
  return market;
}

function priceForStock(basePrice, stock) {
  return Math.max(1, Math.round(basePrice * Math.max(STOCK_PRICE_FLOOR_PCT, 1 - stock / STOCK_DECAY_THRESHOLD)));
}

export async function getRecyclePrice(itemId) {
  const market = await loadMarket();
  const item = ITEMS[itemId];
  if (!item || !SELLABLE_KINDS.includes(item.kind)) return 0;
  return priceForStock(item.basePrice, market.stock[itemId] || 0);
}

// 出售雜物/材料/稀有材料給雜貨店,回傳實際獲得的金幣(以出售當下的價格計算整批,而非賣一件跌一次價)
export async function sellItemToMarket(itemId, qty) {
  const market = await loadMarket();
  const item = ITEMS[itemId];
  const unitPrice = priceForStock(item.basePrice, market.stock[itemId] || 0);
  market.stock[itemId] = (market.stock[itemId] || 0) + qty;
  await saveMarket(market);
  return unitPrice * qty;
}

export async function getPotionPriceInfo(potionId) {
  const market = await loadMarket();
  const potion = getPotion(potionId);
  const bonus = market.bonusPotionStock[potionId] || 0;
  return {
    fullPrice: potion.price,
    effectivePrice: bonus > 0 ? Math.ceil(potion.price * (1 - DISCOUNT_PCT)) : potion.price,
    discounted: bonus > 0,
    bonusStock: bonus,
  };
}

// 購買藥水,優先消耗特惠庫存(半價),超出特惠庫存的部分以原價計算,回傳總花費金幣
export async function buyPotionFromMarket(potionId, qty) {
  const market = await loadMarket();
  const potion = getPotion(potionId);
  const bonus = market.bonusPotionStock[potionId] || 0;
  const discountedQty = Math.min(bonus, qty);
  const fullQty = qty - discountedQty;
  const discountedUnit = Math.ceil(potion.price * (1 - DISCOUNT_PCT));
  const totalCost = discountedQty * discountedUnit + fullQty * potion.price;
  market.bonusPotionStock[potionId] = bonus - discountedQty;
  await saveMarket(market);
  return totalCost;
}

export async function getMarketSnapshot() {
  const market = await loadMarket();
  const sellables = Object.entries(ITEMS)
    .filter(([, item]) => SELLABLE_KINDS.includes(item.kind))
    .map(([id, item]) => ({
      id,
      name: item.name,
      kind: item.kind,
      basePrice: item.basePrice,
      stock: market.stock[id] || 0,
      currentPrice: priceForStock(item.basePrice, market.stock[id] || 0),
    }));
  const potions = POTION_ORDER.map((id) => ({ id, ...getPotionPriceInfo(id) }));
  return { sellables, potions };
}
