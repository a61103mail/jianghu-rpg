// 裝備強化引擎(奇幻練功MMO):對應「卷軸」與「方塊」兩套機制。
// 卷軸(強化):+0~+10,每次成功機率隨等級遞減,失敗只損失卷軸本身、不會摧毀裝備(維持公平,不搞爆裝備那一套)。
// 方塊(潛能):洗出 1~3 條隨機百分比詞條,分稀有/史詩/傳說三階,使用時有機率讓潛能整體升階。

export const ENHANCE_MAX_LEVEL = 10;

// 每一次強化嘗試(從目前等級升到下一級)的成功機率,索引 0 代表 +0→+1
const ENHANCE_SUCCESS_RATE = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.25, 0.2, 0.15];

// 每次強化成功,依部位增加的固定數值(飾品依裝備本身現有的屬性決定要加會心還是氣血)
const ENHANCE_GAIN = {
  weapon: { atk: 3, matk: 3 },
  armor: { def: 2, hp: 6 },
  accessory: { critRatePct: 0.4, hp: 5 },
};

export function getEnhanceSuccessRate(currentLevel) {
  if (currentLevel >= ENHANCE_MAX_LEVEL) return 0;
  return ENHANCE_SUCCESS_RATE[currentLevel];
}

// 卷軸的 appliesTo 是 weapon/armor/accessory,飾品涵蓋 accessory1/accessory2 兩個部位
function slotCategory(slot) {
  if (slot === 'weapon') return 'weapon';
  if (slot === 'armor') return 'armor';
  return 'accessory';
}

// 對裝備套用一次強化卷軸,回傳 { success, item, rate }。裝備物件會被直接修改(呼叫端記得存檔)。
export function rollEnhance(item) {
  const level = item.enhanceLevel || 0;
  const rate = getEnhanceSuccessRate(level);
  if (rate <= 0) return { success: false, item, rate, maxed: true };
  const success = Math.random() < rate;
  if (!success) return { success: false, item, rate };

  const category = slotCategory(item.slot);
  const gainTable = ENHANCE_GAIN[category];
  item.stats = item.stats || {};
  if (category === 'weapon') {
    const key = item.stats.matk !== undefined ? 'matk' : 'atk';
    item.stats[key] = (item.stats[key] || 0) + gainTable[key];
  } else if (category === 'armor') {
    item.stats.def = (item.stats.def || 0) + gainTable.def;
    item.stats.hp = (item.stats.hp || 0) + gainTable.hp;
  } else {
    const key = item.stats.critRatePct !== undefined ? 'critRatePct' : 'hp';
    item.stats[key] = Math.round(((item.stats[key] || 0) + gainTable[key]) * 10) / 10;
  }
  item.enhanceLevel = level + 1;
  return { success: true, item, rate };
}

// 潛能:三階(稀有/史詩/傳說),每階可洗出的詞條數與數值範圍不同
export const POTENTIAL_TIERS = ['rare', 'epic', 'legendary'];
export const POTENTIAL_TIER_NAME_ZH = { rare: '稀有', epic: '史詩', legendary: '傳說' };
const POTENTIAL_LINE_COUNT = { rare: 1, epic: 2, legendary: 3 };
const POTENTIAL_LINE_POOL = {
  rare: [
    { key: 'atkPct', label: '攻擊力', min: 0.01, max: 0.03 },
    { key: 'matkPct', label: '魔法攻擊力', min: 0.01, max: 0.03 },
    { key: 'defPct', label: '防禦力', min: 0.02, max: 0.05 },
    { key: 'hpPct', label: '氣血上限', min: 0.02, max: 0.05 },
    { key: 'critRatePct', label: '會心率', min: 0.01, max: 0.02 },
  ],
  epic: [
    { key: 'atkPct', label: '攻擊力', min: 0.02, max: 0.05 },
    { key: 'matkPct', label: '魔法攻擊力', min: 0.02, max: 0.05 },
    { key: 'defPct', label: '防禦力', min: 0.04, max: 0.08 },
    { key: 'hpPct', label: '氣血上限', min: 0.04, max: 0.08 },
    { key: 'critRatePct', label: '會心率', min: 0.02, max: 0.04 },
  ],
  legendary: [
    { key: 'atkPct', label: '攻擊力', min: 0.04, max: 0.08 },
    { key: 'matkPct', label: '魔法攻擊力', min: 0.04, max: 0.08 },
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
