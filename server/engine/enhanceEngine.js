// 裝備強化引擎(奇幻練功MMO):對應「卷軸」與「方塊」兩套機制。
// 卷軸(強化):每件裝備最多使用 5 次,每次從 -3~+3(共7個整數,均勻分布、機率平均,不是只有
// +3/-3兩個極端值)隨機抽一個變動量,同時套用到裝備「全部現有屬性」(百分比類屬性以百分點為單位,
// 即抽到 +3 代表該次+3個百分點=+0.03)。運氣好可以5次都抽到+3、一路衝到+15,運氣差也可能一路
// 摸到-15,中間值(-2,-1,0,1,2)出現機率均等——真正的賭注,不是穩定往上疊的「保證進步」系統。
// 王家卷軸(scroll_*_royal,只有真王掉落):範圍改為 -1~+5,期望值更高、下跌風險小很多,
// 呼應「菁英只掉簡單卷軸,真王才掉更強的卷軸」。
// 方塊(潛能):洗出 1~3 條隨機百分比詞條,分稀有/史詩/傳說三階,使用時有機率讓潛能整體升階。

export const ENHANCE_MAX_USES = 5;
const ENHANCE_DELTA_MAX = 3; // 一般卷軸:每次強化變動量的絕對值上限,實際變動量是 [-3, +3] 均勻分布隨機整數(含0)
const ROYAL_DELTA_MIN = -1; // 王家卷軸(只有真王掉落):變動量下限,最壞情況只小幅倒退
const ROYAL_DELTA_MAX = 5; // 王家卷軸:變動量上限,比一般卷軸的+3更高

// 舊版相容:先前 UI/呼叫端可能還引用 ENHANCE_MAX_LEVEL 這個名稱,維持匯出但語意改為「最大使用次數」
export const ENHANCE_MAX_LEVEL = ENHANCE_MAX_USES;

// 卷軸的 appliesTo 是 weapon/armor/accessory,飾品涵蓋 accessory1/accessory2 兩個部位,副手另計
function slotCategory(slot) {
  if (slot === 'weapon') return 'weapon';
  if (slot === 'armor') return 'armor';
  if (slot === 'offhand') return 'offhand';
  return 'accessory';
}

// 對裝備套用一次強化卷軸:一般卷軸從 -3~+3(共7個整數)均勻隨機抽一個變動量(每個值機率相同,約1/7);
// 王家卷軸(isRoyal=true)則是 -1~+5(同樣7個整數,但範圍整體偏正,期望值更高、下跌風險更小)。
// 套用到裝備「全部現有屬性」。整數類屬性(atk/def/hp等)與百分比類屬性(帶Pct後綴,以「百分點」
// 為單位存放,例如 critRatePct=2.8 代表 2.8%)一律直接套用同一個 delta,不需要額外除以100轉換——
// item.stats 裡的 pct 欄位本來就是以百分點為單位儲存(呼應 characterEngine.js 彙總時才 /100 轉小數)。
// 回傳 { success, delta, item, deltas, usesLeft }。success 代表這次「整體是不是變強了」
// (delta > 0 才算成功;delta = 0 代表這次沒有任何效果,delta < 0 代表變弱了)。
export function rollEnhance(item, isRoyal = false) {
  const uses = item.enhanceUses || 0;
  if (uses >= ENHANCE_MAX_USES) return { success: false, item, maxed: true, usesLeft: 0 };

  // 一般卷軸:-3~+3 共 7 個整數,Math.floor(Math.random()*7) 落在 0~6,減 3 平移成 -3~+3。
  // 王家卷軸:-1~+5 共 7 個整數,同樣的骰法平移成 -1~+5,每個值機率均等(各1/7)。
  const delta = isRoyal
    ? Math.floor(Math.random() * (ROYAL_DELTA_MAX - ROYAL_DELTA_MIN + 1)) + ROYAL_DELTA_MIN
    : Math.floor(Math.random() * (ENHANCE_DELTA_MAX * 2 + 1)) - ENHANCE_DELTA_MAX;
  item.stats = item.stats || {};
  const deltas = {};
  Object.keys(item.stats).forEach((key) => {
    const isPct = key.toLowerCase().includes('pct');
    // 下限保護:避免多次負向強化把數值弄到深度負值造成後續戰鬥公式異常(如負攻擊力算出負傷害),
    // 百分比類最低壓在 0,整數類最低壓在 1——「很爛」但不會整個壞掉,呼應「這是賭注不是懲罰到報廢」。
    const floor = isPct ? 0 : 1;
    const newValue = Math.max(floor, item.stats[key] + delta);
    deltas[key] = Math.round((newValue - item.stats[key]) * 1000) / 1000;
    item.stats[key] = Math.round(newValue * 1000) / 1000;
  });
  item.enhanceUses = uses + 1;
  // enhanceLevel 保留作為「目前淨強化點數」的顯示用途(可能是負數,例如 -6),UI 上顯示 +N 或 -N
  item.enhanceLevel = (item.enhanceLevel || 0) + delta;
  return { success: delta > 0, delta, item, deltas, usesLeft: ENHANCE_MAX_USES - item.enhanceUses };
}

