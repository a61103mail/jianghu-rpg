// 套裝裝備資料(奇幻練功MMO):菁英怪物(原小王/大王)與真王(每張地圖的終極首領)的專屬掉落裝備。
// 菁英套裝 2 部位(武器+防具),真王套裝 4 部位(武器+防具+副手+飾品),依穿著件數逐件解鎖套裝效果——
// 菁英套裝共 2 條效果、真王套裝共 4 條效果(見 SET_BONUS_TIERS)。
// 武器/副手依職業區分(4個版本,掉落時依擊敗者職業自動生成對應版本);防具/飾品職業通用。
import { MAP_ORDER } from './monsterData.js';
import { WEAPON_TYPE_BY_CLASS, OFFHAND_TYPE_BY_CLASS } from './itemData.js';

// 各地圖套裝的基礎強度(隨地圖序位 0~4 遞增,呼應菁英/真王本身強度遞增)
const MAP_GEAR_BASE = [
  { weaponAtk: 60, armorDef: 42, armorHp: 140, offhandHp: 65, offhandDef: 20, offhandAtk: 18, accHp: 85, accCrit: 8 },
  { weaponAtk: 90, armorDef: 62, armorHp: 210, offhandHp: 95, offhandDef: 29, offhandAtk: 27, accHp: 125, accCrit: 12 },
  { weaponAtk: 118, armorDef: 82, armorHp: 280, offhandHp: 130, offhandDef: 39, offhandAtk: 35, accHp: 170, accCrit: 16 },
  { weaponAtk: 148, armorDef: 103, armorHp: 355, offhandHp: 162, offhandDef: 49, offhandAtk: 44, accHp: 215, accCrit: 20 },
  { weaponAtk: 180, armorDef: 126, armorHp: 435, offhandHp: 200, offhandDef: 60, offhandAtk: 54, accHp: 265, accCrit: 24 },
];

// 真王套裝比菁英套裝再強一截(呼應真王「至少兩張地圖強度」的定位)
const TRUEBOSS_MULT = 1.4;

const ELITE_SET_NAMES = ['史萊姆平原武士套', '哥布林獵殺者套', '礦坑征服者套', '沼澤獵人套', '遺跡征服者套'];
const TRUEBOSS_SET_NAMES = ['上古樹靈套', '哥布林帝國套', '深淵岩龍套', '太古邪神套', '太初神皇套'];

const CLASS_WEAPON_NAME = { warrior: '戰刃', mage: '法杖', priest: '聖典', archer: '獵弓' };
const CLASS_OFFHAND_NAME = { warrior: '戰盾', mage: '秘印', priest: '聖徽', archer: '箭匣' };

// 套裝效果的「職業特色屬性」對應:戰士/牧師=格擋率,法師=真氣減傷%,弓箭手=迴避率(見 characterEngine.js)
export const CLASS_SPECIAL_STAT_KEY = { warrior: 'blockRatePct', priest: 'blockRatePct', mage: 'magicDamageReductionPct', archer: 'evasionRate' };
export const CLASS_SPECIAL_STAT_LABEL = { warrior: '格擋率', priest: '格擋率', mage: '真氣減傷%', archer: '迴避率' };

// 套裝效果 tiers:每多穿一件解鎖一條,數值隨地圖序位遞增。
// 1) atkPowerPct(攻擊力%,依職業套用atk或matk) 2) classSpecialPct(職業特色屬性,單位為百分點)
// 3) allRawStatsPct(str/dex/int/luk全部一起+N%) 4) allStatsExceptSpecialPct(除職業特色外的全部現有屬性+N%)
function eliteTiers(mapIndex) {
  const base = 6 + mapIndex * 2; // 6/8/10/12/14 (%)
  return [
    { count: 1, key: 'atkPowerPct', value: base },
    { count: 2, key: 'classSpecialPct', value: Math.round(base * 0.6) },
  ];
}
function trueBossTiers(mapIndex) {
  const base = 10 + mapIndex * 2.5; // 10/12.5/15/17.5/20 (%)
  return [
    { count: 1, key: 'atkPowerPct', value: Math.round(base) },
    { count: 2, key: 'classSpecialPct', value: Math.round(base * 0.7) },
    { count: 3, key: 'allRawStatsPct', value: Math.round(base * 0.8) },
    { count: 4, key: 'allStatsExceptSpecialPct', value: Math.round(base) },
  ];
}

