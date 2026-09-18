// 物品/商店資料(奇幻練功MMO):怪物只掉「可販售雜物」與「製作素材」,金幣完全來自把雜物賣給雜貨店。
// 裝備分兩軌:普通裝備只能靠打怪掉落(itemEngine.js 依怪物等級隨機生成),
// 稀有裝備「只能」靠對應商店的製作配方取得(消耗素材+金幣+等級門檻),兩者不重疊。
import { MAP_ORDER } from './monsterData.js';

export const ITEMS = {
  // ---- 雜物(僅能在雜貨店回收賣錢,無其他用途)----
  slime_jelly: { id: 'slime_jelly', name: '史萊姆黏液', kind: 'junk', basePrice: 3 },
  boar_hide: { id: 'boar_hide', name: '野豬皮', kind: 'junk', basePrice: 5 },
  goblin_ear: { id: 'goblin_ear', name: '哥布林耳朵', kind: 'junk', basePrice: 8 },
  goblin_bow_string: { id: 'goblin_bow_string', name: '哥布林弓弦', kind: 'junk', basePrice: 10 },
  bat_wing: { id: 'bat_wing', name: '蝙蝠之翼', kind: 'junk', basePrice: 15 },
  rat_tail: { id: 'rat_tail', name: '鼠尾', kind: 'junk', basePrice: 18 },
  tentacle_ooze: { id: 'tentacle_ooze', name: '觸手黏液', kind: 'junk', basePrice: 28 },
  toad_venom_sac: { id: 'toad_venom_sac', name: '蟾蜍毒囊', kind: 'junk', basePrice: 32 },
  guardian_plating: { id: 'guardian_plating', name: '守衛裝甲碎片', kind: 'junk', basePrice: 45 },
  shadow_fragment: { id: 'shadow_fragment', name: '暗影碎片', kind: 'junk', basePrice: 50 },

  // ---- 一般製作素材(舊制,依職業商店分類;仍可打怪掉落+賣給雜貨店換錢,但已不再是任何裝備配方
  // 的材料,基本裝備改用下方「地圖鍛材」製作,見 GEAR_MATERIAL_BY_MAP)----
  iron_ore: { id: 'iron_ore', name: '鐵礦', kind: 'material', shop: 'blacksmith', basePrice: 6 },
  rough_leather: { id: 'rough_leather', name: '粗製獸皮', kind: 'material', shop: 'leather', basePrice: 6 },
  feather: { id: 'feather', name: '羽毛', kind: 'material', shop: 'leather', basePrice: 6 },
  crystal_shard: { id: 'crystal_shard', name: '魔力碎晶', kind: 'material', shop: 'magic', basePrice: 9 },
  holy_water: { id: 'holy_water', name: '淬毒液', kind: 'material', shop: 'church', basePrice: 10 },

  // ---- 地圖鍛材(基本裝備製作專用):每張地圖各自專屬、互不相通,不分職業商店,四間商店都用
  // 同一種地圖鍛材製作各自的武器/防具/副手/飾品——呼應「裝備要隨著地圖持續成長」,材料取得
  // 難度也隨地圖遞增(見 monsterData.js 各地圖一般小怪的掉落表,以及下方 buildShopRecipes)。
  gear_material_novice_plains: { id: 'gear_material_novice_plains', name: '新手平原鍛材', kind: 'material', basePrice: 6 },
  gear_material_goblin_forest: { id: 'gear_material_goblin_forest', name: '哥布林森林鍛材', kind: 'material', basePrice: 11 },
  gear_material_stone_mines: { id: 'gear_material_stone_mines', name: '石化礦坑鍛材', kind: 'material', basePrice: 18 },
  gear_material_dark_swamp: { id: 'gear_material_dark_swamp', name: '幽暗沼澤鍛材', kind: 'material', basePrice: 27 },
  gear_material_ruined_borderlands: { id: 'gear_material_ruined_borderlands', name: '遺跡邊境鍛材', kind: 'material', basePrice: 38 },

  // ---- 稀有素材(舊制,已停用/不再掉落——原本對應「僅小王/大王掉落,製作稀有/超稀有裝備」的
  // 舊配方,裝備地圖化重構後已被 elite_shard/trueboss_crystal 的套裝製作路線完全取代,現在沒有
  // 任何配方會用到。已從全部怪物 dropTable 移除,不會再掉落;僅保留定義,讓玩家過去已持有的存量
  // 仍能正常賣給雜貨店回收換錢,不會卡在背包裡)----
  slime_core: { id: 'slime_core', name: '史萊姆核心', kind: 'rare_material', shop: 'magic', basePrice: 20 },
  boar_fang: { id: 'boar_fang', name: '巨牙野豬獠牙', kind: 'rare_material', shop: 'blacksmith', basePrice: 25 },
  captain_insignia: { id: 'captain_insignia', name: '隊長徽記', kind: 'rare_material', shop: 'leather', basePrice: 35 },
  chieftain_totem: { id: 'chieftain_totem', name: '酋長圖騰', kind: 'rare_material', shop: 'magic', basePrice: 45 },
  spider_silk_gland: { id: 'spider_silk_gland', name: '蛛絲腺', kind: 'rare_material', shop: 'leather', basePrice: 60 },
  golem_core: { id: 'golem_core', name: '巨人核心', kind: 'rare_material', shop: 'blacksmith', basePrice: 75 },
  witch_charm: { id: 'witch_charm', name: '女巫護符', kind: 'rare_material', shop: 'magic', basePrice: 95 },
  drake_scale: { id: 'drake_scale', name: '龍鱗', kind: 'rare_material', shop: 'church', basePrice: 120 },
  knight_emblem: { id: 'knight_emblem', name: '騎士徽章', kind: 'rare_material', shop: 'blacksmith', basePrice: 160 },
  king_crown_shard: { id: 'king_crown_shard', name: '王冠碎片', kind: 'rare_material', shop: 'church', basePrice: 220 },

  // ---- 組隊限定素材(舊制,已停用/不再掉落——原本用來把「超稀有」裝備配方從單人刷王再加一道
  // 「要真的組隊打過王」的門檻,該配方已被裝備地圖化重構完全取代,現在沒有任何配方會用到。
  // 已從 partyBonusDrop 移除,不會再掉落;僅保留定義,讓玩家過去已持有的存量仍能賣給雜貨店回收)----
  party_seal: { id: 'party_seal', name: '團隊戰印', kind: 'party_material', basePrice: 150 },

  // ---- 套裝製作素材(每張地圖各自專屬;套裝終究強於一般鍛材裝備,取得難度也該更高,因此菁英/真王
  // 掉落「不保底」0~2/0~3個,機率上比一般鍛材(保底1~3個)更吝嗇——理論上套裝比一般裝備更強,
  // 材料取得量就該反過來比一般鍛材少,而不是套裝材料掉得比一般鍛材還大方)----
  // 菁英碎片用於在對應商店製作該地圖的「菁英套裝」(2部位:武器+防具);
  // 真王結晶用於製作該地圖的「真王套裝」(4部位:武器+防具+副手+飾品),見 setGearData.js 的配方定義。
  elite_shard_novice_plains: { id: 'elite_shard_novice_plains', name: '新手平原菁英碎片', kind: 'set_material', basePrice: 60 },
  elite_shard_goblin_forest: { id: 'elite_shard_goblin_forest', name: '哥布林森林菁英碎片', kind: 'set_material', basePrice: 90 },
  elite_shard_stone_mines: { id: 'elite_shard_stone_mines', name: '石化礦坑菁英碎片', kind: 'set_material', basePrice: 120 },
  elite_shard_dark_swamp: { id: 'elite_shard_dark_swamp', name: '幽暗沼澤菁英碎片', kind: 'set_material', basePrice: 150 },
  elite_shard_ruined_borderlands: { id: 'elite_shard_ruined_borderlands', name: '遺跡邊境菁英碎片', kind: 'set_material', basePrice: 180 },
  trueboss_crystal_novice_plains: { id: 'trueboss_crystal_novice_plains', name: '上古樹靈王真王結晶', kind: 'set_material', basePrice: 200 },
  trueboss_crystal_goblin_forest: { id: 'trueboss_crystal_goblin_forest', name: '哥布林大帝真王結晶', kind: 'set_material', basePrice: 280 },
  trueboss_crystal_stone_mines: { id: 'trueboss_crystal_stone_mines', name: '深淵岩龍真王結晶', kind: 'set_material', basePrice: 360 },
  trueboss_crystal_dark_swamp: { id: 'trueboss_crystal_dark_swamp', name: '太古邪神真王結晶', kind: 'set_material', basePrice: 440 },
  trueboss_crystal_ruined_borderlands: { id: 'trueboss_crystal_ruined_borderlands', name: '太初神皇真王結晶', kind: 'set_material', basePrice: 520 },
};

