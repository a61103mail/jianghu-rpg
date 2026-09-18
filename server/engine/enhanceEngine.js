// 裝備強化引擎(奇幻練功MMO):對應「卷軸」與「方塊」兩套機制。
// 卷軸(強化):每件裝備最多使用 5 次,每次「全部現有屬性」一起 ±3(百分比類屬性以百分點為單位,
// 即 +3 代表 +3 個百分點=+0.03),正負各半機率,不是穩定往上疊的「保證進步」系統,而是真正有賭注——
// 用得好可以到 +15,運氣差也可能弄到 -15,不再區分「只強化攻擊力」,裝備上不管哪個屬性都會一起變動。
// 方塊(潛能):洗出 1~3 條隨機百分比詞條,分稀有/史詩/傳說三階,使用時有機率讓潛能整體升階。

export const ENHANCE_MAX_USES = 5;
const ENHANCE_DELTA = 3; // 每次強化的變動量:整數類屬性(atk/def/hp等)為±3點,百分比類屬性(帶Pct後綴)為±3個百分點(±0.03)

// 舊版相容:先前 UI/呼叫端可能還引用 ENHANCE_MAX_LEVEL 這個名稱,維持匯出但語意改為「最大使用次數」
export const ENHANCE_MAX_LEVEL = ENHANCE_MAX_USES;

// 卷軸的 appliesTo 是 weapon/armor/accessory,飾品涵蓋 accessory1/accessory2 兩個部位,副手另計
function slotCategory(slot) {
  if (slot === 'weapon') return 'weapon';
  if (slot === 'armor') return 'armor';
  if (slot === 'offhand') return 'offhand';
  return 'accessory';
}

// 對裝備套用一次強化卷軸:每個現有的 item.stats 欄位各自獨立擲一次正負號,50/50 機率,
// 幅度固定 ±3(百分比類屬性則是 ±3 個百分點)。回傳 { success, item, deltas, usesLeft }。
// success 這裡代表「整體是加強(正)還是削弱(負)」,由本次擲出的正負號決定,同一次強化裡
// 所有屬性一律同號(不會出現「攻擊力變強但防禦力變弱」這種同一次操作卻互相矛盾的結果)。
export function rollEnhance(item) {
  const uses = item.enhanceUses || 0;
  if (uses >= ENHANCE_MAX_USES) return { success: false, item, maxed: true, usesLeft: 0 };

  const positive = Math.random() < 0.5;
  const sign = positive ? 1 : -1;
  item.stats = item.stats || {};
  const deltas = {};
  Object.keys(item.stats).forEach((key) => {
    const isPct = key.toLowerCase().includes('pct');
    const delta = isPct ? sign * (ENHANCE_DELTA / 100) : sign * ENHANCE_DELTA;
    // 下限保護:避免多次負向強化把數值弄到深度負值造成後續戰鬥公式異常(如負攻擊力算出負傷害),
    // 百分比類最低壓在 0,整數類最低壓在 1——「很爛」但不會整個壞掉,呼應「這是賭注不是懲罰到報廢」。
    const floor = isPct ? 0 : 1;
    const newValue = Math.max(floor, item.stats[key] + delta);
    deltas[key] = Math.round((newValue - item.stats[key]) * 1000) / 1000;
    item.stats[key] = Math.round(newValue * 1000) / 1000;
  });
  item.enhanceUses = uses + 1;
  // enhanceLevel 保留作為「目前淨強化點數」的顯示用途(可能是負數,例如 -6),UI 上顯示 +N 或 -N
  item.enhanceLevel = (item.enhanceLevel || 0) + sign * ENHANCE_DELTA;
  return { success: positive, item, deltas, usesLeft: ENHANCE_MAX_USES - item.enhanceUses };
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

export function getEnhanceItemAppliesToSlot(appliesTo, slot) {
  if (appliesTo === 'any') return true;
  return appliesTo === slotCategory(slot);
}