function buildClassWeapon(setId, mapIndex, classId, isTrueBoss) {
  const base = MAP_GEAR_BASE[mapIndex];
  const mult = isTrueBoss ? TRUEBOSS_MULT : 1;
  const atkKey = WEAPON_TYPE_BY_CLASS[classId].atkKey;
  return {
    id: `${setId}_weapon_${classId}`,
    slot: 'weapon',
    setId,
    classType: classId,
    stats: { [atkKey]: Math.round(base.weaponAtk * mult) },
    name: `${(isTrueBoss ? TRUEBOSS_SET_NAMES : ELITE_SET_NAMES)[mapIndex]}・${CLASS_WEAPON_NAME[classId]}`,
  };
}
function buildArmor(setId, mapIndex, isTrueBoss) {
  const base = MAP_GEAR_BASE[mapIndex];
  const mult = isTrueBoss ? TRUEBOSS_MULT : 1;
  return {
    id: `${setId}_armor`,
    slot: 'armor',
    setId,
    classType: null,
    stats: { def: Math.round(base.armorDef * mult), hp: Math.round(base.armorHp * mult) },
    name: `${(isTrueBoss ? TRUEBOSS_SET_NAMES : ELITE_SET_NAMES)[mapIndex]}・戰甲`,
  };
}
function buildClassOffhand(setId, mapIndex, classId) {
  const base = MAP_GEAR_BASE[mapIndex];
  const mult = TRUEBOSS_MULT; // 副手只有真王套裝才有(菁英套裝只有武器+防具2部位)
  const atkKey = WEAPON_TYPE_BY_CLASS[classId].atkKey;
  const stats = classId === 'mage'
    ? { hp: Math.round(base.offhandHp * mult), [atkKey]: Math.round(base.offhandAtk * mult), magicDamageReductionPct: 0 } // 減傷由套裝效果動態賦予,基礎裝備本身不重複給
    : { hp: Math.round(base.offhandHp * mult), def: Math.round(base.offhandDef * mult), [atkKey]: Math.round(base.offhandAtk * mult) };
  return {
    id: `${setId}_offhand_${classId}`,
    slot: 'offhand',
    setId,
    classType: classId,
    stats,
    name: `${TRUEBOSS_SET_NAMES[mapIndex]}・${CLASS_OFFHAND_NAME[classId]}`,
  };
}
function buildAccessory(setId, mapIndex) {
  const base = MAP_GEAR_BASE[mapIndex];
  const mult = TRUEBOSS_MULT;
  return {
    id: `${setId}_accessory`,
    slot: 'accessory',
    setId,
    classType: null,
    stats: { hp: Math.round(base.accHp * mult), critRatePct: Math.round(base.accCrit * mult * 10) / 10 },
    name: `${TRUEBOSS_SET_NAMES[mapIndex]}・聖徽`,
  };
}

// 每個 setId 底下,依部位與職業列出全部可能生成的裝備範本(掉落時依職業/部位挑一件實例化)
export const SET_GEAR_TEMPLATES = {};
export const SET_INFO = {}; // setId -> { name, pieces(總部位數), tiers, mapId, kind }

MAP_ORDER.forEach((mapId, idx) => {
  const eliteSetId = `elite_${mapId}`;
  const trueBossSetId = `trueboss_${mapId}`;
  const classIds = Object.keys(WEAPON_TYPE_BY_CLASS);

  SET_GEAR_TEMPLATES[eliteSetId] = [
    ...classIds.map((c) => buildClassWeapon(eliteSetId, idx, c, false)),
    buildArmor(eliteSetId, idx, false),
  ];
  SET_INFO[eliteSetId] = { name: ELITE_SET_NAMES[idx], pieces: 2, tiers: eliteTiers(idx), mapId, kind: 'elite' };

  SET_GEAR_TEMPLATES[trueBossSetId] = [
    ...classIds.map((c) => buildClassWeapon(trueBossSetId, idx, c, true)),
    buildArmor(trueBossSetId, idx, true),
    ...classIds.map((c) => buildClassOffhand(trueBossSetId, idx, c)),
    buildAccessory(trueBossSetId, idx),
  ];
  SET_INFO[trueBossSetId] = { name: TRUEBOSS_SET_NAMES[idx], pieces: 4, tiers: trueBossTiers(idx), mapId, kind: 'trueboss' };
});

export function getSetTemplatesFor(setId, slotFilter) {
  const list = SET_GEAR_TEMPLATES[setId] || [];
  return slotFilter ? list.filter((t) => t.slot === slotFilter) : list;
}

export function getSetInfo(setId) {
  return SET_INFO[setId];
}