export function getEnhanceSuccessRate() {
  return 0.5; // 固定 50/50,不再隨等級遞減(新系統本身就是有賭注的±3,不需要额外的成功率曲線)
}

// 潛能:三階(稀有/史詩/傳說),每階可洗出的詞條數與數值範圍不同
export const POTENTIAL_TIERS = ['rare', 'epic', 'legendary'];
export const POTENTIAL_TIER_NAME_ZH = { rare: '稀有', epic: '史詩', legendary: '傳說' };
const POTENTIAL_LINE_COUNT = { rare: 1, epic: 2, legendary: 3 };
// 攻擊強度(atkPowerPct)統一套用到該職業實際使用的攻擊屬性(見 characterEngine.js computeStats)——
// 不分「物理攻擊力%」「魔法攻擊力%」兩條獨立詞條,因為每個職業永遠只用其中一種攻擊屬性,
// 分開設計等於讓玩家有一半機率洗到對自己完全沒用的死詞條,合併後每次洗鍊結果都有意義。
const POTENTIAL_LINE_POOL = {
  rare: [
    { key: 'atkPowerPct', label: '攻擊強度', min: 0.01, max: 0.03 },
    { key: 'defPct', label: '防禦力', min: 0.02, max: 0.05 },
    { key: 'hpPct', label: '氣血上限', min: 0.02, max: 0.05 },
    { key: 'critRatePct', label: '會心率', min: 0.01, max: 0.02 },
  ],
  epic: [
    { key: 'atkPowerPct', label: '攻擊強度', min: 0.02, max: 0.05 },
    { key: 'defPct', label: '防禦力', min: 0.04, max: 0.08 },
    { key: 'hpPct', label: '氣血上限', min: 0.04, max: 0.08 },
    { key: 'critRatePct', label: '會心率', min: 0.02, max: 0.04 },
  ],
  legendary: [
    { key: 'atkPowerPct', label: '攻擊強度', min: 0.04, max: 0.08 },
    { key: 'defPct', label: '防禦力', min: 0.07, max: 0.13 },
    { key: 'hpPct', label: '氣血上限', min: 0.07, max: 0.13 },
    { key: 'critRatePct', label: '會心率', min: 0.03, max: 0.06 },
  ],
};
const TIER_UPGRADE_CHANCE = 0.12; // 每次用方塊,已有潛能時有 12% 機率直接升階(稀有→史詩→傳說)

function rollLinesForTier(tier) {
  const pool = POTENTIAL_LINE_POOL[tier];
  const count = POTENTIAL_LINE_COUNT[tier];
  const picked = [];
  const usedKeys = new Set();
  while (picked.length < count && usedKeys.size < pool.length) {
    const candidate = pool[Math.floor(Math.random() * pool.length)];
    if (usedKeys.has(candidate.key)) continue;
    usedKeys.add(candidate.key);
    const value = Math.round((candidate.min + Math.random() * (candidate.max - candidate.min)) * 1000) / 1000;
    picked.push({ key: candidate.key, label: candidate.label, value });
  }
  return picked;
}

// 對裝備套用一次潛能方塊:沒有潛能就從稀有開始,已有潛能則洗詞條、並有機率升階。回傳 { item, upgraded }。
export function rollCube(item) {
  if (!item.potential) {
    item.potential = { tier: 'rare', lines: rollLinesForTier('rare') };
    return { item, upgraded: false };
  }
  let tier = item.potential.tier;
  let upgraded = false;
  const tierIdx = POTENTIAL_TIERS.indexOf(tier);
  if (tierIdx < POTENTIAL_TIERS.length - 1 && Math.random() < TIER_UPGRADE_CHANCE) {
    tier = POTENTIAL_TIERS[tierIdx + 1];
    upgraded = true;
  }
  item.potential = { tier, lines: rollLinesForTier(tier) };
  return { item, upgraded };
}

// 抉擇方塊(cube_potential_choice):比一般方塊更貴,固定直接洗出「傳說階」數值範圍的3條詞條
// (不像一般方塊要先升階到legendary才有3條),且採「先預覽再選擇」流程——玩家看過這次洗出的
// 3條新詞條後,自己決定要套用新的還是保留原本的潛能,不滿意可以直接放棄不套用。
// 用記憶體暫存每位玩家「最近一次抉擇方塊預覽的結果」,避免前端能竄改要套用的數值
// (套用/取消時一律讀伺服器暫存的結果,不接受前端直接傳入的詞條內容)。
const pendingChoicePreviews = new Map(); // userId -> { itemId, preview: { tier, lines } }

export function rollCubeChoicePreview(userId, itemId) {
  const preview = { tier: 'legendary', lines: rollLinesForTier('legendary') };
  pendingChoicePreviews.set(userId, { itemId, preview });
  return preview;
}

export function getPendingChoicePreview(userId, itemId) {
  const pending = pendingChoicePreviews.get(userId);
  if (!pending || pending.itemId !== itemId) return null;
  return pending.preview;
}

export function clearChoicePreview(userId) {
  pendingChoicePreviews.delete(userId);
}

export function getEnhanceItemAppliesToSlot(appliesTo, slot) {
  if (appliesTo === 'any') return true;
  return appliesTo === slotCategory(slot);
}
