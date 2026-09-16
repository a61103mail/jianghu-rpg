// 怪物資料(奇幻練功MMO):明確標示等級/經驗/HP/ATK/DEF,依此判斷玩家能否輕鬆應付。
// 每隻怪物皆有 dropTable:可販售雜物(交給雜貨店回收換錢)+ 對應商店的製作素材,
// 怪物擊殺「不會」直接掉錢——金幣完全來自把 dropTable 換來的東西拿去店舖賣掉。
// 小王/大王額外會有機率掉落強化卷軸/潛能方塊(裝備強化用消耗品),不必完全依賴雜貨店購買。
const MINIBOSS_ENHANCE_DROPS = [
  { id: 'scroll_weapon', kind: 'scroll', chance: 0.15, min: 1, max: 1 },
  { id: 'scroll_armor', kind: 'scroll', chance: 0.15, min: 1, max: 1 },
  { id: 'scroll_accessory', kind: 'scroll', chance: 0.15, min: 1, max: 1 },
];
const BOSS_ENHANCE_DROPS = [
  { id: 'scroll_weapon', kind: 'scroll', chance: 0.2, min: 1, max: 1 },
  { id: 'scroll_armor', kind: 'scroll', chance: 0.2, min: 1, max: 1 },
  { id: 'scroll_accessory', kind: 'scroll', chance: 0.2, min: 1, max: 1 },
  { id: 'cube_potential', kind: 'cube', chance: 0.15, min: 1, max: 1 },
];
export const MONSTERS = {
  // ---- 新手平原(Lv1~6) ----
  slime: {
    id: 'slime', name: '史萊姆', level: 1, hp: 25, atk: 4, def: 1, critRate: 0.05, exp: 8,
    dropTable: [
      { id: 'slime_jelly', kind: 'junk', chance: 0.6, min: 1, max: 2 },
      { id: 'iron_ore', kind: 'material', shop: 'blacksmith', chance: 0.15, min: 1, max: 1 },
      { id: 'crystal_shard', kind: 'material', shop: 'magic', chance: 0.15, min: 1, max: 1 },
    ],
  },
  wild_boar: {
    id: 'wild_boar', name: '野豬', level: 3, hp: 45, atk: 7, def: 3, critRate: 0.08, exp: 14,
    dropTable: [
      { id: 'boar_hide', kind: 'junk', chance: 0.55, min: 1, max: 2 },
      { id: 'rough_leather', kind: 'material', shop: 'leather', chance: 0.2, min: 1, max: 1 },
      { id: 'feather', kind: 'material', shop: 'leather', chance: 0.15, min: 1, max: 1 },
      { id: 'holy_water', kind: 'material', shop: 'church', chance: 0.15, min: 1, max: 1 },
    ],
  },
  slime_king: {
    id: 'slime_king', name: '史萊姆王', level: 6, hp: 260, atk: 12, def: 5, critRate: 0.08, exp: 90, tier: 'miniboss',
    dropTable: [
      { id: 'slime_core', kind: 'rare_material', shop: 'magic', chance: 0.4, min: 1, max: 1 },
      { id: 'slime_jelly', kind: 'junk', chance: 1, min: 3, max: 6 },
      ...MINIBOSS_ENHANCE_DROPS,
    ],
  },
  boar_lord: {
    id: 'boar_lord', name: '巨牙野豬王', level: 8, hp: 480, atk: 18, def: 8, critRate: 0.1, exp: 220, tier: 'boss',
    dropTable: [
      { id: 'boar_fang', kind: 'rare_material', shop: 'blacksmith', chance: 0.5, min: 1, max: 2 },
      { id: 'boar_hide', kind: 'junk', chance: 1, min: 4, max: 8 },
      ...BOSS_ENHANCE_DROPS,
    ],
  },

  // ---- 哥布林森林(Lv5~12) ----
  goblin: {
    id: 'goblin', name: '哥布林', level: 6, hp: 60, atk: 9, def: 4, critRate: 0.08, exp: 20,
    dropTable: [
      { id: 'goblin_ear', kind: 'junk', chance: 0.6, min: 1, max: 2 },
      { id: 'iron_ore', kind: 'material', shop: 'blacksmith', chance: 0.2, min: 1, max: 2 },
    ],
  },
  goblin_archer: {
    id: 'goblin_archer', name: '哥布林弓兵', level: 8, hp: 55, atk: 12, def: 3, critRate: 0.15, exp: 26,
    dropTable: [
      { id: 'goblin_bow_string', kind: 'junk', chance: 0.5, min: 1, max: 2 },
      { id: 'feather', kind: 'material', shop: 'leather', chance: 0.25, min: 1, max: 2 },
    ],
  },
  goblin_captain: {
    id: 'goblin_captain', name: '哥布林隊長', level: 12, hp: 520, atk: 13, def: 10, critRate: 0.12, exp: 260, tier: 'miniboss',
    dropTable: [
      { id: 'captain_insignia', kind: 'rare_material', shop: 'leather', chance: 0.4, min: 1, max: 1 },
      { id: 'goblin_ear', kind: 'junk', chance: 1, min: 4, max: 7 },
      ...MINIBOSS_ENHANCE_DROPS,
    ],
  },
  goblin_chieftain: {
    id: 'goblin_chieftain', name: '哥布林酋長', level: 14, hp: 950, atk: 23, def: 14, critRate: 0.14, exp: 620, tier: 'boss',
    dropTable: [
      { id: 'chieftain_totem', kind: 'rare_material', shop: 'magic', chance: 0.5, min: 1, max: 2 },
      { id: 'goblin_bow_string', kind: 'junk', chance: 1, min: 5, max: 9 },
      ...BOSS_ENHANCE_DROPS,
    ],
  },

  // ---- 石化礦坑(Lv10~18) ----
  stone_bat: {
    id: 'stone_bat', name: '石化蝙蝠', level: 11, hp: 90, atk: 16, def: 6, critRate: 0.1, exp: 40,
    dropTable: [
      { id: 'bat_wing', kind: 'junk', chance: 0.55, min: 1, max: 2 },
      { id: 'crystal_shard', kind: 'material', shop: 'magic', chance: 0.2, min: 1, max: 2 },
    ],
  },
  mine_rat: {
    id: 'mine_rat', name: '礦坑狂鼠', level: 13, hp: 110, atk: 18, def: 7, critRate: 0.1, exp: 48,
    dropTable: [
      { id: 'rat_tail', kind: 'junk', chance: 0.55, min: 1, max: 2 },
      { id: 'iron_ore', kind: 'material', shop: 'blacksmith', chance: 0.25, min: 2, max: 3 },
    ],
  },
  mine_spider_queen: {
    id: 'mine_spider_queen', name: '礦坑蜘蛛后', level: 18, hp: 830, atk: 16, def: 16, critRate: 0.15, exp: 520, tier: 'miniboss',
    dropTable: [
      { id: 'spider_silk_gland', kind: 'rare_material', shop: 'leather', chance: 0.4, min: 1, max: 1 },
      { id: 'bat_wing', kind: 'junk', chance: 1, min: 5, max: 8 },
      ...MINIBOSS_ENHANCE_DROPS,
    ],
  },
  stone_golem: {
    id: 'stone_golem', name: '石巨人', level: 20, hp: 1510, atk: 34, def: 24, critRate: 0.1, exp: 1350, tier: 'boss',
    dropTable: [
      { id: 'golem_core', kind: 'rare_material', shop: 'blacksmith', chance: 0.5, min: 1, max: 2 },
      { id: 'rat_tail', kind: 'junk', chance: 1, min: 6, max: 10 },
      ...BOSS_ENHANCE_DROPS,
    ],
  },

  // ---- 幽暗沼澤(Lv16~24) ----
  swamp_tentacle: {
    id: 'swamp_tentacle', name: '沼澤觸手', level: 17, hp: 160, atk: 28, def: 12, critRate: 0.1, exp: 95,
    dropTable: [
      { id: 'tentacle_ooze', kind: 'junk', chance: 0.55, min: 1, max: 2 },
      { id: 'holy_water', kind: 'material', shop: 'church', chance: 0.2, min: 1, max: 1 },
    ],
  },
  toxic_toad: {
    id: 'toxic_toad', name: '毒沼蟾蜍', level: 19, hp: 180, atk: 32, def: 14, critRate: 0.1, exp: 110,
    dropTable: [
      { id: 'toad_venom_sac', kind: 'junk', chance: 0.55, min: 1, max: 2 },
      { id: 'crystal_shard', kind: 'material', shop: 'magic', chance: 0.25, min: 1, max: 2 },
    ],
  },
  swamp_witch: {
    id: 'swamp_witch', name: '沼澤女巫', level: 24, hp: 1220, atk: 23, def: 22, critRate: 0.18, exp: 980, tier: 'miniboss',
    dropTable: [
      { id: 'witch_charm', kind: 'rare_material', shop: 'magic', chance: 0.4, min: 1, max: 1 },
      { id: 'tentacle_ooze', kind: 'junk', chance: 1, min: 6, max: 9 },
      ...MINIBOSS_ENHANCE_DROPS,
    ],
  },
  swamp_drake: {
    id: 'swamp_drake', name: '遠古沼澤龍', level: 26, hp: 2210, atk: 48, def: 30, critRate: 0.15, exp: 2400, tier: 'boss',
    dropTable: [
      { id: 'drake_scale', kind: 'rare_material', shop: 'church', chance: 0.5, min: 1, max: 2 },
      { id: 'toad_venom_sac', kind: 'junk', chance: 1, min: 7, max: 11 },
      ...BOSS_ENHANCE_DROPS,
    ],
  },

  // ---- 遺跡邊境(Lv22~30) ----
  ruin_guardian: {
    id: 'ruin_guardian', name: '遺跡守衛', level: 23, hp: 260, atk: 46, def: 20, critRate: 0.12, exp: 180,
    dropTable: [
      { id: 'guardian_plating', kind: 'junk', chance: 0.55, min: 1, max: 2 },
      { id: 'iron_ore', kind: 'material', shop: 'blacksmith', chance: 0.3, min: 2, max: 4 },
    ],
  },
  shadow_blade: {
    id: 'shadow_blade', name: '暗影劍士', level: 25, hp: 240, atk: 52, def: 18, critRate: 0.2, exp: 210,
    dropTable: [
      { id: 'shadow_fragment', kind: 'junk', chance: 0.55, min: 1, max: 2 },
      { id: 'feather', kind: 'material', shop: 'leather', chance: 0.3, min: 2, max: 4 },
    ],
  },
  fallen_knight: {
    id: 'fallen_knight', name: '墮落騎士', level: 29, hp: 1550, atk: 32, def: 32, critRate: 0.18, exp: 1600, tier: 'miniboss',
    dropTable: [
      { id: 'knight_emblem', kind: 'rare_material', shop: 'blacksmith', chance: 0.45, min: 1, max: 1 },
      { id: 'guardian_plating', kind: 'junk', chance: 1, min: 7, max: 10 },
      ...MINIBOSS_ENHANCE_DROPS,
    ],
  },
  king_of_ruins: {
    id: 'king_of_ruins', name: '遺跡之王', level: 30, hp: 2820, atk: 61, def: 40, critRate: 0.2, exp: 3800, tier: 'boss',
    dropTable: [
      { id: 'king_crown_shard', kind: 'rare_material', shop: 'church', chance: 0.55, min: 1, max: 2 },
      { id: 'shadow_fragment', kind: 'junk', chance: 1, min: 8, max: 12 },
      ...BOSS_ENHANCE_DROPS,
    ],
  },
};

