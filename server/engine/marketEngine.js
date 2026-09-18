// 雜貨店回收市場(奇幻練功MMO):全服共享單一列狀態(market_state 資料表,固定 id=1)。
// 玩家越常賣同一種東西,該項回收庫存越高、回收價越低;每 5 分鐘銷毀部分庫存並轉換成「供應庫存」
// (見 SUPPLY_ITEMS_CONFIG),回補藥水/強化卷軸/潛能方塊——這些消耗品不是無限貨源,庫存見底就
// 買不到(或變貴),必須靠全服玩家持續回收雜物/材料才能維持補給,不能單靠金幣無限刷。
// 可回收範圍涵蓋 junk(雜物)/material(一般製作素材)/rare_material(稀有素材)/party_material(組隊限定素材)——
// 材料要留著做裝備還是賣錢換現金,由玩家自己決定,不強制材料只能拿去製作。
import db from '../db.js';
import { ITEMS, POTION_ORDER, getPotion, getEnhanceItem } from '../data/itemData.js';

const SELLABLE_KINDS = ['junk', 'material', 'rare_material', 'party_material', 'set_material'];

const DECAY_INTERVAL_MS = 5 * 60 * 1000;
const DECAY_PCT = 0.25; // 每次銷毀目前庫存的 25%
const CONVERSION_RATIO = 0.5; // 每銷毀 2 份雜物 -> 1 份供應庫存點數
const STOCK_PRICE_FLOOR_PCT = 0.25; // 回收價格最低跌到基礎價的 25%
const STOCK_DECAY_THRESHOLD = 50; // 累積庫存達 50 時,價格已跌到底

// 藥水/強化卷軸/潛能方塊的「供應庫存」設定(抉擇方塊不在此列,已改為菁英以上王的隨機掉落,
// 見 monsterData.js 的 CUBE_CHOICE_DROP,不透過商店販售)。baseStock 是伺服器全新啟動時的
// 起始庫存(避免遊戲一開始沒人賣過東西就完全買不到),fullStock 是視為「供應充足」的庫存量,
// 達到後價格觸底。越稀有貴重的道具,基礎庫存與充足門檻都設得越低,補貨自然更吃緊。
const SUPPLY_ITEMS_CONFIG = {
  hp_small: { baseStock: 25, fullStock: 40 },
  hp_medium: { baseStock: 15, fullStock: 25 },
  mp_small: { baseStock: 25, fullStock: 40 },
  mp_medium: { baseStock: 15, fullStock: 25 },
  scroll_weapon: { baseStock: 10, fullStock: 20 },
  scroll_armor: { baseStock: 10, fullStock: 20 },
  scroll_offhand: { baseStock: 10, fullStock: 20 },
  scroll_accessory: { baseStock: 10, fullStock: 20 },
  cube_potential: { baseStock: 5, fullStock: 12 },
};
const ENHANCE_SUPPLY_ORDER = ['scroll_weapon', 'scroll_armor', 'scroll_offhand', 'scroll_accessory', 'cube_potential'];
const SUPPLY_ITEM_ORDER = Object.keys(SUPPLY_ITEMS_CONFIG);
const SUPPLY_PRICE_CEIL_PCT = 2; // 庫存趨近 0(缺貨邊緣)時,價格上看基礎價的 2 倍
const SUPPLY_PRICE_FLOOR_PCT = 0.6; // 庫存達 fullStock(供應充足)時,價格跌到基礎價的 0.6 倍

const getMarketStmt = db.prepare('SELECT data FROM market_state WHERE id = 1');
const putMarketStmt = db.prepare(
  'INSERT INTO market_state (id, data, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at'
);

function defaultSupplyStock() {
  const s = {};
  SUPPLY_ITEM_ORDER.forEach((id) => { s[id] = SUPPLY_ITEMS_CONFIG[id].baseStock; });
  return s;
}

function defaultMarket() {
  return { stock: {}, supplyStock: defaultSupplyStock(), lastDecayAt: Date.now() };
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
      const share = Math.ceil(credits / SUPPLY_ITEM_ORDER.length);
      SUPPLY_ITEM_ORDER.forEach((sid) => {
        market.supplyStock[sid] = (market.supplyStock[sid] || 0) + share;
      });
    }
  });
}

