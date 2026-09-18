// 物品/商店資料(奇幻練功MMO):怪物只掉「可販售雜物」與「製作素材」,金幣完全來自把雜物賣給雜貨店。
// 裝備分兩軌:普通裝備只能靠打怪掉落(itemEngine.js 依怪物等級隨機生成),
// 稀有裝備「只能」靠對應商店的製作配方取得(消耗素材+金幣+等級門檻),兩者不重疊。
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

  // ---- 一般製作素材(各對應一間裝備商店,較常見;也可直接賣給雜貨店換錢,由玩家自行決定要留著做裝備還是換現金)----
  iron_ore: { id: 'iron_ore', name: '鐵礦', kind: 'material', shop: 'blacksmith', basePrice: 6 },
  rough_leather: { id: 'rough_leather', name: '粗製獸皮', kind: 'material', shop: 'leather', basePrice: 6 },
  feather: { id: 'feather', name: '羽毛', kind: 'material', shop: 'leather', basePrice: 6 },
  crystal_shard: { id: 'crystal_shard', name: '魔力碎晶', kind: 'material', shop: 'magic', basePrice: 9 },
  holy_water: { id: 'holy_water', name: '聖水', kind: 'material', shop: 'church', basePrice: 10 },

  // ---- 稀有素材(僅小王/大王掉落,製作稀有/超稀有裝備專用;賣給雜貨店的價格遠高於一般素材,反映其稀有度)----
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

  // ---- 組隊限定素材(僅組隊副本擊敗大王才有機率掉落,單人闖蕩/決鬥完全不會出現)----
  // 一個人刷不到,逼玩家真的要湊隊伍打組隊副本才能取得,用來把「超稀有」裝備配方(EPIC_TIER_BOSS_MATS)
  // 從單純「刷完全部單人大王」再往上加一道「你也要真的組隊打過王」的門檻,讓組隊本身有不可取代的價值。
  party_seal: { id: 'party_seal', name: '團隊戰印', kind: 'party_material', basePrice: 150 },

  // ---- 套裝製作素材(每張地圖各自專屬,菁英/真王擊敗保底掉落1~3個,不會出現0個的坑爹情況)----
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
  priest: { type: 'mace', names: ['聖錘', '聖典', '牧杖'], shop: 'church', atkKey: 'matk' },
  archer: { type: 'bow', names: ['短弓', '長弓', '弩'], shop: 'leather', atkKey: 'atk' },
};

// 副手裝備(新增部位):主要提供生存數值(氣血/防禦)+ 少量攻擊值,武器一樣依職業鎖定。
// 法師的副手是特例——額外附帶「真氣減傷%」(magicDamageReductionPct,固定生效的傷害減免,
// 見 combatEngine.js),取代其他職業靠格擋值(blockRatePct)生存的機制。
export const OFFHAND_TYPE_BY_CLASS = {
  warrior: { names: ['小圓盾', '鳶盾', '塔盾'], shop: 'blacksmith' },
  mage: { names: ['魔導書副冊', '秘紋法印', '奧術聖典'], shop: 'magic' },
  priest: { names: ['聖徽副手', '聖光聖典', '天啟聖書'], shop: 'church' },
  archer: { names: ['箭袋', '強化弓弦', '獵人護臂'], shop: 'leather' },
};

export const ARMOR_NAMES = ['布甲', '皮甲', '鎖甲', '板甲'];
export const ACCESSORY_NAMES = ['護符', '戒指', '項鍊', '徽章'];

// 稀有裝備配方(僅能在對應商店製作,無法透過打怪取得,不設等級門檻——只要材料+金幣足夠就能做)。
// 每間商店、每個裝備部位都有三個階層:普通(只需一般素材,量少價廉,隨時可做)、
// 稀有(需搭配小王/大王掉落的稀有素材)、超稀有(需搭配更高階或更多稀有素材,屬性最強)。
// 三階數值統一用同一參考基準計算(見下方 TIER_MULT),只靠倍率拉開差距,
// 材料取得難度則完全反映在「要打贏哪隻小王/大王」與「材料需求量」上,兩者分開設計避免混淆。
//
// 重要:稀有/超稀有階的「稀有素材」需求對四間商店一律相同(見 RARE_TIER_BOSS_MATS / EPIC_TIER_BOSS_MATS)——
// 打贏哪隻王對所有職業都一樣重要,不會出現「戰士打贏第一章大王有用,牧師打贏卻完全用不到」這種不公平狀況。
// 各商店真正的差異只在於各自的「一般素材」(鐵礦/獸皮羽毛/魔力碎晶/聖水)與裝備名稱、屬性類型(atk/matk)。
const RARE_TIER_BOSS_MATS = { slime_core: 1, boar_fang: 1 }; // 第一章(新手平原)小王+大王,稀有階入門門檻
const EPIC_TIER_BOSS_MATS = {
  captain_insignia: 1, chieftain_totem: 1, spider_silk_gland: 1, golem_core: 1,
  witch_charm: 1, drake_scale: 1, knight_emblem: 1, king_crown_shard: 1,
  party_seal: 2, // 額外要求組隊限定素材——超稀有裝備不能只靠單刷全部大王湊齊,也要真的組過隊打贏王
}; // 第二~五章剩下全部小王+大王,超稀有階代表「打完整個遊戲」的終極門檻
const TIER_STATS = {
  common: { weaponAtk: 20, armorDef: 14, armorHp: 46, accCritPct: 2.8, accHp: 28, accDex: 14 },
  rare: { weaponAtk: 31, armorDef: 22, armorHp: 73, accCritPct: 4.4, accHp: 44, accDex: 22 },
  epic: { weaponAtk: 47, armorDef: 34, armorHp: 109, accCritPct: 6.6, accHp: 66, accDex: 34 },
};
// 副手三階數值:生存向(氣血/防禦約為防具一半)+ 少量攻擊值(約武器三分之一)。
// 非法師職業的 blockPct 是格擋率百分點加成;法師改用 magicReductionPct(真氣減傷%,固定生效)——
// 起始贈送的基礎副手直接對應 common 階(50%減傷),打造更高階可推進到 rare 65%/epic 80%(封頂)。
const OFFHAND_TIER_STATS = {
  common: { hp: 23, def: 7, atk: 7, blockPct: 3, magicReductionPct: 50 },
  rare: { hp: 37, def: 11, atk: 10, blockPct: 5, magicReductionPct: 65 },
  epic: { hp: 55, def: 17, atk: 16, blockPct: 7, magicReductionPct: 80 },
};
const TIER_NAME_ZH = { common: '普通', rare: '稀有', epic: '超稀有', elite_set: '菁英套裝', trueboss_set: '真王套裝' };

