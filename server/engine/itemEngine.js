// 裝備生成引擎:普通裝備(monster drop)vs稀有裝備(shop craft only),兩軌互不重疊。
import { GEAR_SLOTS, WEAPON_TYPE_BY_CLASS, ARMOR_NAMES, ACCESSORY_NAMES } from '../data/itemData.js';

let counter = 1;
function nextId() {
  return `eq_${Date.now()}_${counter++}`;
}

const SHOP_TO_CLASS = { blacksmith: 'warrior', leather: 'archer', magic: 'mage', church: 'priest' };

// 裝備素質浮動:同一件裝備每次生成的實際數值不會完全一樣,基準值上下浮動一個比例區間
// (用比例而非固定±5,因為裝備數值橫跨低階~高階很大範圍,比例浮動在哪一階都感覺得到差異)。
// 回傳 { value, quality }:quality 是這次浮動落在區間內的位置(0=最低卷、1=最高卷),
// 供前端依品質區間上色顯示,讓玩家一眼看出這件是「爛裝」還是「極品」。
const STAT_VARIANCE_PCT = 0.2; // 上下浮動 20%
function rollStatWithVariance(base) {
  const roll = Math.random();
  const min = base * (1 - STAT_VARIANCE_PCT);
  const max = base * (1 + STAT_VARIANCE_PCT);
  const value = Math.max(1, Math.round(min + roll * (max - min)));
  return { value, quality: roll };
}
// critRatePct 這類數值需要保留小數點(如 2.8),先放大10倍取整數浮動、再還原精度,避免捨入誤差
function rollDecimalStatWithVariance(base) {
  const r = rollStatWithVariance(base * 10);
  return { value: Math.round(r.value) / 10, quality: r.quality };
}
// 一件裝備可能同時有多個數值(例如防具同時有def+hp),把各自的quality平均成一個整體品質代表這件裝備
function averageQuality(rolls) {
  if (rolls.length === 0) return 0.5;
  return rolls.reduce((sum, r) => sum + r.quality, 0) / rolls.length;
}

function commonWeaponStat(level, atkKey) {
  const r = rollStatWithVariance(3 + level * 1.1);
  return { stats: { [atkKey]: r.value }, quality: r.quality };
}
function commonArmorStat(level) {
  const defRoll = rollStatWithVariance(2 + level * 0.8);
  const hpRoll = rollStatWithVariance(8 + level * 2.5);
  return { stats: { def: defRoll.value, hp: hpRoll.value }, quality: averageQuality([defRoll, hpRoll]) };
}
function commonAccessoryStat(level) {
  if (Math.random() < 0.5) {
    const r = rollDecimalStatWithVariance(0.5 + level * 0.15);
    return { stats: { critRatePct: r.value }, quality: r.quality };
  }
  const r = rollStatWithVariance(5 + level * 1.5);
  return { stats: { hp: r.value }, quality: r.quality };
}

// 普通裝備:打怪掉落時依怪物等級隨機生成(武器會限定職業類型,防具/飾品任何職業皆可用)。
// 飾品掉落時只標記為通用的「accessory」,不預先綁定飾品一/飾品二——
// 曾經用隨機直接指定 accessory1/accessory2,結果玩家可能連續好幾次都抽到同一格,
// 導致另一格「看起來」永遠裝不上東西(其實只是運氣差,飾品一直接沒抽到而已)。
// 現在改成裝備當下由玩家自己選要放哪一格,兩格才會真正平等好用。
export function generateCommonGear(monsterLevel) {
  const roll = Math.random();
  const slot = roll < 0.25 ? 'weapon' : roll < 0.5 ? 'armor' : 'accessory';
  let name;
  let result;
  let classType = null;
  if (slot === 'weapon') {
    const classKeys = Object.keys(WEAPON_TYPE_BY_CLASS);
    const cls = classKeys[Math.floor(Math.random() * classKeys.length)];
    const info = WEAPON_TYPE_BY_CLASS[cls];
    classType = cls;
    name = info.names[Math.floor(Math.random() * info.names.length)];
    result = commonWeaponStat(monsterLevel, info.atkKey);
  } else if (slot === 'armor') {
    name = ARMOR_NAMES[Math.floor(Math.random() * ARMOR_NAMES.length)];
    result = commonArmorStat(monsterLevel);
  } else {
    name = ACCESSORY_NAMES[Math.floor(Math.random() * ACCESSORY_NAMES.length)];
    result = commonAccessoryStat(monsterLevel);
  }
  return { id: nextId(), slot, name, tier: 'common', classType, itemLevel: monsterLevel, stats: result.stats, rollQuality: result.quality, enhanceLevel: 0, potential: null };
}

// 稀有裝備:僅能透過商店配方製作,固定對應該商店的職業(見 RARE_RECIPES / SHOP_TO_CLASS)
// tier 取自配方本身(common/rare/epic),itemLevel 僅作展示用參考數字(不設等級門檻,三階都統一用同一套基準對照)
// 配方裡的 statBonus 是「基準值」,實際打造出來的數值一樣會套用浮動,同一張配方每次做出來品質可能不同。
const TIER_DISPLAY_LEVEL = { common: 8, rare: 16, epic: 26 };
export function craftRareItem(shopId, recipe) {
  const rolls = [];
  const stats = {};
  Object.entries(recipe.statBonus).forEach(([key, base]) => {
    const r = key === 'critRatePct' ? rollDecimalStatWithVariance(base) : rollStatWithVariance(base);
    stats[key] = r.value;
    rolls.push(r);
  });
  return {
    id: nextId(),
    slot: recipe.slot,
    name: recipe.name,
    tier: recipe.tier,
    classType: SHOP_TO_CLASS[shopId] || null,
    itemLevel: TIER_DISPLAY_LEVEL[recipe.tier] || 20,
    stats,
    rollQuality: averageQuality(rolls),
    enhanceLevel: 0, // 強化等級(0~10),見 enhanceEngine.js
    potential: null, // 潛能(方塊洗出的隨機百分比詞條),初始為空,見 enhanceEngine.js
  };
}

// 裝備對角色的屬性加成(此版本裝備資料直接就是最終數值,不像先前武俠版本有潛力/淬煉/打造疊加)
export function getItemTotalStats(item) {
  return item.stats || {};
}

// 是否可裝備:武器一律看 classType;防具/飾品的普通掉落 classType 為 null(任何職業皆可用),
// 但稀有製作品皆鎖定對應職業(呼應「透過商店製作」代表玩家特意為該職業打造)。
export function canEquip(save, item) {
  if (!item.classType) return true;
  return item.classType === save.classId;
}