// 讀取市場狀態,並依實際經過時間補算漏掉的銷毀週期(即使伺服器重啟過也能追上進度)。
// 只要補算到任何週期,立即存回資料庫,避免下次讀取時在同一段時間內重複套用衰減。
async function loadMarket() {
  const row = await getMarketStmt.get();
  const market = row ? JSON.parse(row.data) : defaultMarket();
  let dirty = false;
  if (!market.supplyStock) { market.supplyStock = defaultSupplyStock(); dirty = true; } // 舊資料相容
  if (market.bonusPotionStock) { delete market.bonusPotionStock; dirty = true; } // 舊機制欄位不再使用
  const now = Date.now();
  let ticks = Math.floor((now - market.lastDecayAt) / DECAY_INTERVAL_MS);
  if (ticks > 0) {
    ticks = Math.min(ticks, 500); // 避免離線超久時一次跑出天文數字的迴圈次數
    for (let i = 0; i < ticks; i += 1) runDecayTick(market);
    market.lastDecayAt += ticks * DECAY_INTERVAL_MS;
    dirty = true;
  }
  if (dirty || !row) await saveMarket(market);
  return market;
}

function priceForStock(basePrice, stock) {
  return Math.max(1, Math.round(basePrice * Math.max(STOCK_PRICE_FLOOR_PCT, 1 - stock / STOCK_DECAY_THRESHOLD)));
}

// 供應庫存的定價:庫存越低越貴(缺貨邊緣上看基礎價 2 倍),庫存越高越便宜(供應充足最低跌到 0.6 倍)。
function priceForSupply(basePrice, stock, fullStock) {
  const ratio = Math.max(0, Math.min(1, stock / fullStock));
  const pct = SUPPLY_PRICE_CEIL_PCT - ratio * (SUPPLY_PRICE_CEIL_PCT - SUPPLY_PRICE_FLOOR_PCT);
  return Math.max(1, Math.round(basePrice * pct));
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

// 純同步計算(不重新讀資料庫),供已經持有 market 物件的呼叫端直接複用,避免重複 loadMarket()。
function supplyInfo(market, id, basePrice) {
  const cfg = SUPPLY_ITEMS_CONFIG[id];
  const stock = market.supplyStock[id] || 0;
  return { stock, price: priceForSupply(basePrice, stock, cfg.fullStock) };
}

function potionPriceInfoFromMarket(market, potionId) {
  const potion = getPotion(potionId);
  const info = supplyInfo(market, potionId, potion.price);
  return { name: potion.name, kind: potion.kind, healPct: potion.healPct, price: info.price, stock: info.stock };
}

export async function getPotionPriceInfo(potionId) {
  const market = await loadMarket();
  return potionPriceInfoFromMarket(market, potionId);
}

// 購買藥水:庫存不足時回傳 null(呼叫端需檢查並回應「庫存不足」),不足額也不能購買一部分再收費。
export async function buyPotionFromMarket(potionId, qty) {
  const market = await loadMarket();
  const potion = getPotion(potionId);
  const stock = market.supplyStock[potionId] || 0;
  if (stock < qty) return null;
  const price = priceForSupply(potion.price, stock, SUPPLY_ITEMS_CONFIG[potionId].fullStock);
  const totalCost = price * qty;
  market.supplyStock[potionId] = stock - qty;
  await saveMarket(market);
  return totalCost;
}

// 強化卷軸/潛能方塊的價格查詢(同樣走供應庫存機制)。itemId 若不在供應清單內(如已下架的
// 抉擇方塊 cube_potential_choice,現在只能靠打王取得)一律回傳 null。
export async function getEnhanceItemPriceInfo(itemId) {
  const market = await loadMarket();
  const item = getEnhanceItem(itemId);
  if (!item || !SUPPLY_ITEMS_CONFIG[itemId]) return null;
  const info = supplyInfo(market, itemId, item.price);
  return { name: item.name, kind: item.kind, appliesTo: item.appliesTo, price: info.price, stock: info.stock };
}

// 購買強化卷軸/潛能方塊:庫存不足或該道具已不開放商店購買時回傳 null。
export async function buyEnhanceItemFromMarket(itemId, qty) {
  const market = await loadMarket();
  if (!SUPPLY_ITEMS_CONFIG[itemId]) return null;
  const item = getEnhanceItem(itemId);
  const stock = market.supplyStock[itemId] || 0;
  if (stock < qty) return null;
  const price = priceForSupply(item.price, stock, SUPPLY_ITEMS_CONFIG[itemId].fullStock);
  const totalCost = price * qty;
  market.supplyStock[itemId] = stock - qty;
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
  const potions = POTION_ORDER.map((id) => ({ id, ...potionPriceInfoFromMarket(market, id) }));
  const enhanceItems = ENHANCE_SUPPLY_ORDER.map((id) => {
    const item = getEnhanceItem(id);
    const info = supplyInfo(market, id, item.price);
    return { id, name: item.name, kind: item.kind, appliesTo: item.appliesTo, price: info.price, stock: info.stock };
  });
  return { sellables, potions, enhanceItems };
}
