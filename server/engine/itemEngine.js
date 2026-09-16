// 裝備生成引擎:普通裝備(monster drop)vs稀有裝備(shop craft only),兩軌互不重疊。
import { GEAR_SLOTS, WEAPON_TYPE_BY_CLASS, ARMOR_NAMES, ACCESSORY_NAMES } from '../data/itemData.js';

let counter = 1;
function nextId() {
  return `eq_${Date.now()}_${counter++}`;
}

const SHOP_TO_CLASS = { blacksmith: 'warrior', leather: 'archer', magic: 'mage', church: 'priest' };

function commonWeaponStat(level, atkKey) {
  return { [atkKey]: Math.round(3 + level * 1.1) };
}
function commonArmorStat(level) {
  return { def: Math.round(2 + level * 0.8), hp: Math.round(8 + level * 2.5) };
}
function commonAccessoryStat(level) {
  if (Math.random() < 0.5) return { critRatePct: Math.round((0.5 + level * 0.15) * 10) / 10 };
  return { hp: Math.round(5 + level * 1.5) };
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
  let stats;
  let classType = null;
  if (slot === 'weapon') {
    const classKeys = Object.keys(WEAPON_TYPE_BY_CLASS);
    const cls = classKeys[Math.floor(Math.random() * classKeys.length)];
    const info = WEAPON_TYPE_BY_CLASS[cls];
    classType = cls;
    name = info.names[Math.floor(Math.random() * info.names.length)];
    stats = commonWeaponStat(monsterLevel, info.atkKey);
  } else if (slot === 'armor') {
    name = ARMOR_NAMES[Math.floor(Math.random() * ARMOR_NAMES.length)];
    stats = commonArmorStat(monsterLevel);
  } else {
    name = ACCESSORY_NAMES[Math.floor(Math.random() * ACCESSORY_NAMES.length)];
    stats = commonAccessoryStat(monsterLevel);
  }
  return { id: nextId(), slot, name, tier: 'common', classType, itemLevel: monsterLevel, stats, enhanceLevel: 0, potential: null };
}

// 稀有裝備:僅能透過商店配方製作,固定對應該商店的職業(見 RARE_RECIPES / SHOP_TO_CLASS)
// tier 取自配方本身(common/rare/epic),itemLevel 僅作展示用參考數字(不設等級門檻,三階都統一用同一套基準對照)
const TIER_DISPLAY_LEVEL = { common: 8, rare: 16, epic: 26 };
export function craftRareItem(shopId, recipe) {
  return {
    id: nextId(),
    slot: recipe.slot,
    name: recipe.name,
    tier: recipe.tier,
    classType: SHOP_TO_CLASS[shopId] || null,
    itemLevel: TIER_DISPLAY_LEVEL[recipe.tier] || 20,
    stats: { ...recipe.statBonus },
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
