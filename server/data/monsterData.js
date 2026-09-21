// 怪物資料(奇幻練功MMO):明確標示等級/經驗/HP/ATK/DEF,依此判斷玩家能否輕鬆應付。
// 每隻怪物皆有 dropTable:可販售雜物(交給雜貨店回收換錢)+ 對應商店的製作素材,
// 怪物擊殺「不會」直接掉錢——金幣完全來自把 dropTable 換來的東西拿去店舖賣掉。
// 小王/大王(菁英)只會掉「簡單」的強化卷軸(一般 scroll_*)與隨機的潛能方塊(cube_potential);
// 抉擇方塊(cube_potential_choice,固定洗3條可預覽詞條)與「更強」的王家卷軸(scroll_*_royal,
// 數值範圍比一般卷軸更好)兩者都只有真王才會掉,兩個等級的王掉落的東西不能混淆——
// 這樣玩家才有動機想辦法遇到真王,不是隨便打小王大王就能拿到頂級強化道具。
const CUBE_CHOICE_DROP = { id: 'cube_potential_choice', kind: 'cube_choice', chance: 1, min: 0, max: 2 };
const MINIBOSS_ENHANCE_DROPS = [
  { id: 'scroll_weapon', kind: 'scroll', chance: 0.15, min: 1, max: 1 },
  { id: 'scroll_armor', kind: 'scroll', chance: 0.15, min: 1, max: 1 },
  { id: 'scroll_accessory', kind: 'scroll', chance: 0.15, min: 1, max: 1 },
  { id: 'cube_potential', kind: 'cube', chance: 0.1, min: 1, max: 1 },
];
const BOSS_ENHANCE_DROPS = [
  { id: 'scroll_weapon', kind: 'scroll', chance: 0.2, min: 1, max: 1 },
  { id: 'scroll_armor', kind: 'scroll', chance: 0.2, min: 1, max: 1 },
  { id: 'scroll_accessory', kind: 'scroll', chance: 0.2, min: 1, max: 1 },
  { id: 'cube_potential', kind: 'cube', chance: 0.15, min: 1, max: 1 },
];
// 真王(每張地圖獨一無二的終極首領)掉落:全部換成「王家卷軸」(數值範圍比一般卷軸更好,
// 見 enhanceEngine.js 的 isRoyal),不再掉簡單卷軸,加上普通方塊+抉擇方塊,比小王/大王豐厚許多。
const TRUEBOSS_ENHANCE_DROPS = [
  { id: 'scroll_weapon_royal', kind: 'scroll_royal', chance: 0.35, min: 1, max: 2 },
  { id: 'scroll_armor_royal', kind: 'scroll_royal', chance: 0.35, min: 1, max: 2 },
  { id: 'scroll_offhand_royal', kind: 'scroll_royal', chance: 0.3, min: 1, max: 1 },
  { id: 'scroll_accessory_royal', kind: 'scroll_royal', chance: 0.35, min: 1, max: 2 },
  { id: 'cube_potential', kind: 'cube', chance: 0.3, min: 1, max: 1 },
  CUBE_CHOICE_DROP,
];
// 套裝製作素材:刻意「不保底」,可能什麼都拿不到(數量含0)——套裝比一般裝備強,材料理應比
// 一般鍛材更稀有難拿,兩者的稀有度不能顛倒。菁英(miniboss/boss)掉落該地圖的「菁英碎片」
// (0~2個),真王掉落「真王結晶」(0~3個,終極真王額外覆寫到0~4),兩者皆用於在商店製作對應
// 套裝(見 setGearData.js)。
// 註:舊制的「稀有素材」(rare_material,如史萊姆核心/騎士徽章等)與「組隊限定素材」
// (party_material,團隊戰印)原本對應已被裝備地圖化取代的舊 rare/epic 裝備配方,現在完全沒有
// 任何配方會用到,已從全部怪物 dropTable 移除、不再掉落,避免玩家打了王卻拿到「找不到地方用」
// 的材料。ITEMS 定義本身保留(itemData.js),讓玩家過去已持有的存量仍能正常賣給雜貨店回收,
// 不會卡在背包裡動彈不得。
function eliteShardDrop(mapId) {
  return { id: `elite_shard_${mapId}`, kind: 'set_material', chance: 1, min: 0, max: 2 };
}
function trueBossCrystalDrop(mapId) {
  return { id: `trueboss_crystal_${mapId}`, kind: 'set_material', chance: 1, min: 0, max: 3 };
}

