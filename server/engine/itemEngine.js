// 裝備生成引擎:普通裝備(monster drop)vs稀有裝備(shop craft only)vs套裝裝備(elite/trueboss drop),三軌互不重疊。
import { GEAR_SLOTS, WEAPON_TYPE_BY_CLASS, OFFHAND_TYPE_BY_CLASS, ARMOR_NAMES, ACCESSORY_NAMES } from '../data/itemData.js';
import { getSetTemplatesFor } from '../data/setGearData.js';

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
// 副手是唯一跟武器一樣「依職業鎖定」的普通掉落部位(不像防具/飾品任何職業通用)——
// 法師的副手給真氣減傷%(magicDamageReductionPct,固定生效減傷,取代格擋),其餘職業給格擋率(blockRatePct)
// + 生存數值(氣血/防禦)+ 少量攻擊值,呼應「副手主要是生存用的素質跟一些攻擊值」。
function commonOffhandStat(level, classId, atkKey) {
  const hpRoll = rollStatWithVariance(4 + level * 1.2);
  const atkRoll = rollStatWithVariance(1 + level * 0.35);
  if (classId === 'mage') {
    const reductionRoll = rollDecimalStatWithVariance(18 + level * 0.9); // 普通掉落上限抓在略低於商店common(50%),避免打怪就直接接近封頂
    return {
      stats: { hp: hpRoll.value, [atkKey]: atkRoll.value, magicDamageReductionPct: reductionRoll.value },
      quality: averageQuality([hpRoll, atkRoll, reductionRoll]),
    };
  }
  const defRoll = rollStatWithVariance(1 + level * 0.4);
  const blockRoll = rollDecimalStatWithVariance(0.8 + level * 0.1);
  return {
    stats: { hp: hpRoll.value, def: defRoll.value, [atkKey]: atkRoll.value, blockRatePct: blockRoll.value },
    quality: averageQuality([hpRoll, defRoll, atkRoll, blockRoll]),
  };
}
// 飾品是職業無關的通用格,三選一:會心率、氣血,或直接給DEX原生屬性(讓迴避build能透過裝備進一步強化,
// DEX同時也會回饋到攻擊/防禦/會心,對任何職業來說都不是死詞條)。
function commonAccessoryStat(level) {
  const roll = Math.random();
  if (roll < 0.34) {
    const r = rollDecimalStatWithVariance(0.5 + level * 0.15);
    return { stats: { critRatePct: r.value }, quality: r.quality };
  }
  if (roll < 0.67) {
    const r = rollStatWithVariance(5 + level * 1.5);
    return { stats: { hp: r.value }, quality: r.quality };
  }
  const r = rollStatWithVariance(1 + level * 0.3);
  return { stats: { dex: r.value }, quality: r.quality };
}

// 裝備耐久度:武器/防具上限固定 500,飾品不受耐久限制(不會壞、可以一直戴著)。
// 目的是抑制裝備無限累積、交易所被舊裝備灌爆——裝備會隨著實際戰鬥使用逐漸耗損,
// 耐久歸零後無法再穿戴/使用,只能賣給雜貨店回收(不能上架交易所賣給其他玩家一個報廢品)。
export const MAX_DURABILITY = 500;
function durabilityFieldsFor(slot) {
  if (slot === 'accessory' || slot === 'accessory1' || slot === 'accessory2') return { durability: null, maxDurability: null };
  return { durability: MAX_DURABILITY, maxDurability: MAX_DURABILITY };
}