// 依商店的攻擊屬性(atk/matk)與部位,組出五個部位×三階層共 15 張配方(武器/防具/副手各1張+飾品2張)。
// 飾品的兩張配方(acc1會心向/acc2氣血向)只是「不同屬性傾向的飾品」,不代表兩個不同格子——
// slot 統一用通用的 accessory,實際要放飾品一或飾品二由玩家裝備時自己選。
function buildShopRecipes(shopId, atkKey, names, tierMaterials, tierGold, offhandNames) {
  const recipes = [];
  const isMage = shopId === 'magic';
  ['common', 'rare', 'epic'].forEach((tier) => {
    const s = TIER_STATS[tier];
    const o = OFFHAND_TIER_STATS[tier];
    const n = names[tier];
    const materials = tierMaterials[tier];
    const gold = tierGold[tier];
    recipes.push({ id: `${shopId}_weapon_${tier}`, name: n.weapon, slot: 'weapon', tier, gold, materials, statBonus: { [atkKey]: s.weaponAtk } });
    recipes.push({ id: `${shopId}_armor_${tier}`, name: n.armor, slot: 'armor', tier, gold, materials, statBonus: { def: s.armorDef, hp: s.armorHp } });
    recipes.push({
      id: `${shopId}_offhand_${tier}`, name: offhandNames[tier], slot: 'offhand', tier, gold, materials,
      statBonus: isMage
        ? { hp: o.hp, [atkKey]: o.atk, magicDamageReductionPct: o.magicReductionPct }
        : { hp: o.hp, def: o.def, [atkKey]: o.atk, blockRatePct: o.blockPct },
    });
    recipes.push({ id: `${shopId}_accessory1_${tier}`, name: n.acc1, slot: 'accessory', tier, gold, materials, statBonus: { critRatePct: s.accCritPct } });
    recipes.push({ id: `${shopId}_accessory2_${tier}`, name: n.acc2, slot: 'accessory', tier, gold, materials, statBonus: { hp: s.accHp } });
    recipes.push({ id: `${shopId}_accessory3_${tier}`, name: n.acc3, slot: 'accessory', tier, gold, materials, statBonus: { dex: s.accDex } });
  });
  return recipes;
}