// 小王/大王的戰鬥機制(一般小怪不套用,維持簡單):
// - physicalResistPct / magicResistPct:對該傷害類型的抗性(正值減傷、負值代表弱點增傷),
//   讓「派哪個職業去打這隻王」變成真正的策略選擇,而不是誰打都一樣。
// - enrageHpPct / enrageAtkMult:血量低於門檻時觸發狂暴,攻擊力永久提升,製造「速戰速決」的壓力。
// - chargeSkill:每隔數回合蓄力一次,蓄力當回合不攻擊、明確預警,下回合爆發高倍傷害——
//   讓玩家有「這回合該不該防禦」的即時判斷,而不是無腦攻擊到底。
const ENRAGE_DEFAULT = { enrageHpPct: 0.3, enrageAtkMult: 1.35 };
export const MONSTERS = {
  // ---- 新手平原(Lv1~6) ----
  slime: {
    id: 'slime', name: '史萊姆', level: 1, hp: 25, atk: 4, def: 1, critRate: 0.05, exp: 8,
    dropTable: [
      { id: 'slime_jelly', kind: 'junk', chance: 0.6, min: 1, max: 2 },
      { id: 'gear_material_novice_plains', kind: 'material', chance: 0.3, min: 1, max: 2 },
    ],
  },
  wild_boar: {
    id: 'wild_boar', name: '野豬', level: 3, hp: 45, atk: 7, def: 3, critRate: 0.08, exp: 14,
    dropTable: [
      { id: 'boar_hide', kind: 'junk', chance: 0.55, min: 1, max: 2 },
      { id: 'gear_material_novice_plains', kind: 'material', chance: 0.5, min: 1, max: 2 },
    ],
  },
  slime_king: {
    id: 'slime_king', name: '史萊姆王', level: 6, hp: 260, atk: 12, def: 5, critRate: 0.08, exp: 90, tier: 'miniboss',
    physicalResistPct: -0.15, magicResistPct: 0.15, // 黏液之軀:físico容易砍中(弱)、魔法難以穿透(抗)
    ...ENRAGE_DEFAULT,
    chargeSkill: { name: '黏液噴濺', telegraphText: '的軀體開始劇烈鼓動,似乎在醞釀噴發!', triggerEveryTurns: 4, dmgMult: 2.2 },
    dropTable: [
      { id: 'slime_jelly', kind: 'junk', chance: 1, min: 3, max: 6 },
      eliteShardDrop('novice_plains'),
      ...MINIBOSS_ENHANCE_DROPS,
    ],
  },
  boar_lord: {
    id: 'boar_lord', name: '巨牙野豬王', level: 8, hp: 480, atk: 18, def: 8, critRate: 0.1, exp: 220, tier: 'boss',
    physicalResistPct: 0.15, magicResistPct: -0.15, // 厚皮硬骨:扛得住物理、怕魔法
    ...ENRAGE_DEFAULT,
    chargeSkill: { name: '狂怒衝撞', telegraphText: '刨地怒吼,蓄勢待發準備衝鋒!', triggerEveryTurns: 4, dmgMult: 2.4 },
    dropTable: [
      { id: 'boar_hide', kind: 'junk', chance: 1, min: 4, max: 8 },
      eliteShardDrop('novice_plains'),
      ...BOSS_ENHANCE_DROPS,
    ],
  },
  // 真王(每張地圖獨一無二的終極首領,強度抓在「兩張地圖之後」的量級):不是明確挑戰按鈕,
  // 一樣是隨機遭遇(機率遠低於菁英),全服共用重生計時(見 worldBossEngine.js),不是個人各自獨立進度。
  ancient_treant_king: {
    id: 'ancient_treant_king', name: '上古樹靈王', level: 22, hp: 1750, atk: 38, def: 27, critRate: 0.14, exp: 1900, tier: 'trueboss',
    physicalResistPct: 0.2, magicResistPct: -0.15, // 巨木軀體:硬扛物理,怕火系/魔法燃燒
    enrageHpPct: 0.3, enrageAtkMult: 1.5,
    chargeSkill: { name: '巨木衝撞', telegraphText: '龐大的身軀開始積蓄力量,樹根深深沒入大地!', triggerEveryTurns: 3, dmgMult: 2.8 },
    dropTable: [
      { id: 'slime_jelly', kind: 'junk', chance: 1, min: 10, max: 16 },
      trueBossCrystalDrop('novice_plains'),
      ...TRUEBOSS_ENHANCE_DROPS,
    ],
  },

  // ---- 哥布林森林(Lv5~12) ----
  goblin: {
    id: 'goblin', name: '哥布林', level: 6, hp: 60, atk: 9, def: 4, critRate: 0.08, exp: 20,
    dropTable: [
      { id: 'goblin_ear', kind: 'junk', chance: 0.6, min: 1, max: 2 },
      { id: 'gear_material_goblin_forest', kind: 'material', chance: 0.2, min: 1, max: 2 },
    ],
  },
  goblin_archer: {
    id: 'goblin_archer', name: '哥布林弓兵', level: 8, hp: 55, atk: 12, def: 3, critRate: 0.15, exp: 26,
    dropTable: [
      { id: 'goblin_bow_string', kind: 'junk', chance: 0.5, min: 1, max: 2 },
      { id: 'gear_material_goblin_forest', kind: 'material', chance: 0.25, min: 1, max: 2 },
    ],
  },
  goblin_captain: {
    id: 'goblin_captain', name: '哥布林隊長', level: 12, hp: 520, atk: 13, def: 10, critRate: 0.12, exp: 260, tier: 'miniboss',
    physicalResistPct: 0.1, magicResistPct: -0.1, // 披甲士兵:略抗物理、略怕魔法
    ...ENRAGE_DEFAULT,
    chargeSkill: { name: '蓄力重斬', telegraphText: '將兵器高高舉起,似乎要使出全力一擊!', triggerEveryTurns: 4, dmgMult: 2.3 },
    dropTable: [
      { id: 'goblin_ear', kind: 'junk', chance: 1, min: 4, max: 7 },
      eliteShardDrop('goblin_forest'),
      ...MINIBOSS_ENHANCE_DROPS,
    ],
  },
  goblin_chieftain: {
    id: 'goblin_chieftain', name: '哥布林酋長', level: 14, hp: 950, atk: 23, def: 14, critRate: 0.14, exp: 620, tier: 'boss',
    physicalResistPct: 0.15, magicResistPct: -0.15, // 重甲統帥:更抗物理、更怕魔法
    ...ENRAGE_DEFAULT,
    chargeSkill: { name: '酋長怒吼衝擊', telegraphText: '高舉戰斧仰天怒吼,殺氣逐漸凝聚!', triggerEveryTurns: 4, dmgMult: 2.5 },
    dropTable: [
      { id: 'goblin_bow_string', kind: 'junk', chance: 1, min: 5, max: 9 },
      eliteShardDrop('goblin_forest'),
      ...BOSS_ENHANCE_DROPS,
    ],
  },
  goblin_emperor: {
    id: 'goblin_emperor', name: '哥布林大帝', level: 28, hp: 2500, atk: 53, def: 33, critRate: 0.18, exp: 3000, tier: 'trueboss',
    physicalResistPct: 0.25, magicResistPct: -0.2, // 全軍統帥的重甲防護:更扛物理,魔法仍是弱點
    enrageHpPct: 0.3, enrageAtkMult: 1.55,
    chargeSkill: { name: '帝王審判斬', telegraphText: '高舉象徵至高權柄的巨斧,全軍為之震懾!', triggerEveryTurns: 3, dmgMult: 2.9 },
    dropTable: [
      { id: 'goblin_ear', kind: 'junk', chance: 1, min: 12, max: 18 },
      trueBossCrystalDrop('goblin_forest'),
      ...TRUEBOSS_ENHANCE_DROPS,
    ],
  },

  // ---- 石化礦坑(Lv10~18) ----
  stone_bat: {
    id: 'stone_bat', name: '石化蝙蝠', level: 11, hp: 90, atk: 16, def: 6, critRate: 0.1, exp: 40,
    dropTable: [
      { id: 'bat_wing', kind: 'junk', chance: 0.55, min: 1, max: 2 },
      { id: 'gear_material_stone_mines', kind: 'material', chance: 0.2, min: 1, max: 2 },
    ],
  },
  mine_rat: {
    id: 'mine_rat', name: '礦坑狂鼠', level: 13, hp: 110, atk: 18, def: 7, critRate: 0.1, exp: 48,
    dropTable: [
      { id: 'rat_tail', kind: 'junk', chance: 0.55, min: 1, max: 2 },
      { id: 'gear_material_stone_mines', kind: 'material', chance: 0.25, min: 2, max: 3 },
    ],
  },
  mine_spider_queen: {
    id: 'mine_spider_queen', name: '礦坑蜘蛛后', level: 18, hp: 830, atk: 16, def: 16, critRate: 0.15, exp: 520, tier: 'miniboss',
    physicalResistPct: -0.15, magicResistPct: 0.15, // 節肢軀體怕物理、絲網體質抗魔法
    ...ENRAGE_DEFAULT,
    chargeSkill: { name: '蛛絲纏繞', telegraphText: '吐出大量蛛絲,似乎在準備一記致命纏繞!', triggerEveryTurns: 4, dmgMult: 2.3 },
    dropTable: [
      { id: 'bat_wing', kind: 'junk', chance: 1, min: 5, max: 8 },
      eliteShardDrop('stone_mines'),
      ...MINIBOSS_ENHANCE_DROPS,
    ],
  },
  stone_golem: {
    id: 'stone_golem', name: '石巨人', level: 20, hp: 1510, atk: 34, def: 24, critRate: 0.1, exp: 1350, tier: 'boss',
    physicalResistPct: 0.3, magicResistPct: -0.2, // 全身岩石:重扛物理,但法術能直接打入裂縫
    ...ENRAGE_DEFAULT,
    chargeSkill: { name: '碎石重擊', telegraphText: '緩緩舉起巨大的石拳,大地為之震動!', triggerEveryTurns: 4, dmgMult: 2.6 },
    dropTable: [
      { id: 'rat_tail', kind: 'junk', chance: 1, min: 6, max: 10 },
      eliteShardDrop('stone_mines'),
      ...BOSS_ENHANCE_DROPS,
    ],
  },
  abyssal_stone_dragon: {
    id: 'abyssal_stone_dragon', name: '深淵岩龍', level: 32, hp: 3300, atk: 67, def: 44, critRate: 0.16, exp: 4400, tier: 'trueboss',
    physicalResistPct: 0.35, magicResistPct: -0.25, // 岩石與龍軀雙重防護:極度扛物理,但深埋礦脈的裂縫仍怕魔法貫穿
    enrageHpPct: 0.3, enrageAtkMult: 1.6,
    chargeSkill: { name: '深淵崩裂吐息', telegraphText: '深邃的雙眼泛起幽光,礦坑深處傳來震耳欲聾的低鳴!', triggerEveryTurns: 3, dmgMult: 3.0 },
    dropTable: [
      { id: 'rat_tail', kind: 'junk', chance: 1, min: 14, max: 20 },
      trueBossCrystalDrop('stone_mines'),
      ...TRUEBOSS_ENHANCE_DROPS,
    ],
  },

  // ---- 幽暗沼澤(Lv16~24) ----
  swamp_tentacle: {
    id: 'swamp_tentacle', name: '沼澤觸手', level: 17, hp: 160, atk: 28, def: 12, critRate: 0.1, exp: 95,
    dropTable: [
      { id: 'tentacle_ooze', kind: 'junk', chance: 0.55, min: 1, max: 2 },
      { id: 'gear_material_dark_swamp', kind: 'material', chance: 0.2, min: 1, max: 1 },
    ],
  },
  toxic_toad: {
    id: 'toxic_toad', name: '毒沼蟾蜍', level: 19, hp: 180, atk: 32, def: 14, critRate: 0.1, exp: 110,
    dropTable: [
      { id: 'toad_venom_sac', kind: 'junk', chance: 0.55, min: 1, max: 2 },
      { id: 'gear_material_dark_swamp', kind: 'material', chance: 0.25, min: 1, max: 2 },
    ],
  },
  swamp_witch: {
    id: 'swamp_witch', name: '沼澤女巫', level: 24, hp: 1220, atk: 23, def: 22, critRate: 0.18, exp: 980, tier: 'miniboss',
    physicalResistPct: -0.15, magicResistPct: 0.25, // 施法者體質:近戰打得動,但自身法術屏障抗魔
    ...ENRAGE_DEFAULT,
    chargeSkill: { name: '詛咒凝聚', telegraphText: '喃喃念咒,周身黑氣逐漸凝聚成形!', triggerEveryTurns: 4, dmgMult: 2.4 },
    dropTable: [
      { id: 'tentacle_ooze', kind: 'junk', chance: 1, min: 6, max: 9 },
      eliteShardDrop('dark_swamp'),
      ...MINIBOSS_ENHANCE_DROPS,
    ],
  },
  swamp_drake: {
    id: 'swamp_drake', name: '遠古沼澤龍', level: 26, hp: 2210, atk: 48, def: 30, critRate: 0.15, exp: 2400, tier: 'boss',
    physicalResistPct: -0.1, magicResistPct: 0.2, // 古龍鱗片:天生抗魔,鱗片縫隙仍可被物理攻擊突破
    ...ENRAGE_DEFAULT,
    chargeSkill: { name: '沼氣吐息', telegraphText: '深吸一口氣,喉間泛起詭異的綠光!', triggerEveryTurns: 4, dmgMult: 2.6 },
    dropTable: [
      { id: 'toad_venom_sac', kind: 'junk', chance: 1, min: 7, max: 11 },
      eliteShardDrop('dark_swamp'),
      ...BOSS_ENHANCE_DROPS,
    ],
  },
  ancient_swamp_deity: {
    id: 'ancient_swamp_deity', name: '太古沼澤邪神', level: 35, hp: 4200, atk: 78, def: 52, critRate: 0.2, exp: 5600, tier: 'trueboss',
    physicalResistPct: 0.15, magicResistPct: 0.15, // 邪神體質:對兩種傷害皆有相當抗性,不再有明顯弱點屬性
    enrageHpPct: 0.3, enrageAtkMult: 1.65,
    chargeSkill: { name: '混沌深淵吞噬', telegraphText: '沼澤深處泛起詭異漩渦,無數黑影自水面下浮現!', triggerEveryTurns: 3, dmgMult: 3.1 },
    dropTable: [
      { id: 'tentacle_ooze', kind: 'junk', chance: 1, min: 16, max: 22 },
      trueBossCrystalDrop('dark_swamp'),
      ...TRUEBOSS_ENHANCE_DROPS,
    ],
  },

  // ---- 遺跡邊境(Lv22~30) ----
  ruin_guardian: {
    id: 'ruin_guardian', name: '遺跡守衛', level: 23, hp: 260, atk: 46, def: 20, critRate: 0.12, exp: 180,
    dropTable: [
      { id: 'guardian_plating', kind: 'junk', chance: 0.55, min: 1, max: 2 },
      { id: 'gear_material_ruined_borderlands', kind: 'material', chance: 0.3, min: 2, max: 4 },
    ],
  },
  shadow_blade: {
    id: 'shadow_blade', name: '暗影劍士', level: 25, hp: 240, atk: 52, def: 18, critRate: 0.2, exp: 210,
    dropTable: [
      { id: 'shadow_fragment', kind: 'junk', chance: 0.55, min: 1, max: 2 },
      { id: 'gear_material_ruined_borderlands', kind: 'material', chance: 0.3, min: 2, max: 4 },
    ],
  },
  fallen_knight: {
    id: 'fallen_knight', name: '墮落騎士', level: 29, hp: 1550, atk: 32, def: 32, critRate: 0.18, exp: 1600, tier: 'miniboss',
    physicalResistPct: 0.2, magicResistPct: -0.15, // 一身重鎧:扛物理,但詛咒纏身怕魔法
    ...ENRAGE_DEFAULT,
    chargeSkill: { name: '絕望重劈', telegraphText: '雙手緊握巨劍高舉過頂,散發不祥的氣息!', triggerEveryTurns: 4, dmgMult: 2.5 },
    dropTable: [
      { id: 'guardian_plating', kind: 'junk', chance: 1, min: 7, max: 10 },
      eliteShardDrop('ruined_borderlands'),
      ...MINIBOSS_ENHANCE_DROPS,
    ],
  },
  king_of_ruins: {
    id: 'king_of_ruins', name: '遺跡之王', level: 30, hp: 2820, atk: 61, def: 40, critRate: 0.2, exp: 3800, tier: 'boss',
    physicalResistPct: 0.1, magicResistPct: 0.1, // 終極王者:對兩種傷害皆有一定抗性,真正的挑戰在於狂暴與蓄力節奏
    enrageHpPct: 0.35, enrageAtkMult: 1.5,
    chargeSkill: { name: '王座審判', telegraphText: '緩緩起身,王座周圍的遺跡碎石開始漂浮!', triggerEveryTurns: 3, dmgMult: 2.8 },
    dropTable: [
      { id: 'shadow_fragment', kind: 'junk', chance: 1, min: 8, max: 12 },
      eliteShardDrop('ruined_borderlands'),
      ...BOSS_ENHANCE_DROPS,
    ],
  },
  primordial_ruin_overlord: {
    id: 'primordial_ruin_overlord', name: '太初遺跡神皇', level: 38, hp: 5600, atk: 92, def: 62, critRate: 0.22, exp: 7500, tier: 'trueboss',
    physicalResistPct: 0.2, magicResistPct: 0.2, // 全遊戲最強的存在:對兩種傷害皆有顯著抗性,真正的終極試煉
    enrageHpPct: 0.35, enrageAtkMult: 1.7,
    chargeSkill: { name: '神皇終焉審判', telegraphText: '太初遺跡的碎石盡數浮起,籠罩在令人窒息的絕對威壓之下!', triggerEveryTurns: 2, dmgMult: 3.3 },
    dropTable: [
      { id: 'shadow_fragment', kind: 'junk', chance: 1, min: 18, max: 25 },
      { ...trueBossCrystalDrop('ruined_borderlands'), max: 4 }, // 終極真王:結晶數量上限比其他四隻更高(0~4,其餘皆0~3)
      ...TRUEBOSS_ENHANCE_DROPS,
    ],
  },
};