// ---- 套裝製作配方(商店用材料+金幣製作,取代直接掉落成品)----
// 材料保底掉落(見 monsterData.js 的 eliteShardDrop/trueBossCrystalDrop),玩家帶去對應商店製作。
// 武器/副手依職業限定,只出現在該職業對應的商店;防具/飾品職業通用——防具在四間職業商店都能做
// (呼應「鐵匠鋪打鎧甲」這類世界觀,任何商店都能打出同規格防具),飾品固定在雜貨店統一製作。
const SHOP_CLASS = { blacksmith: 'warrior', leather: 'archer', magic: 'mage', church: 'priest' };
const ELITE_WEAPON_MATS = 4, ELITE_ARMOR_MATS = 3;
const TRUEBOSS_WEAPON_MATS = 5, TRUEBOSS_ARMOR_MATS = 4, TRUEBOSS_OFFHAND_MATS = 3, TRUEBOSS_ACCESSORY_MATS = 3;

export const SET_RECIPES = {}; // shopId -> recipe[](格式對齊 RARE_RECIPES,方便前端/後端共用顯示邏輯)

MAP_ORDER.forEach((mapId, idx) => {
  const eliteSetId = `elite_${mapId}`;
  const trueBossSetId = `trueboss_${mapId}`;
  const eliteMatId = `elite_shard_${mapId}`;
  const trueBossMatId = `trueboss_crystal_${mapId}`;
  const eliteGold = 200 + idx * 100;
  const trueBossWeaponGold = 600 + idx * 150;
  const trueBossArmorGold = 500 + idx * 130;
  const trueBossOffhandGold = 400 + idx * 110;
  const trueBossAccessoryGold = 400 + idx * 110;

  Object.entries(SHOP_CLASS).forEach(([shopId, classId]) => {
    if (!SET_RECIPES[shopId]) SET_RECIPES[shopId] = [];
    const eliteWeapon = getSetTemplatesFor(eliteSetId, 'weapon').find((t) => t.classType === classId);
    const eliteArmor = getSetTemplatesFor(eliteSetId, 'armor')[0];
    const tbWeapon = getSetTemplatesFor(trueBossSetId, 'weapon').find((t) => t.classType === classId);
    const tbArmor = getSetTemplatesFor(trueBossSetId, 'armor')[0];
    const tbOffhand = getSetTemplatesFor(trueBossSetId, 'offhand').find((t) => t.classType === classId);
    SET_RECIPES[shopId].push(
      { id: `craft_${eliteWeapon.id}`, name: eliteWeapon.name, slot: 'weapon', tier: 'elite_set', setId: eliteSetId, classType: classId, gold: eliteGold, materials: { [eliteMatId]: ELITE_WEAPON_MATS }, statBonus: eliteWeapon.stats },
      { id: `craft_${eliteArmor.id}`, name: eliteArmor.name, slot: 'armor', tier: 'elite_set', setId: eliteSetId, classType: null, gold: eliteGold, materials: { [eliteMatId]: ELITE_ARMOR_MATS }, statBonus: eliteArmor.stats },
      { id: `craft_${tbWeapon.id}`, name: tbWeapon.name, slot: 'weapon', tier: 'trueboss_set', setId: trueBossSetId, classType: classId, gold: trueBossWeaponGold, materials: { [trueBossMatId]: TRUEBOSS_WEAPON_MATS }, statBonus: tbWeapon.stats },
      { id: `craft_${tbArmor.id}`, name: tbArmor.name, slot: 'armor', tier: 'trueboss_set', setId: trueBossSetId, classType: null, gold: trueBossArmorGold, materials: { [trueBossMatId]: TRUEBOSS_ARMOR_MATS }, statBonus: tbArmor.stats },
      { id: `craft_${tbOffhand.id}`, name: tbOffhand.name, slot: 'offhand', tier: 'trueboss_set', setId: trueBossSetId, classType: classId, gold: trueBossOffhandGold, materials: { [trueBossMatId]: TRUEBOSS_OFFHAND_MATS }, statBonus: tbOffhand.stats }
    );
  });

  // 飾品職業通用,固定放在雜貨店統一製作(不分職業商店)
  if (!SET_RECIPES.general) SET_RECIPES.general = [];
  const tbAccessory = getSetTemplatesFor(trueBossSetId, 'accessory')[0];
  SET_RECIPES.general.push({
    id: `craft_${tbAccessory.id}`, name: tbAccessory.name, slot: 'accessory', tier: 'trueboss_set', setId: trueBossSetId, classType: null,
    gold: trueBossAccessoryGold, materials: { [trueBossMatId]: TRUEBOSS_ACCESSORY_MATS }, statBonus: tbAccessory.stats,
  });
});

export function getSetRecipesForShop(shopId) {
  return SET_RECIPES[shopId] || [];
}

export function getSetRecipeById(shopId, recipeId) {
  return getSetRecipesForShop(shopId).find((r) => r.id === recipeId);
}