export function getItem(id) {
  return ITEMS[id];
}

export const GEAR_SLOTS = ['weapon', 'armor', 'offhand', 'accessory1', 'accessory2'];

// 各職業使用的武器類型(決定普通裝備隨機掉落時的命名與對應稀有製作商店)
export const WEAPON_TYPE_BY_CLASS = {
  warrior: { type: 'sword', names: ['鐵劍', '闊刃斧', '戰錘'], shop: 'blacksmith', atkKey: 'atk' },
  mage: { type: 'staff', names: ['木杖', '法杖', '魔導書'], shop: 'magic', atkKey: 'matk' },
  rogue: { type: 'dagger', names: ['匕首', '雙刃', '暗殺爪'], shop: 'church', atkKey: 'atk' },
  archer: { type: 'bow', names: ['短弓', '長弓', '弩'], shop: 'leather', atkKey: 'atk' },
};

// 副手裝備(新增部位):主要提供生存數值(氣血/防禦)+ 少量攻擊值,武器一樣依職業鎖定。
// 法師的副手是特例——額外附帶「真氣減傷%」(magicDamageReductionPct,固定生效的傷害減免,
// 見 combatEngine.js),取代其他職業靠格擋值(blockRatePct)生存的機制。盜賊的副手同樣是特例——
// 不給任何防禦手段,而是附帶「會心傷害%」(critDamagePct),呼應盜賊皮薄但爆發傷害極高的定位。
export const OFFHAND_TYPE_BY_CLASS = {
  warrior: { names: ['小圓盾', '鳶盾', '塔盾'], shop: 'blacksmith' },
  mage: { names: ['魔導書副冊', '秘紋法印', '奧術聖典'], shop: 'magic' },
  rogue: { names: ['淬毒暗器囊', '影襲徽記', '死神低語'], shop: 'church' },
  archer: { names: ['箭袋', '強化弓弦', '獵人護臂'], shop: 'leather' },
};

