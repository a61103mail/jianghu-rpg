// REST API 客戶端:封裝 fetch,自動附加 JWT token
// 用相對路徑而非寫死 localhost,這樣不管是本機開發(Vite proxy)還是正式環境(後端直接提供前端檔案、
// 或透過 Cloudflare Tunnel 對外分享)都會自動打到目前頁面所在的同一個網域,不用另外改設定。
const BASE = '/api';

function getToken() {
  return localStorage.getItem('jh_token');
}

async function request(path, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `請求失敗 (${res.status})`);
  return data;
}

export const api = {
  register: (username, password) => request('/auth/register', { method: 'POST', body: JSON.stringify({ username, password }) }),
  login: (username, password) => request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  getClasses: () => request('/game/classes'),
  getState: () => request('/game/state'),
  chooseClass: (classId) => request('/game/choose-class', { method: 'POST', body: JSON.stringify({ classId }) }),
  allocateStats: (deltas) => request('/game/stats/allocate', { method: 'POST', body: JSON.stringify(deltas) }),
  rest: (goldToSpend) => request('/game/town/rest', { method: 'POST', body: JSON.stringify(goldToSpend !== undefined ? { goldToSpend } : {}) }),
  usePotion: (potionId) => request('/game/consumable/use-potion', { method: 'POST', body: JSON.stringify({ potionId }) }),
  huntStart: (mapId) => request('/game/hunt/start', { method: 'POST', body: JSON.stringify({ mapId }) }),
  challengeTrueBoss: (mapId) => request('/game/trueboss/challenge', { method: 'POST', body: JSON.stringify({ mapId }) }),
  huntContinue: () => request('/game/hunt/continue', { method: 'POST' }),
  huntRetreat: () => request('/game/hunt/retreat', { method: 'POST' }),
  lootChoice: (itemIndex) => request('/game/hunt/loot-choice', { method: 'POST', body: JSON.stringify({ itemIndex }) }),
  combatAction: (action, extra = {}) => request('/game/combat/action', { method: 'POST', body: JSON.stringify({ action, ...extra }) }),
  equip: (itemId, targetSlot) => request('/game/equipment/equip', { method: 'POST', body: JSON.stringify({ itemId, targetSlot }) }),
  unequip: (slot) => request('/game/equipment/unequip', { method: 'POST', body: JSON.stringify({ slot }) }),
  getShop: (shopId) => request(`/game/shop/${shopId}`),
  sellJunk: (itemId, qty) => request('/game/shop/sell', { method: 'POST', body: JSON.stringify({ itemId, qty }) }),
  sellGear: (inventoryItemId) => request('/game/shop/sell', { method: 'POST', body: JSON.stringify({ inventoryItemId }) }),
  buyPotion: (potionId, qty) => request('/game/shop/buy-potion', { method: 'POST', body: JSON.stringify({ potionId, qty }) }),
  buyEnhanceItem: (itemId, qty) => request('/game/shop/buy-enhance-item', { method: 'POST', body: JSON.stringify({ itemId, qty }) }),
  enhanceItem: (itemId, scrollId) => request('/game/equipment/enhance', { method: 'POST', body: JSON.stringify({ itemId, scrollId }) }),
  cubeItem: (itemId, cubeId) => request('/game/equipment/cube', { method: 'POST', body: JSON.stringify({ itemId, cubeId }) }),
  craft: (shopId, recipeId) => request('/game/shop/craft', { method: 'POST', body: JSON.stringify({ shopId, recipeId }) }),
  getListings: () => request('/game/auction/listings'),
  listItem: (itemId, price) => request('/game/auction/list', { method: 'POST', body: JSON.stringify({ itemId, price }) }),
  buyListing: (listingId) => request('/game/auction/buy', { method: 'POST', body: JSON.stringify({ listingId }) }),
  cancelListing: (listingId) => request('/game/auction/cancel', { method: 'POST', body: JSON.stringify({ listingId }) }),
};

export function setToken(token) {
  localStorage.setItem('jh_token', token);
}
export function clearToken() {
  localStorage.removeItem('jh_token');
}
export { getToken };

// 從 JWT payload 還原帳號名稱(頁面重新整理後 token 仍在 localStorage,但記憶體中的 S.username 會遺失,
// 需要這個輔助函式重新取得,才能正確顯示頂部使用者名稱、判斷交易所「是否為自己上架」)
function base64UrlDecode(str) {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}
export function getUsernameFromToken() {
  const token = getToken();
  if (!token) return null;
  try {
    return JSON.parse(base64UrlDecode(token.split('.')[1])).username;
  } catch {
    return null;
  }
}