// 普通裝備:打怪掉落時依怪物等級隨機生成(武器/副手會限定職業類型,防具/飾品任何職業皆可用)。
// 飾品掉落時只標記為通用的「accessory」,不預先綁定飾品一/飾品二——
// 曾經用隨機直接指定 accessory1/accessory2,結果玩家可能連續好幾次都抽到同一格,
// 導致另一格「看起來」永遠裝不上東西(其實只是運氣差,飾品一直接沒抽到而已)。
// 現在改成裝備當下由玩家自己選要放哪一格,兩格才會真正平等好用。
export function generateCommonGear(monsterLevel) {
  const roll = Math.random();
  const slot = roll < 0.2 ? 'weapon' : roll < 0.4 ? 'armor' : roll < 0.6 ? 'offhand' : 'accessory';
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
  } else if (slot === 'offhand') {
    const classKeys = Object.keys(OFFHAND_TYPE_BY_CLASS);
    const cls = classKeys[Math.floor(Math.random() * classKeys.length)];
    const info = OFFHAND_TYPE_BY_CLASS[cls];
    classType = cls;
    name = info.names[Math.floor(Math.random() * info.names.length)];
    result = commonOffhandStat(monsterLevel, cls, WEAPON_TYPE_BY_CLASS[cls].atkKey);
  } else {
    name = ACCESSORY_NAMES[Math.floor(Math.random() * ACCESSORY_NAMES.length)];
    result = commonAccessoryStat(monsterLevel);
  }
  return { id: nextId(), slot, name, tier: 'common', classType, itemLevel: monsterLevel, stats: result.stats, rollQuality: result.quality, enhanceLevel: 0, enhanceUses: 0, potential: null, ...durabilityFieldsFor(slot) };
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
    enhanceLevel: 0, // 目前淨強化點數(可能是負的),見 enhanceEngine.js
    enhanceUses: 0, // 強化卷軸已使用次數(上限5次),見 enhanceEngine.js
    potential: null, // 潛能(方塊洗出的隨機百分比詞條),初始為空,見 enhanceEngine.js
    ...durabilityFieldsFor(recipe.slot),
  };
}

// 裝備對角色的屬性加成(此版本裝備資料直接就是最終數值,不像先前武俠版本有潛力/淬煉/打造疊加)
export function getItemTotalStats(item) {
  return item.stats || {};
}

// 法師選擇職業時免費贈送的基礎副手:固定 50% 真氣減傷(對應 common 階магic副手同等級數值),
// 讓法師從 1 級開始就有「用副手抵擋傷害」的防禦手段,不必等到存夠錢打造才有生存工具。
export function createStarterMageOffhand() {
  return {
    id: nextId(),
    slot: 'offhand',
    name: '學徒秘紋法印',
    tier: 'common',
    classType: 'mage',
    itemLevel: 1,
    stats: { hp: 20, matk: 5, magicDamageReductionPct: 50 },
    rollQuality: 0.5,
    enhanceLevel: 0,
    enhanceUses: 0,
    potential: null,
    ...durabilityFieldsFor('offhand'),
  };
}

// 套裝裝備(菁英/真王專屬掉落):依 setId + slot + classId 從範本挑一件實例化。
// 武器/副手依職業限定(classId 決定要哪個版本),防具/飾品職業通用(classId 參數會被忽略)。
// 數值固定不浮動(不像一般掉落/打造有隨機區間),統一給予高品質顯示,呼應「稀有掉落理應優良」。
export function instantiateSetGear(setId, slot, classId) {
  const templates = getSetTemplatesFor(setId, slot);
  if (templates.length === 0) return null;
  const template = templates.find((t) => !t.classType || t.classType === classId) || templates[0];
  const isTrueBoss = setId.startsWith('trueboss_');
  return {
    id: nextId(),
    slot: template.slot,
    name: template.name,
    tier: isTrueBoss ? 'trueboss_set' : 'elite_set',
    setId,
    classType: template.classType,
    itemLevel: isTrueBoss ? 35 : 30,
    stats: { ...template.stats },
    rollQuality: 0.9,
    enhanceLevel: 0,
    enhanceUses: 0,
    potential: null,
    ...durabilityFieldsFor(template.slot),
  };
}

// 是否可裝備:武器一律看 classType;防具/飾品的普通掉落 classType 為 null(任何職業皆可用),
// 但稀有製作品皆鎖定對應職業(呼應「透過商店製作」代表玩家特意為該職業打造)。
export function canEquip(save, item) {
  if (!item.classType) return true;
  return item.classType === save.classId;
}