export const ARMOR_NAMES = ['布甲', '皮甲', '鎖甲', '板甲'];
export const ACCESSORY_NAMES = ['護符', '戒指', '項鍊', '徽章'];

// 基本裝備配方(僅能在對應商店製作,無法透過打怪取得,不設等級門檻——只要材料+金幣足夠就能做)。
// 每間商店、每個裝備部位都對應 5 張地圖各一階,呼應「裝備要隨著地圖持續成長」——玩家推進到
// 哪張地圖,就能用該地圖打怪掉的鍛材做出對應強度的新裝備,不會出現「打到第五章卻還在用第一章
// 配方」的窘境。材料採用 GEAR_MATERIAL_QTY_BY_MAP(每張地圖各自的地圖鍛材,互不相通),
// 金幣需求見 GEAR_GOLD_BY_MAP,兩者皆隨地圖序位遞增。數值強度低於同地圖的菁英/真王套裝,
// 套裝仍是打贏王才能取得的頂級裝備,基本裝備則是「持續刷小怪就能穩定量產」的中階裝備。
const GEAR_MATERIAL_QTY_BY_MAP = { novice_plains: 5, goblin_forest: 8, stone_mines: 12, dark_swamp: 16, ruined_borderlands: 20 };
const GEAR_GOLD_BY_MAP = { novice_plains: 30, goblin_forest: 90, stone_mines: 200, dark_swamp: 380, ruined_borderlands: 650 };
const TIER_STATS = {
  novice_plains: { weaponAtk: 28, armorDef: 20, armorHp: 65, accCritPct: 3, accHp: 38, accDex: 17 },
  goblin_forest: { weaponAtk: 45, armorDef: 32, armorHp: 104, accCritPct: 4.8, accHp: 61, accDex: 27 },
  stone_mines: { weaponAtk: 67, armorDef: 48, armorHp: 156, accCritPct: 7.2, accHp: 91, accDex: 41 },
  dark_swamp: { weaponAtk: 95, armorDef: 68, armorHp: 221, accCritPct: 10.2, accHp: 129, accDex: 58 },
  ruined_borderlands: { weaponAtk: 129, armorDef: 92, armorHp: 299, accCritPct: 13.8, accHp: 175, accDex: 78 },
};
// 副手五階數值:生存向(氣血/防禦約為防具一半)+ 少量攻擊值(約武器三分之一)。
// 職業特色屬性各自用途:blockPct(戰士格擋率)、evasionPct(弓箭手迴避率)、critDamagePct(盜賊
// 會心傷害%)都是隨地圖遞增的百分點加成;法師改用固定 50% 真氣減傷(不因強化/潛能/套裝疊加,
// 五階數值皆相同,見 characterEngine.js——固定生效判斷只看 classId,這裡的數值僅供裝備欄顯示用)。
const OFFHAND_TIER_STATS = {
  novice_plains: { hp: 25, def: 8, atk: 8, blockPct: 3, evasionPct: 3, magicReductionPct: 50, critDamagePct: 15 },
  goblin_forest: { hp: 40, def: 13, atk: 13, blockPct: 4.8, evasionPct: 4.8, magicReductionPct: 50, critDamagePct: 24 },
  stone_mines: { hp: 60, def: 19, atk: 19, blockPct: 7.2, evasionPct: 7.2, magicReductionPct: 50, critDamagePct: 36 },
  dark_swamp: { hp: 85, def: 27, atk: 27, blockPct: 10.2, evasionPct: 10.2, magicReductionPct: 50, critDamagePct: 51 },
  ruined_borderlands: { hp: 115, def: 37, atk: 37, blockPct: 13.8, evasionPct: 13.8, magicReductionPct: 50, critDamagePct: 69 },
};
const TIER_NAME_ZH = {
  novice_plains: '新手平原', goblin_forest: '哥布林森林', stone_mines: '石化礦坑',
  dark_swamp: '幽暗沼澤', ruined_borderlands: '遺跡邊境',
  elite_set: '菁英套裝', trueboss_set: '真王套裝',
};