export function getMonster(id) {
  return MONSTERS[id];
}

// 地圖資料:每張地圖對應等級區間、2~5關的闖蕩旅程長度、普通怪池、專屬小王與大王(各自獨立重生計時)。
export const MAPS = {
  novice_plains: {
    id: 'novice_plains', name: '新手平原', levelRange: [1, 6], minStages: 2, maxStages: 3,
    monsterPool: ['slime', 'wild_boar'],
    miniBoss: 'slime_king', miniBossRespawnMin: 5,
    boss: 'boar_lord', bossRespawnMin: 10,
    maxEnemiesPerFight: 2,
  },
  goblin_forest: {
    id: 'goblin_forest', name: '哥布林森林', levelRange: [5, 12], minStages: 3, maxStages: 4,
    monsterPool: ['goblin', 'goblin_archer'],
    miniBoss: 'goblin_captain', miniBossRespawnMin: 5,
    boss: 'goblin_chieftain', bossRespawnMin: 10,
    maxEnemiesPerFight: 2,
  },
  stone_mines: {
    id: 'stone_mines', name: '石化礦坑', levelRange: [10, 18], minStages: 4, maxStages: 4,
    monsterPool: ['stone_bat', 'mine_rat'],
    miniBoss: 'mine_spider_queen', miniBossRespawnMin: 5,
    boss: 'stone_golem', bossRespawnMin: 10,
    maxEnemiesPerFight: 3,
  },
  dark_swamp: {
    id: 'dark_swamp', name: '幽暗沼澤', levelRange: [16, 24], minStages: 4, maxStages: 5,
    monsterPool: ['swamp_tentacle', 'toxic_toad'],
    miniBoss: 'swamp_witch', miniBossRespawnMin: 5,
    boss: 'swamp_drake', bossRespawnMin: 10,
    maxEnemiesPerFight: 3,
  },
  ruined_borderlands: {
    id: 'ruined_borderlands', name: '遺跡邊境', levelRange: [22, 30], minStages: 5, maxStages: 5,
    monsterPool: ['ruin_guardian', 'shadow_blade'],
    miniBoss: 'fallen_knight', miniBossRespawnMin: 5,
    boss: 'king_of_ruins', bossRespawnMin: 10,
    maxEnemiesPerFight: 3,
  },
};

export const MAP_ORDER = ['novice_plains', 'goblin_forest', 'stone_mines', 'dark_swamp', 'ruined_borderlands'];

export function getMap(id) {
  return MAPS[id];
}