export const RARE_RECIPES = {
  blacksmith: buildShopRecipes(
    'blacksmith', 'atk',
    {
      common: { weapon: '精鐵劍', armor: '精鐵鎧甲', acc1: '精鐵護符', acc2: '力量護腕', acc3: '精鐵敏捷環' },
      rare: { weapon: '精鋼劍', armor: '鋼骨鎧甲', acc1: '猛豬獠牙墜', acc2: '蠻力腰帶', acc3: '疾風獠牙墜' },
      epic: { weapon: '巨人斷魂劍', armor: '磐岩王者重甲', acc1: '騎士徽記戒', acc2: '巨人之心護環', acc3: '騎士疾影靴' },
    },
    {
      common: { iron_ore: 5 },
      rare: { ...RARE_TIER_BOSS_MATS, iron_ore: 6 },
      epic: { ...EPIC_TIER_BOSS_MATS, iron_ore: 12 },
    },
    { common: 25, rare: 150, epic: 700 },
    { common: '精鐵小圓盾', rare: '鋼骨鳶盾', epic: '巨人斷魂塔盾' }
  ),
  leather: buildShopRecipes(
    'leather', 'atk',
    {
      common: { weapon: '硬化短弓', armor: '硬化皮甲', acc1: '羽紋護符', acc2: '敏捷手環', acc3: '疾行足環' },
      rare: { weapon: '隊長之弓', armor: '蛛絲輕甲', acc1: '隊長徽記戒', acc2: '迅捷腰帶', acc3: '獵風之靴' },
      epic: { weapon: '蛛后長弓', armor: '蛛絲聖鎧', acc1: '蛛絲護符', acc2: '疾風之羽環', acc3: '疾影蛛絲靴' },
    },
    {
      common: { rough_leather: 3, feather: 2 },
      rare: { ...RARE_TIER_BOSS_MATS, rough_leather: 4, feather: 3 },
      epic: { ...EPIC_TIER_BOSS_MATS, rough_leather: 8, feather: 6 },
    },
    { common: 25, rare: 150, epic: 700 },
    { common: '硬化箭袋', rare: '隊長強化弓弦', epic: '蛛絲獵人護臂' }
  ),
  magic: buildShopRecipes(
    'magic', 'matk',
    {
      common: { weapon: '木杖', armor: '學徒法袍', acc1: '碎晶護符', acc2: '魔力手環', acc3: '碎晶敏捷戒' },
      rare: { weapon: '史萊姆核心法杖', armor: '圖騰法袍', acc1: '史萊姆核心戒', acc2: '圖騰腰帶', acc3: '核心迅步環' },
      epic: { weapon: '女巫魔導書', armor: '酋長聖法袍', acc1: '女巫法冠', acc2: '酋長圖騰項鍊', acc3: '女巫疾影靴' },
    },
    {
      common: { crystal_shard: 5 },
      rare: { ...RARE_TIER_BOSS_MATS, crystal_shard: 6 },
      epic: { ...EPIC_TIER_BOSS_MATS, crystal_shard: 12 },
    },
    { common: 25, rare: 150, epic: 700 },
    { common: '魔導書副冊', rare: '史萊姆秘紋法印', epic: '女巫奧術聖典' }
  ),
  church: buildShopRecipes(
    'church', 'matk',
    {
      common: { weapon: '聖杖', armor: '見習聖袍', acc1: '聖水護符', acc2: '信仰手環', acc3: '聖水疾行環' },
      rare: { weapon: '聖水法錘', armor: '聖水聖袍', acc1: '聖水戒', acc2: '聖水腰帶', acc3: '聖水迅捷靴' },
      epic: { weapon: '龍鱗聖錘', armor: '龍鱗聖甲', acc1: '王冠聖珠', acc2: '王冠聖環', acc3: '龍鱗疾影靴' },
    },
    {
      common: { holy_water: 5 },
      rare: { ...RARE_TIER_BOSS_MATS, holy_water: 8 },
      epic: { ...EPIC_TIER_BOSS_MATS, holy_water: 12 },
    },
    { common: 25, rare: 150, epic: 700 },
    { common: '聖水聖徽副手', rare: '聖水聖光聖典', epic: '龍鱗天啟聖書' }
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
// 方塊:洗裝備的「潛能」(隨機百分比詞條),不分部位、任何裝備都能用,見 enhanceEngine.js 的機率與詞條池。
export const ENHANCE_ITEMS = {
  scroll_weapon: { id: 'scroll_weapon', name: '武器強化卷軸', kind: 'scroll', appliesTo: 'weapon', price: 60 },
  scroll_armor: { id: 'scroll_armor', name: '防具強化卷軸', kind: 'scroll', appliesTo: 'armor', price: 60 },
  scroll_offhand: { id: 'scroll_offhand', name: '副手強化卷軸', kind: 'scroll', appliesTo: 'offhand', price: 60 },
  scroll_accessory: { id: 'scroll_accessory', name: '飾品強化卷軸', kind: 'scroll', appliesTo: 'accessory', price: 60 },
  cube_potential: { id: 'cube_potential', name: '潛能方塊', kind: 'cube', appliesTo: 'any', price: 150 },
};
export const ENHANCE_ITEM_ORDER = ['scroll_weapon', 'scroll_armor', 'scroll_offhand', 'scroll_accessory', 'cube_potential'];

export function getEnhanceItem(id) {
  return ENHANCE_ITEMS[id];
}

// 五間商店的基本資訊
export const SHOPS = {
  blacksmith: { id: 'blacksmith', name: '鐵匠鋪', desc: '主副武器與重型裝甲,戰士的根據地。', classAffinity: 'warrior' },
  leather: { id: 'leather', name: '皮革店', desc: '輕型武器與皮甲,弓箭手的補給站。', classAffinity: 'archer' },
  magic: { id: 'magic', name: '法術店', desc: '法杖與法袍,法師的修行之處。', classAffinity: 'mage' },
  church: { id: 'church', name: '教堂', desc: '聖器與聖袍,牧師的信仰之地。', classAffinity: 'priest' },
  general: { id: 'general', name: '雜貨店', desc: '販賣藥水與強化卷軸/潛能方塊,也回收各種戰利品雜物。', classAffinity: null },
};
export const SHOP_ORDER = ['blacksmith', 'leather', 'magic', 'church', 'general'];

export function getShop(id) {
  return SHOPS[id];
}