// 依商店的攻擊屬性(atk/matk)與部位,組出五個部位×五張地圖共 30 張配方(武器/防具/副手各1張+飾品3張)。
// 飾品的三張配方(acc1會心向/acc2氣血向/acc3敏捷向)只是「不同屬性傾向的飾品」,不代表三個不同
// 格子——slot 統一用通用的 accessory,實際要放飾品一或飾品二由玩家裝備時自己選。
function buildShopRecipes(shopId, atkKey, namesByMap, offhandNamesByMap) {
  const recipes = [];
  const isMage = shopId === 'magic';
  const isArcher = shopId === 'leather';
  const isRogue = shopId === 'church';
  MAP_ORDER.forEach((mapId) => {
    const s = TIER_STATS[mapId];
    const o = OFFHAND_TIER_STATS[mapId];
    const n = namesByMap[mapId];
    const materials = { [`gear_material_${mapId}`]: GEAR_MATERIAL_QTY_BY_MAP[mapId] };
    const gold = GEAR_GOLD_BY_MAP[mapId];
    recipes.push({ id: `${shopId}_weapon_${mapId}`, name: n.weapon, slot: 'weapon', tier: mapId, gold, materials, statBonus: { [atkKey]: s.weaponAtk } });
    recipes.push({ id: `${shopId}_armor_${mapId}`, name: n.armor, slot: 'armor', tier: mapId, gold, materials, statBonus: { def: s.armorDef, hp: s.armorHp } });
    let offhandStatBonus;
    if (isMage) {
      offhandStatBonus = { hp: o.hp, [atkKey]: o.atk, magicDamageReductionPct: o.magicReductionPct };
    } else if (isArcher) {
      offhandStatBonus = { hp: o.hp, def: o.def, [atkKey]: o.atk, evasionRatePct: o.evasionPct };
    } else if (isRogue) {
      offhandStatBonus = { hp: o.hp, [atkKey]: o.atk, critDamagePct: o.critDamagePct };
    } else {
      offhandStatBonus = { hp: o.hp, def: o.def, [atkKey]: o.atk, blockRatePct: o.blockPct };
    }
    recipes.push({ id: `${shopId}_offhand_${mapId}`, name: offhandNamesByMap[mapId], slot: 'offhand', tier: mapId, gold, materials, statBonus: offhandStatBonus });
    recipes.push({ id: `${shopId}_accessory1_${mapId}`, name: n.acc1, slot: 'accessory', tier: mapId, gold, materials, statBonus: { critRatePct: s.accCritPct } });
    recipes.push({ id: `${shopId}_accessory2_${mapId}`, name: n.acc2, slot: 'accessory', tier: mapId, gold, materials, statBonus: { hp: s.accHp } });
    recipes.push({ id: `${shopId}_accessory3_${mapId}`, name: n.acc3, slot: 'accessory', tier: mapId, gold, materials, statBonus: { dex: s.accDex } });
  });
  return recipes;
}