export function getMonster(id) {
  return MONSTERS[id];
}

// 地圖資料:每張地圖對應等級區間、2~5關的闖蕩旅程長度、普通怪池、專屬菁英(miniBoss/boss,原小王/大王,
// 移除重生冷卻改為隨時可能遭遇)與真王(trueBoss,每張地圖獨一無二的終極首領,全服共用重生計時,
// 需在地圖畫面主動點擊挑戰,見 worldBossEngine.js)。
export const MAPS = {
  novice_plains: {
    id: 'novice_plains', name: '新手平原', levelRange: [1, 6], minStages: 2, maxStages: 3,
    monsterPool: ['slime', 'wild_boar'],
    miniBoss: 'slime_king',
    boss: 'boar_lord',
    trueBoss: 'ancient_treant_king', trueBossRespawnMin: 3,
    maxEnemiesPerFight: 2,
  },
  goblin_forest: {
    id: 'goblin_forest', name: '哥布林森林', levelRange: [5, 12], minStages: 3, maxStages: 4,
    monsterPool: ['goblin', 'goblin_archer'],
    miniBoss: 'goblin_captain',
    boss: 'goblin_chieftain',
    trueBoss: 'goblin_emperor', trueBossRespawnMin: 3,
    maxEnemiesPerFight: 2,
  },
  stone_mines: {
    id: 'stone_mines', name: '石化礦坑', levelRange: [10, 18], minStages: 4, maxStages: 4,
    monsterPool: ['stone_bat', 'mine_rat'],
    miniBoss: 'mine_spider_queen',
    boss: 'stone_golem',
    trueBoss: 'abyssal_stone_dragon', trueBossRespawnMin: 3,
    maxEnemiesPerFight: 3,
  },
  dark_swamp: {
    id: 'dark_swamp', name: '幽暗沼澤', levelRange: [16, 24], minStages: 4, maxStages: 5,
    monsterPool: ['swamp_tentacle', 'toxic_toad'],
    miniBoss: 'swamp_witch',
    boss: 'swamp_drake',
    trueBoss: 'ancient_swamp_deity', trueBossRespawnMin: 3,
    maxEnemiesPerFight: 3,
  },
  ruined_borderlands: {
    id: 'ruined_borderlands', name: '遺跡邊境', levelRange: [22, 30], minStages: 5, maxStages: 5,
    monsterPool: ['ruin_guardian', 'shadow_blade'],
    miniBoss: 'fallen_knight',
    boss: 'king_of_ruins',
    trueBoss: 'primordial_ruin_overlord', trueBossRespawnMin: 3,
    maxEnemiesPerFight: 3,
  },
};

export const MAP_ORDER = ['novice_plains', 'goblin_forest', 'stone_mines', 'dark_swamp', 'ruined_borderlands'];

export function getMap(id) {
  return MAPS[id];
}