export const RARE_RECIPES = {
  blacksmith: buildShopRecipes(
    'blacksmith', 'atk',
    {
      novice_plains: { weapon: '精鐵劍', armor: '精鐵鎧甲', acc1: '精鐵護符', acc2: '力量護腕', acc3: '精鐵敏捷環' },
      goblin_forest: { weapon: '哥布林戰斧', armor: '哥布林鎧甲', acc1: '哥布林牙墜', acc2: '蠻力腰帶', acc3: '疾風牙墜' },
      stone_mines: { weapon: '磐岩巨劍', armor: '磐岩重甲', acc1: '磐岩戒', acc2: '巨力腰帶', acc3: '磐岩敏捷環' },
      dark_swamp: { weapon: '沼澤蝕鋼劍', armor: '沼澤蝕鋼甲', acc1: '蝕鋼戒', acc2: '蝕鋼腰帶', acc3: '沼澤疾影環' },
      ruined_borderlands: { weapon: '遺跡王者劍', armor: '遺跡王者鎧', acc1: '王者戒', acc2: '王者護環', acc3: '王者疾影環' },
    },
    { novice_plains: '精鐵小圓盾', goblin_forest: '哥布林戰盾', stone_mines: '磐岩塔盾', dark_swamp: '沼澤蝕鋼盾', ruined_borderlands: '遺跡王者盾' }
  ),
  leather: buildShopRecipes(
    'leather', 'atk',
    {
      novice_plains: { weapon: '硬化短弓', armor: '硬化皮甲', acc1: '羽紋護符', acc2: '敏捷手環', acc3: '疾行足環' },
      goblin_forest: { weapon: '哥布林獵弓', armor: '哥布林皮甲', acc1: '哥布林徽記戒', acc2: '迅捷腰帶', acc3: '獵風之靴' },
      stone_mines: { weapon: '磐岩複合弓', armor: '磐岩輕甲', acc1: '磐岩敏捷戒', acc2: '磐岩腰帶', acc3: '磐岩迅步環' },
      dark_swamp: { weapon: '沼澤毒牙弓', armor: '沼澤鱗甲', acc1: '毒牙戒', acc2: '沼澤迅捷環', acc3: '沼澤影靴' },
      ruined_borderlands: { weapon: '遺跡疾風弓', armor: '遺跡遊俠甲', acc1: '遊俠戒', acc2: '遊俠迅捷環', acc3: '遊俠疾影靴' },
    },
    { novice_plains: '硬化箭袋', goblin_forest: '哥布林強化弓弦', stone_mines: '磐岩強化箭袋', dark_swamp: '沼澤毒牙箭袋', ruined_borderlands: '遺跡遊俠箭袋' }
  ),
  magic: buildShopRecipes(
    'magic', 'matk',
    {
      novice_plains: { weapon: '木杖', armor: '學徒法袍', acc1: '碎晶護符', acc2: '魔力手環', acc3: '碎晶敏捷戒' },
      goblin_forest: { weapon: '哥布林法杖', armor: '哥布林法袍', acc1: '秘紋戒', acc2: '秘紋腰帶', acc3: '秘紋迅步環' },
      stone_mines: { weapon: '磐岩法杖', armor: '磐岩法袍', acc1: '磐岩秘紋戒', acc2: '磐岩魔力環', acc3: '磐岩迅步環' },
      dark_swamp: { weapon: '沼澤邪杖', armor: '沼澤邪袍', acc1: '邪紋戒', acc2: '沼澤魔力環', acc3: '沼澤迅影環' },
      ruined_borderlands: { weapon: '遺跡神皇杖', armor: '遺跡神皇袍', acc1: '神皇秘紋戒', acc2: '神皇魔力環', acc3: '神皇迅影靴' },
    },
    { novice_plains: '魔導書副冊', goblin_forest: '哥布林秘紋法印', stone_mines: '磐岩秘紋法印', dark_swamp: '沼澤邪紋法印', ruined_borderlands: '神皇奧術聖典' }
  ),
  church: buildShopRecipes(
    'church', 'atk',
    {
      novice_plains: { weapon: '淬毒匕首', armor: '夜行輕甲', acc1: '暗影護符', acc2: '敏捷手環', acc3: '暗影疾行環' },
      goblin_forest: { weapon: '哥布林淬毒爪', armor: '哥布林夜行服', acc1: '哥布林暗影戒', acc2: '夜行腰帶', acc3: '夜行疾影環' },
      stone_mines: { weapon: '磐岩淬毒爪', armor: '磐岩夜行服', acc1: '磐岩暗影戒', acc2: '磐岩夜行環', acc3: '磐岩疾影靴' },
      dark_swamp: { weapon: '沼澤淬毒爪', armor: '沼澤夜行服', acc1: '沼澤暗影戒', acc2: '沼澤夜行環', acc3: '沼澤疾影靴' },
      ruined_borderlands: { weapon: '遺跡噬魂爪', armor: '遺跡夜行服', acc1: '暗影王冠戒', acc2: '王冠疾影環', acc3: '王冠無聲靴' },
    },
    { novice_plains: '淬毒暗器囊', goblin_forest: '哥布林毒囊', stone_mines: '磐岩毒囊', dark_swamp: '沼澤劇毒囊', ruined_borderlands: '死神低語' }
  ),
};

export function getRareRecipes(shopId) {
  return RARE_RECIPES[shopId] || [];
}

export function getTierNameZh(tier) {
  return TIER_NAME_ZH[tier] || tier;
}


// 藥水:雜貨店固定金幣購買,亦可透過雜貨店的回收轉換機制取得折扣庫存(見 marketEngine.js)
export const POTIONS = {
  hp_small: { id: 'hp_small', name: '小型體力藥水', kind: 'hp', healPct: 0.3, price: 20 },
  hp_medium: { id: 'hp_medium', name: '中型體力藥水', kind: 'hp', healPct: 0.6, price: 45 },
  mp_small: { id: 'mp_small', name: '小型真力藥水', kind: 'mp', healPct: 0.3, price: 18 },
  mp_medium: { id: 'mp_medium', name: '中型真力藥水', kind: 'mp', healPct: 0.6, price: 40 },
};
export const POTION_ORDER = ['hp_small', 'hp_medium', 'mp_small', 'mp_medium'];

export function getPotion(id) {
  return POTIONS[id];
}

// 裝備強化用消耗品:雜貨店固定金幣購買,套用於 enhanceEngine.js。
// 卷軸:依部位分四種(武器/防具/副手/飾品),強化成功會 +1 強化等級並增加固定數值,失敗只損失卷軸本身(不會破壞裝備)。
// 王家卷軸(scroll_*_royal):只有真王才會掉落,不開放商店購買(price:0,不列入商店供應清單)——
// 數值範圍比一般卷軸更好(-1~+5 vs 一般卷軸 -3~+3),期望值更高、最壞情況的下跌幅度也更小,
// 呼應「菁英只掉簡單卷軸,真王才掉更強的卷軸」。
// 方塊:洗裝備的「潛能」(隨機百分比詞條),不分部位、任何裝備都能用,見 enhanceEngine.js 的機率與詞條池。
// 抉擇方塊(cube_potential_choice):比一般潛能方塊更貴的高階版本——固定直接洗出3條詞條(不像
// 一般方塊要先洗到傳說階才有3條),且採「先預覽再選擇」流程:玩家可以看過這次洗出的3條新詞條後,
// 自己選擇要套用新的還是保留原本的潛能,不滿意可以直接放棄(但方塊已消耗,見 enhanceEngine.js)。
// 只有菁英以上的王才會掉(0~2個,不保底),不開放商店購買。
export const ENHANCE_ITEMS = {
  scroll_weapon: { id: 'scroll_weapon', name: '武器強化卷軸', kind: 'scroll', appliesTo: 'weapon', price: 60 },
  scroll_armor: { id: 'scroll_armor', name: '防具強化卷軸', kind: 'scroll', appliesTo: 'armor', price: 60 },
  scroll_offhand: { id: 'scroll_offhand', name: '副手強化卷軸', kind: 'scroll', appliesTo: 'offhand', price: 60 },
  scroll_accessory: { id: 'scroll_accessory', name: '飾品強化卷軸', kind: 'scroll', appliesTo: 'accessory', price: 60 },
  scroll_weapon_royal: { id: 'scroll_weapon_royal', name: '王家武器卷軸', kind: 'scroll_royal', appliesTo: 'weapon', price: 0 },
  scroll_armor_royal: { id: 'scroll_armor_royal', name: '王家防具卷軸', kind: 'scroll_royal', appliesTo: 'armor', price: 0 },
  scroll_offhand_royal: { id: 'scroll_offhand_royal', name: '王家副手卷軸', kind: 'scroll_royal', appliesTo: 'offhand', price: 0 },
  scroll_accessory_royal: { id: 'scroll_accessory_royal', name: '王家飾品卷軸', kind: 'scroll_royal', appliesTo: 'accessory', price: 0 },
  cube_potential: { id: 'cube_potential', name: '潛能方塊', kind: 'cube', appliesTo: 'any', price: 150 },
  cube_potential_choice: { id: 'cube_potential_choice', name: '抉擇方塊', kind: 'cube_choice', appliesTo: 'any', price: 320 },
};
export const ENHANCE_ITEM_ORDER = ['scroll_weapon', 'scroll_armor', 'scroll_offhand', 'scroll_accessory', 'scroll_weapon_royal', 'scroll_armor_royal', 'scroll_offhand_royal', 'scroll_accessory_royal', 'cube_potential', 'cube_potential_choice'];

export function getEnhanceItem(id) {
  return ENHANCE_ITEMS[id];
}

// 五間商店的基本資訊
export const SHOPS = {
  blacksmith: { id: 'blacksmith', name: '鐵匠鋪', desc: '主副武器與重型裝甲,戰士的根據地。', classAffinity: 'warrior' },
  leather: { id: 'leather', name: '皮革店', desc: '輕型武器與皮甲,弓箭手的補給站。', classAffinity: 'archer' },
  magic: { id: 'magic', name: '法術店', desc: '法杖與法袍,法師的修行之處。', classAffinity: 'mage' },
  church: { id: 'church', name: '黑市', desc: '匕首與暗器,盜賊私下交易的地下據點。', classAffinity: 'rogue' },
  general: { id: 'general', name: '雜貨店', desc: '販賣藥水與強化卷軸/潛能方塊,也回收各種戰利品雜物。', classAffinity: null },
};
export const SHOP_ORDER = ['blacksmith', 'leather', 'magic', 'church', 'general'];

export function getShop(id) {
  return SHOPS[id];
}
