// 遊戲核心 API(奇幻練功MMO):選職業/配點、闖蕩(多關卡:戰鬥/採集/奇遇)、多敵人戰鬥、
// 技能施放、五間商店(製作/買賣/回收)、玩家交易所。存檔為單一 JSON blob,每次操作後整包寫回。
import { Router } from 'express';
import db from '../db.js';
import { authMiddleware } from './auth.js';
import { CLASSES, CLASS_ORDER, getClass, STAT_POINTS_PER_LEVEL, expForNextLevel, STAT_INFO } from '../data/classData.js';
import { getMap, getMonster, MAP_ORDER } from '../data/monsterData.js';
import { getItem, getShop, SHOP_ORDER, getRareRecipes, getPotion, POTION_ORDER, getTierNameZh, GEAR_SLOTS, getEnhanceItem, ENHANCE_ITEM_ORDER } from '../data/itemData.js';
import { rollMapEvent } from '../data/eventData.js';
import { computeStats, addLog, checkLevelUp, computeHpRegen, computeMpRegen, getEquippedSetProgress } from '../engine/characterEngine.js';
import { rollDamage, narrateAttack, narrateEnemyAttack, levelGapDescription, sumBuffValue, tickBuffs, consumeWeaponDurability, consumeArmorDurability } from '../engine/combatEngine.js';
import { generateCommonGear, craftRareItem, canEquip, createStarterMageOffhand, craftSetItem, MAX_DURABILITY } from '../engine/itemEngine.js';
import { getSetInfo, getSetRecipesForShop, getSetRecipeById, describeSetTiers } from '../data/setGearData.js';
import { sellItemToMarket, buyPotionFromMarket, getPotionPriceInfo, getMarketSnapshot, buyEnhanceItemFromMarket } from '../engine/marketEngine.js';
import { listItem, getListings, getListingById, removeListing, LISTING_FEE_PCT } from '../engine/auctionEngine.js';
import { hasFallenLoot, peekRandomFallenLoot, claimFallenLoot } from '../engine/fallenLootEngine.js';
import { rollEnhance, rollCube, getEnhanceItemAppliesToSlot, ENHANCE_MAX_USES, rollCubeChoicePreview, getPendingChoicePreview, clearChoicePreview } from '../engine/enhanceEngine.js';
import { trueBossStatusFor, isTrueBossReady, markTrueBossDefeated } from '../engine/worldBossEngine.js';

const getSaveStmt = db.prepare('SELECT data FROM saves WHERE user_id = ?');
const putSaveStmt = db.prepare('INSERT INTO saves (user_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at');
const getPlayerIdStmt = db.prepare('SELECT player_id FROM users WHERE id = ?');

// 交易所/日誌等對外顯示玩家名字的地方一律用玩家ID(遊戲暱稱),不曝光登入帳號——
// JWT payload 只有 userId/username,playerId 是之後才可能設定的動態資料,故不編進 token,
// 需要顯示時才向資料庫查一次。
async function getDisplayName(userId) {
  const row = await getPlayerIdStmt.get(userId);
  return row?.player_id || null;
}

const REST_GOLD_PER_HP = 0.5; // 城鎮歇息:每恢復1點氣血花費的金幣
const REST_GOLD_PER_MP = 0.5; // 每恢復1點真力花費的金幣
const REST_MIN_COST = 5; // 歇息最低收費(避免只缺1點血也幾乎免費歇息)
const DEFEAT_GOLD_LOSS_PCT = 0.15; // 戰敗時損失目前金幣的比例
const DEFEAT_GOLD_FLOOR = 20; // 戰敗扣錢的下限:金幣低於此值就不再繼續扣,避免被榨到0元動彈不得
const DEFEAT_MATERIAL_LOSS_PCT = 0.2; // 戰敗時每種材料/雜物損失的比例
const VENTURE_BONUS_EXP_MULT = 1.2; // 旅程完成獎勵:以地圖怪物池平均經驗值 * 關卡數 * 此倍率計算獎勵池,走完拿100%、中途撤退按已完成關卡比例發放
const FALLEN_LOOT_EVENT_WEIGHT = 2; // 「拾獲遺物」事件在奇遇池中的權重(僅在確實有遺物可拾時才會抽到)
const FALLEN_LOOT_CHOICE_COUNT = 3; // 每次最多展示幾件遺物供玩家挑選其一

// 地圖等級差過大時的獎勵衰減:玩家等級一旦明顯超過地圖建議上限,經驗/金幣/材料獎勵大幅縮水。
// 沒有這道機制的話,玩家練到高等級後可以回頭「零風險」刷最簡單的地圖(連王都一擊必殺),
// 材料掉落與金幣完全不會衰減,等於練功打寶完全不必往更難的地圖前進——這違背「越好的裝備才有價值、
// 打贏更強的敵人要真的更划算」的設計方向。1~2級的自然超前不受影響,超過4~7級後急速趨近15%下限
// (不會完全歸零,偶爾回去清材料/快速刷幾隻仍有一點意義,但絕不能是主要收入來源)。
function overlevelPenaltyMultiplier(playerLevel, map) {
  const gap = playerLevel - map.levelRange[1];
  if (gap <= 0) return 1;
  return Math.max(0.15, 1 - gap * 0.12);
}

async function loadSave(userId) {
  const row = await getSaveStmt.get(userId);
  if (!row) return null;
  const save = JSON.parse(row.data);
  if (!save.materials) save.materials = {};
  if (!save.potions) save.potions = {};
  if (!save.consumables) save.consumables = {}; // 強化卷軸/潛能方塊(舊存檔沒有此欄位時補上)
  if (save.gold === undefined) save.gold = 50;
  if (!save.bossCooldowns) save.bossCooldowns = {};
  if (!save.allocatedStats) save.allocatedStats = { str: 0, dex: 0, int: 0, luk: 0 };
  if (save.statPoints === undefined) save.statPoints = 0;
  if (!save.currentMapId) save.currentMapId = 'novice_plains';
  // 舊制材料全面退場(裝備地圖化重構後已無任何配方使用,見 itemData.js 開頭說明的「已停用/legacy」
  // 標記):不留著讓玩家背包裡卡著「不知道要幹嘛、只能賣掉」的舊材料,改為在下次讀取存檔時自動
  // 依 basePrice 兌換成金幣——執行過一次後 save.materials 就不會再有這些 id,之後每次讀取都是
  // no-op,不需要額外的「是否已migrate過」旗標。
  const LEGACY_MATERIAL_IDS = [
    'iron_ore', 'rough_leather', 'feather', 'crystal_shard', 'holy_water',
    'slime_core', 'boar_fang', 'captain_insignia', 'chieftain_totem', 'spider_silk_gland',
    'golem_core', 'witch_charm', 'drake_scale', 'knight_emblem', 'king_crown_shard',
    'party_seal',
  ];
  let liquidatedGold = 0;
  LEGACY_MATERIAL_IDS.forEach((id) => {
    const count = save.materials[id] || 0;
    if (count > 0) {
      liquidatedGold += count * (getItem(id)?.basePrice || 0);
      delete save.materials[id];
    }
  });
  if (liquidatedGold > 0) {
    save.gold += liquidatedGold;
    addLog(save, `背包內已無用途的舊制材料,自動兌換為 ${liquidatedGold} 金幣。`);
  }
  // 舊存檔的 equipment 物件是在新增副手部位之前建立的,根本沒有 offhand 這個鍵——
  // 不補上的話 Object.entries(save.equipment) 不會列出它,前端裝備欄畫面就看不到「副手」這一格。
  GEAR_SLOTS.forEach((slot) => { if (!(slot in save.equipment)) save.equipment[slot] = null; });

  // 舊存檔的裝備物件可能沒有 enhanceLevel/potential/rollQuality/enhanceUses 欄位(陸續新增的系統),在此補上預設值。
  // enhanceUses(新制的「已使用次數」計數)舊裝備一律視為 0——等同重新獲得滿額 5 次強化機會,
  // 屬於對玩家友善的遷移方式(舊制下已經強化過的裝備不會因為改制而被鎖死無法再強化)。
  const backfillEnhanceFields = (item) => {
    if (!item) return item;
    if (item.enhanceLevel === undefined) item.enhanceLevel = 0;
    if (item.enhanceUses === undefined) item.enhanceUses = 0;
    if (item.potential === undefined) item.potential = null;
    if (item.rollQuality === undefined) item.rollQuality = 0.5; // 舊裝備沒有品質浮動資料,視為「普通」品質顯示
    return item;
  };
  GEAR_SLOTS.forEach((slot) => backfillEnhanceFields(save.equipment[slot]));
  (save.inventory || []).forEach(backfillEnhanceFields);

  // 裝備耐久度上限調降(500→250,見 itemEngine.js MAX_DURABILITY):舊存檔已持有的裝備仍是舊制
  // 500上限,不能直接把 maxDurability 蓋成新制 250——那樣要嘛讓耗損到一半的武器瞬間「回春」變成
  // 幾乎全新,要嘛讓已經用超過250次的裝備直接卡在0耐久。這裡改用「等比例縮放」:依照舊存檔目前
  // 的耗損比例,換算到新的250上限,耐久損耗的「感覺」不會因為改制而突然跳動。
  const rescaleDurability = (item) => {
    if (!item || item.maxDurability == null || item.maxDurability === MAX_DURABILITY) return;
    const ratio = item.durability / item.maxDurability;
    item.maxDurability = MAX_DURABILITY;
    item.durability = Math.max(0, Math.min(MAX_DURABILITY, Math.round(ratio * MAX_DURABILITY)));
  };
  GEAR_SLOTS.forEach((slot) => rescaleDurability(save.equipment[slot]));
  (save.inventory || []).forEach(rescaleDurability);

  // 裝備耐久度歸零:自動從裝備欄卸下(不能穿戴/戰鬥中不再生效),移進背包讓玩家自己決定要不要去
  // 雜貨店賣掉騰位置——不是留在裝備欄「看起來還穿著但沒作用」,那樣容易讓玩家誤以為是bug。
  GEAR_SLOTS.forEach((slot) => {
    const item = save.equipment[slot];
    if (item && item.maxDurability != null && (item.durability ?? item.maxDurability) <= 0) {
      save.equipment[slot] = null;
      save.inventory.push(item);
      addLog(save, `「${item.name}」耐久度已耗盡,自動卸下,可至雜貨店賣掉回收。`);
    }
  });

  const stats = computeStats(save);
  if (save.hp === undefined) save.hp = stats.maxHp;
  if (save.mp === undefined) save.mp = stats.maxMp;
  const regenHp = computeHpRegen(save.lastHpRegenAt || Date.now(), save.hp, stats.maxHp);
  save.hp = regenHp.hp;
  save.lastHpRegenAt = regenHp.lastRegenAt;
  const regenMp = computeMpRegen(save.lastMpRegenAt || Date.now(), save.mp, stats.maxMp);
  save.mp = regenMp.mp;
  save.lastMpRegenAt = regenMp.lastRegenAt;

  return save;
}

async function saveGame(userId, save) {
  await putSaveStmt.run(userId, JSON.stringify(save), new Date().toISOString());
}

function publicState(save) {
  const stats = computeStats(save);
  const cls = getClass(save.classId);
  return {
    classId: save.classId,
    classChosen: !!save.classChosen,
    className: cls.name,
    primaryStat: cls.primaryStat,
    buildGuide: cls.buildGuide,
    statInfo: STAT_INFO,
    level: save.level,
    exp: save.exp,
    expNeeded: expForNextLevel(save.level),
    statPoints: save.statPoints,
    allocatedStats: save.allocatedStats,
    stats,
    hp: save.hp,
    maxHp: stats.maxHp,
    mp: save.mp,
    maxMp: stats.maxMp,
    gold: save.gold,
    equipment: save.equipment,
    inventory: save.inventory,
    setProgress: getEquippedSetProgress(save), // 目前穿著中的套裝進度(幾件/解鎖了什麼效果),供裝備欄套裝效果 Modal 顯示
    materials: Object.entries(save.materials).filter(([, c]) => c > 0).map(([id, count]) => ({ id, name: getItem(id)?.name || id, kind: getItem(id)?.kind, count })),
    potions: POTION_ORDER.map((id) => ({ id, name: getPotion(id).name, kind: getPotion(id).kind, healPct: getPotion(id).healPct, count: save.potions[id] || 0 })),
    consumables: ENHANCE_ITEM_ORDER.map((id) => ({ id, name: getEnhanceItem(id).name, kind: getEnhanceItem(id).kind, appliesTo: getEnhanceItem(id).appliesTo, price: getEnhanceItem(id).price, count: save.consumables[id] || 0 })),
    currentMapId: save.currentMapId,
    maps: MAP_ORDER.map((id) => {
      const m = getMap(id);
      return { id: m.id, name: m.name, levelRange: m.levelRange, minStages: m.minStages, maxStages: m.maxStages, bossStatus: bossStatusFor(m) };
    }),
    skills: cls.skills,
    log: save.log.slice(0, 20),
    activeCombat: save.activeCombat || null,
    activeVenture: save.activeVenture || null,
  };
}

// ---- 怪物/裝備輔助 ----
function instantiateEnemy(monsterId) {
  const m = getMonster(monsterId);
  return {
    monsterId: m.id, name: m.name, level: m.level, hp: m.hp, maxHp: m.hp, atk: m.atk, def: m.def, critRate: m.critRate, exp: m.exp, tier: m.tier || 'normal', dropTable: m.dropTable,
    // 小王/大王機制:抗性、狂暴、蓄力技能(一般小怪沒有這些欄位,預設值等同無此機制)
    physicalResistPct: m.physicalResistPct || 0,
    magicResistPct: m.magicResistPct || 0,
    enrageHpPct: m.enrageHpPct ?? null,
    enrageAtkMult: m.enrageAtkMult ?? null,
    enraged: false,
    chargeSkill: m.chargeSkill || null,
    charging: false,
    turnCounter: 0,
  };
}

// 菁英(原小王/大王)遭遇判定:不再有個人重生冷卻,隨時可能以固定機率遭遇,就像更強一階的小怪。
// 真王一樣是隨機遭遇(不是明確點擊挑戰),但機率遠低於菁英、且必須全服共用計時器 ready 才會進入
// 遭遇池——冷卻中完全不可能遇到,見 worldBossEngine.js。判定順序:真王 > 大王 > 小王,由稀有到常見依序擲骰。
function rollBossEncounter(map) {
  if (map.trueBoss && isTrueBossReady(map.id) && Math.random() < 0.03) {
    return { kind: 'trueboss' };
  }
  if (Math.random() < 0.08) return { kind: 'boss' };
  if (Math.random() < 0.16) return { kind: 'miniboss' };
  return null;
}

// 菁英狀態:恆常可遇,不再有倒數計時,供地圖列表顯示用(alive 永遠是 true,respawnInSec 永遠是 0)
function eliteStatusFor(map) {
  const miniBoss = getMonster(map.miniBoss);
  const boss = getMonster(map.boss);
  return {
    miniBoss: { name: miniBoss?.name, alive: true, respawnInSec: 0 },
    boss: { name: boss?.name, alive: true, respawnInSec: 0 },
  };
}

// 真王狀態:全服共用重生計時(見 worldBossEngine.js),不是每位玩家各自獨立進度。
// alive 代表「目前是否有機會在闖蕩中隨機遇到真王」,不是可以直接點擊挑戰的按鈕。
function bossStatusFor(map) {
  const trueBoss = getMonster(map.trueBoss);
  return {
    ...eliteStatusFor(map),
    trueBoss: { name: trueBoss?.name, ...trueBossStatusFor(map) },
  };
}

function startCombatStage(save, map) {
  const bossRoll = rollBossEncounter(map);
  let enemies;
  let isBossFight = false;
  let bossKind = null;
  let isTrueBossFight = false;
  if (bossRoll) {
    isBossFight = true;
    bossKind = bossRoll.kind;
    isTrueBossFight = bossKind === 'trueboss';
    const monsterId = bossKind === 'trueboss' ? map.trueBoss : bossKind === 'boss' ? map.boss : map.miniBoss;
    enemies = [instantiateEnemy(monsterId)];
  } else {
    const count = 1 + Math.floor(Math.random() * map.maxEnemiesPerFight);
    enemies = Array.from({ length: count }, () => instantiateEnemy(map.monsterPool[Math.floor(Math.random() * map.monsterPool.length)]));
  }
  const stats = computeStats(save);
  save.activeCombat = {
    mapId: map.id,
    mapName: map.name,
    isBossFight,
    bossKind,
    isTrueBossFight,
    enemies,
    playerHp: save.hp,
    playerMaxHp: stats.maxHp,
    playerMp: save.mp,
    playerMaxMp: stats.maxMp,
    buffs: [],
    log: [
      isTrueBossFight ? `真王「${enemies[0].name}」現身了!這是一場硬仗,做好準備。` : isBossFight ? `菁英「${enemies[0].name}」現身了!` : `遭遇了 ${enemies.map((e) => e.name).join('、')}!`,
      levelGapDescription(save.level, enemies[0].level),
    ],
  };
}

function nonJunkDrops(map) {
  return map.monsterPool.flatMap((mid) => (getMonster(mid)?.dropTable || []).filter((d) => d.kind !== 'junk'));
}

function resolveGatherStage(map) {
  const pool = nonJunkDrops(map);
  if (pool.length === 0) return { lines: ['你四處查探一番,並無值得採集之物。'], gained: null };
  const pick = pool[Math.floor(Math.random() * pool.length)];
  return { lines: null, gained: pick };
}

// 從陣列中隨機挑出最多 n 個元素(不重複),用於「拾獲遺物」事件展示可選項目
function pickRandomSubset(arr, n) {
  const copy = [...arr];
  const result = [];
  while (copy.length > 0 && result.length < n) {
    const idx = Math.floor(Math.random() * copy.length);
    result.push(copy.splice(idx, 1)[0]);
  }
  return result;
}

// 是否還有任何「可販售」的材料/雜物庫存(不含裝備——裝備不能直接賣給雜貨店,也不代表真的一無所有)
function hasSellableAssets(save) {
  return Object.entries(save.materials).some(([matId, count]) => count > 0 && getItem(matId));
}

// 奇遇事件結算。多數情況回傳純敘事文字(lines);但若恰好觸發「拾獲遺物」分支(僅在資料庫內
// 確實存在陣亡玩家的遺物時才可能抽到),則額外回傳 lootChoice,要求玩家從中挑選一件帶走,
// 呼叫端(advanceVentureStage)需暫停旅程進度、等玩家選擇後才能繼續。
async function resolveEventStage(save, map) {
  if ((await hasFallenLoot()) && Math.random() < 0.15) {
    const loot = await peekRandomFallenLoot();
    if (loot && loot.items.length > 0) {
      const offered = pickRandomSubset(loot.items, FALLEN_LOOT_CHOICE_COUNT);
      return {
        lines: [`你在荒僻處發現了些許遺物,似是曾有闖蕩者殞落於此……(來自「${loot.fallenUsername}」的遺物)`],
        lootChoice: { lootId: loot.id, fallenUsername: loot.fallenUsername, items: offered },
      };
    }
  }
  // 「真正一無所有」才觸發撿到金幣機率大幅提升的安全網——單純金幣0元但身上還有材料/雜物可賣的話不算,
  // 那種情況該去雜貨店賣東西換錢,不需要遊戲額外幫忙。
  const destitute = save.gold <= 0 && !hasSellableAssets(save);
  const evt = rollMapEvent({ boostGold: destitute });
  const rewardPenalty = overlevelPenaltyMultiplier(save.level, map);
  const lines = [];
  if (evt.type === 'gold') {
    const amt = evt.min + Math.floor(Math.random() * (evt.max - evt.min + 1));
    // 「真正一無所有」的安全網金幣不套用等級差懲罰——那是防止死亡螺旋的機制,不該因為玩家剛好在
    // 等級不符的地圖上而失效;一般撿到金幣事件則正常套用衰減,呼應「不該一直刷低階圖賺錢」的設計。
    const finalAmt = destitute ? amt : Math.max(1, Math.round(amt * rewardPenalty));
    save.gold += finalAmt;
    lines.push(evt.text(finalAmt));
  } else if (evt.type === 'material') {
    const pool = nonJunkDrops(map);
    if (pool.length === 0) {
      lines.push('這一段路風平浪靜,什麼也沒發現。');
    } else {
      const pick = pool[Math.floor(Math.random() * pool.length)];
      const amt = Math.max(1, Math.round((pick.min + Math.floor(Math.random() * (pick.max - pick.min + 1))) * rewardPenalty));
      save.materials[pick.id] = (save.materials[pick.id] || 0) + amt;
      lines.push(evt.text(getItem(pick.id)?.name || pick.id, amt));
    }
  } else if (evt.type === 'exp') {
    const amt = Math.max(1, Math.round((evt.min + Math.floor(Math.random() * (evt.max - evt.min + 1))) * rewardPenalty));
    save.exp += amt;
    lines.push(evt.text(amt));
    const leveledTo = checkLevelUp(save);
    if (leveledTo) lines.push(`升級了!目前等級 Lv.${leveledTo},獲得 ${STAT_POINTS_PER_LEVEL} 點屬性點。`);
  } else if (evt.type === 'trap') {
    const stats = computeStats(save);
    const amt = Math.max(1, Math.round(stats.maxHp * evt.pct));
    save.hp = Math.max(1, save.hp - amt);
    lines.push(evt.text(amt));
  } else if (evt.type === 'treasure') {
    lines.push(evt.text());
    const roll = Math.random();
    if (roll < 0.1) {
      const gear = generateCommonGear(map.levelRange[1]);
      save.inventory.push(gear);
      lines.push(`竟讓你挖到一件裝備:「${gear.name}」!`);
    } else if (roll < 0.4) {
      const amt = Math.max(1, Math.round((20 + Math.floor(Math.random() * 50)) * rewardPenalty));
      save.gold += amt;
      lines.push(`找到一處藏寶,得 ${amt} 枚金幣。`);
    } else {
      lines.push('挖了老半天,一無所獲。');
    }
  } else if (evt.type === 'rest') {
    // 野外小憩:完全免費,不需要金幣也能在闖蕩途中自然回復,避免只能依賴回城付費歇息
    const stats = computeStats(save);
    const missingHp = Math.max(0, stats.maxHp - save.hp);
    const missingMp = Math.max(0, stats.maxMp - save.mp);
    const hpAmt = Math.round(missingHp * evt.hpPct);
    const mpAmt = Math.round(missingMp * evt.mpPct);
    save.hp = Math.min(stats.maxHp, save.hp + hpAmt);
    save.mp = Math.min(stats.maxMp, save.mp + mpAmt);
    lines.push(evt.text(hpAmt, mpAmt));
  } else {
    lines.push(evt.text());
  }
  return { lines };
}

async function advanceVentureStage(save, map) {
  const venture = save.activeVenture;
  const stageLabel = `第 ${venture.stageIndex + 1}/${venture.totalStages} 關`;
  const roll = Math.random();
  if (roll < 0.55) {
    startCombatStage(save, map);
    venture.lastStageLines = [`—— ${stageLabel}:遭遇戰 ——`];
    venture.pendingContinue = false;
  } else if (roll < 0.78) {
    const result = resolveGatherStage(map);
    let lines;
    if (result.gained) {
      const rewardPenalty = overlevelPenaltyMultiplier(save.level, map);
      const amt = Math.max(1, Math.round((result.gained.min + Math.floor(Math.random() * (result.gained.max - result.gained.min + 1)) + 1) * rewardPenalty));
      // 抽到的可能是卷軸/方塊(強化消耗品),要存進 save.consumables,不能一律塞進 save.materials——
      // 否則玩家「採集」奇遇拿到的卷軸/方塊會憑空消失(materials 分頁不會顯示,也無法拿去強化裝備)。
      const enhanceItem = getEnhanceItem(result.gained.id);
      if (enhanceItem) {
        save.consumables[result.gained.id] = (save.consumables[result.gained.id] || 0) + amt;
        lines = [`你專心採集了一陣,收穫${enhanceItem.name} x${amt}。`];
      } else {
        save.materials[result.gained.id] = (save.materials[result.gained.id] || 0) + amt;
        lines = [`你專心採集了一陣,收穫${getItem(result.gained.id)?.name || result.gained.id} x${amt}。`];
      }
    } else {
      lines = result.lines;
    }
    venture.lastStageLines = [`—— ${stageLabel}:採集 ——`, ...lines];
    venture.pendingContinue = true;
  } else {
    const result = await resolveEventStage(save, map);
    venture.lastStageLines = [`—— ${stageLabel}:奇遇 ——`, ...result.lines];
    if (result.lootChoice) {
      venture.pendingLootChoice = result.lootChoice;
      venture.pendingContinue = false; // 必須先選擇要帶走哪件遺物,才能繼續前進
    } else {
      venture.pendingContinue = true;
    }
  }
  venture.log.push(...venture.lastStageLines);
}

function generateVenture(map) {
  const totalStages = map.minStages + Math.floor(Math.random() * (map.maxStages - map.minStages + 1));
  const avgExp = map.monsterPool.reduce((sum, mid) => sum + (getMonster(mid)?.exp || 0), 0) / map.monsterPool.length;
  const bonusExpPool = Math.round(avgExp * totalStages * VENTURE_BONUS_EXP_MULT);
  return { mapId: map.id, mapName: map.name, stageIndex: 0, totalStages, bonusExpPool, pendingContinue: false, lastStageLines: [], log: [] };
}

export default function gameRoutes() {
  const router = Router();

  // 公開資訊(不需登入):供創角畫面顯示職業選項、技能說明、配點建議
  router.get('/classes', async (req, res) => {
    res.json({
      classes: CLASS_ORDER.map((id) => {
        const c = getClass(id);
        return { id, name: c.name, tagline: c.tagline, skills: c.skills, primaryStat: c.primaryStat, buildGuide: c.buildGuide };
      }),
      statInfo: STAT_INFO,
    });
  });

  router.use(authMiddleware);

  router.get('/state', async (req, res) => {
    const save = await loadSave(req.user.userId);
    if (!save) return res.status(404).json({ error: '找不到存檔' });
    await saveGame(req.user.userId, save);
    res.json({ state: publicState(save) });
  });

  // 選擇職業(首次進入遊戲時呼叫一次)。要求玩家已設定過玩家ID(遊戲暱稱)才能選職業——
  // 就算有人繞過前端直接呼叫這支API,伺服器端仍會擋下,不會出現「沒有暱稱卻進了遊戲」的狀態。
  router.post('/choose-class', async (req, res) => {
    const { classId } = req.body || {};
    if (!CLASS_ORDER.includes(classId)) return res.status(400).json({ error: '無效的職業' });
    if (!(await getDisplayName(req.user.userId))) return res.status(400).json({ error: '請先設定玩家ID' });
    const save = await loadSave(req.user.userId);
    save.classId = classId;
    save.classChosen = true;
    // 法師沒有格擋機制,改靠副手的真氣減傷%生存——選職業當下直接送一把基礎副手,
    // 不必等存夠錢打造才有防禦手段(呼應「法師要給一個基礎的副手」)。
    if (classId === 'mage' && !save.equipment.offhand) {
      save.equipment.offhand = createStarterMageOffhand();
    }
    const stats = computeStats(save);
    save.hp = stats.maxHp;
    save.mp = stats.maxMp;
    await saveGame(req.user.userId, save);
    res.json({ state: publicState(save) });
  });

  // 屬性配點:每次升級可得 5 點自由分配,點入 STR/DEX/INT/LUK 任意組合
  router.post('/stats/allocate', async (req, res) => {
    const { str = 0, dex = 0, int: intPts = 0, luk = 0 } = req.body || {};
    const parts = [str, dex, intPts, luk].map((v) => Number(v) || 0);
    if (parts.some((v) => v < 0)) return res.status(400).json({ error: '加點數值不可為負' });
    const total = parts.reduce((a, b) => a + b, 0);
    if (total <= 0) return res.status(400).json({ error: '未指定任何加點' });
    const save = await loadSave(req.user.userId);
    if (total > save.statPoints) return res.status(400).json({ error: `可用屬性點不足(剩餘 ${save.statPoints} 點)` });
    save.allocatedStats.str += parts[0];
    save.allocatedStats.dex += parts[1];
    save.allocatedStats.int += parts[2];
    save.allocatedStats.luk += parts[3];
    save.statPoints -= total;
    await saveGame(req.user.userId, save);
    res.json({ state: publicState(save) });
  });

  // ---- 城鎮:歇息(依實際花費的金幣比例回復氣血/真力,不是全有全無——
  // 金幣不夠付「全額」也能歇息,花多少錢就回多少狀態;不指定金額時預設「有多少花多少」)----
  router.post('/town/rest', async (req, res) => {
    const { goldToSpend } = req.body || {};
    const save = await loadSave(req.user.userId);
    if (save.activeCombat || save.activeVenture) return res.status(400).json({ error: '旅程尚未結束' });
    const stats = computeStats(save);
    const missingHp = Math.max(0, stats.maxHp - save.hp);
    const missingMp = Math.max(0, stats.maxMp - save.mp);
    if (missingHp <= 0 && missingMp <= 0) return res.status(400).json({ error: '氣血真力皆已全滿' });
    const fullCost = Math.max(REST_MIN_COST, Math.round(missingHp * REST_GOLD_PER_HP + missingMp * REST_GOLD_PER_MP));
    const requested = Number.isFinite(goldToSpend) ? Math.max(0, Math.floor(goldToSpend)) : fullCost;
    const spend = Math.min(save.gold, requested, fullCost);
    if (spend <= 0) return res.status(400).json({ error: '金幣不足,無法歇息' });
    const fraction = Math.min(1, spend / fullCost);
    save.gold -= spend;
    save.hp = Math.min(stats.maxHp, save.hp + Math.round(missingHp * fraction));
    save.mp = Math.min(stats.maxMp, save.mp + Math.round(missingMp * fraction));
    const healedPct = Math.round(fraction * 100);
    addLog(save, `於城鎮歇息,花費 ${spend} 枚金幣,氣血真力恢復了 ${healedPct}%。`);
    await saveGame(req.user.userId, save);
    res.json({ state: publicState(save), spent: spend, healedPct });
  });

  router.post('/consumable/use-potion', async (req, res) => {
    const { potionId } = req.body || {};
    const potion = getPotion(potionId);
    if (!potion) return res.status(400).json({ error: '無此藥水' });
    const save = await loadSave(req.user.userId);
    if (save.activeCombat) return res.status(400).json({ error: '戰鬥中請在戰鬥畫面使用藥水' });
    if (!(save.potions[potionId] > 0)) return res.status(400).json({ error: '藥水數量不足' });
    const stats = computeStats(save);
    save.potions[potionId] -= 1;
    if (potion.kind === 'hp') save.hp = Math.min(stats.maxHp, save.hp + Math.round(stats.maxHp * potion.healPct));
    else save.mp = Math.min(stats.maxMp, save.mp + Math.round(stats.maxMp * potion.healPct));
    await saveGame(req.user.userId, save);
    res.json({ state: publicState(save) });
  });

  // ---- 闖蕩(多關卡旅程:戰鬥/採集/奇遇交錯)----
  router.post('/hunt/start', async (req, res) => {
    const { mapId } = req.body || {};
    const map = getMap(mapId);
    if (!map) return res.status(400).json({ error: '無此地圖' });
    const save = await loadSave(req.user.userId);
    if (save.activeCombat || save.activeVenture) return res.status(400).json({ error: '旅程尚未結束' });
    if (save.hp <= 0) return res.status(400).json({ error: '氣血已盡,請先回城鎮歇息' });
    save.currentMapId = map.id;
    save.activeVenture = generateVenture(map);
    await advanceVentureStage(save, map);
    await saveGame(req.user.userId, save);
    res.json({ state: publicState(save) });
  });

  router.post('/hunt/continue', async (req, res) => {
    const save = await loadSave(req.user.userId);
    const venture = save.activeVenture;
    if (!venture) return res.status(400).json({ error: '目前沒有進行中的旅程' });
    if (save.activeCombat) return res.status(400).json({ error: '戰鬥尚未結束' });
    if (venture.pendingLootChoice) return res.status(400).json({ error: '請先挑選一件遺物' });
    if (!venture.pendingContinue) return res.status(400).json({ error: '尚無可繼續的進度' });
    venture.stageIndex += 1;
    venture.pendingContinue = false;
    if (venture.stageIndex >= venture.totalStages) {
      // 全程走完:旅程獎勵拿滿 100%(中途撤退則按已完成關卡比例發放,見 /hunt/retreat)
      save.exp += venture.bonusExpPool;
      const leveledTo = checkLevelUp(save);
      addLog(save, `完整闖蕩了一趟${venture.mapName},滿載而歸,額外獲得 ${venture.bonusExpPool} 點旅程獎勵經驗。`);
      const lines = [...venture.log, `旅程完滿結束(共 ${venture.totalStages} 關)!額外獲得 ${venture.bonusExpPool} 點旅程獎勵經驗。`];
      if (leveledTo) lines.push(`升級了!目前等級 Lv.${leveledTo},獲得 ${STAT_POINTS_PER_LEVEL} 點自由屬性點。`);
      save.activeVenture = null;
      await saveGame(req.user.userId, save);
      return res.json({ state: publicState(save), ventureEnded: 'complete', lines });
    }
    const map = getMap(venture.mapId);
    await advanceVentureStage(save, map);
    await saveGame(req.user.userId, save);
    res.json({ state: publicState(save), lines: save.activeCombat ? [] : venture.lastStageLines });
  });

  // 中途撤退:結束旅程但保留已完成關卡的進度獎勵(依比例發放旅程獎勵經驗,走完才是100%,見 bonusExpPool)。
  // 只能在非戰鬥、非待選遺物的安全時機使用(戰鬥中要離開請用「脫身」,有失敗機率)。
  router.post('/hunt/retreat', async (req, res) => {
    const save = await loadSave(req.user.userId);
    const venture = save.activeVenture;
    if (!venture) return res.status(400).json({ error: '目前沒有進行中的旅程' });
    if (save.activeCombat) return res.status(400).json({ error: '戰鬥中無法直接撤退,請使用「脫身」' });
    if (venture.pendingLootChoice) return res.status(400).json({ error: '請先挑選一件遺物' });
    const bonusExp = Math.round(venture.bonusExpPool * venture.stageIndex / venture.totalStages);
    save.exp += bonusExp;
    const leveledTo = bonusExp > 0 ? checkLevelUp(save) : null;
    const lines = [...venture.log, `提前撤退,已完成 ${venture.stageIndex}/${venture.totalStages} 關,獲得 ${bonusExp} 點旅程獎勵經驗。`];
    if (leveledTo) lines.push(`升級了!目前等級 Lv.${leveledTo},獲得 ${STAT_POINTS_PER_LEVEL} 點自由屬性點。`);
    addLog(save, `提前結束了${venture.mapName}的旅程(完成 ${venture.stageIndex}/${venture.totalStages} 關)。`);
    save.activeVenture = null;
    await saveGame(req.user.userId, save);
    res.json({ state: publicState(save), ventureEnded: 'retreat', lines });
  });

  // 拾獲遺物:從奇遇事件展示的選項中挑選一件帶走,其餘遺物隨之消散(不會留給下次再選)
  router.post('/hunt/loot-choice', async (req, res) => {
    const { itemIndex } = req.body || {};
    const save = await loadSave(req.user.userId);
    const venture = save.activeVenture;
    const choice = venture?.pendingLootChoice;
    if (!choice) return res.status(400).json({ error: '目前沒有待選擇的遺物' });
    const item = choice.items[itemIndex];
    if (!item) return res.status(400).json({ error: '無效的選擇' });

    const claimed = await claimFallenLoot(choice.lootId);
    venture.pendingLootChoice = null;
    venture.pendingContinue = true;
    if (!claimed) {
      // 極少數情況:同一份遺物在你選擇前已被其他玩家搶先拾獲
      const lines = ['可惜,這份遺物已被他人搶先拾獲了。'];
      venture.lastStageLines.push(...lines);
      await saveGame(req.user.userId, save);
      return res.json({ state: publicState(save), lines });
    }
    save.inventory.push(item);
    addLog(save, `拾得「${choice.fallenUsername}」的遺物:${item.name}。`);
    const lines = [`你拾起了「${item.name}」,其餘遺物則隨風而逝。`];
    venture.lastStageLines.push(...lines);
    await saveGame(req.user.userId, save);
    res.json({ state: publicState(save), lines });
  });

  // 戰鬥回合:'basic'/'aoe'/'buff'(職業技能)、'potion'(戰鬥中使用藥水)、'flee'(脫身),支援多敵人同場作戰。
  router.post('/combat/action', async (req, res) => {
    const { action, targetIndex, potionId } = req.body || {};
    const save = await loadSave(req.user.userId);
    const combat = save.activeCombat;
    if (!combat) return res.status(400).json({ error: '目前沒有進行中的戰鬥' });

    const cls = getClass(save.classId);
    const stats = computeStats(save);
    const lines = [];
    let playerActed = false;
    const aliveEnemies = () => combat.enemies.filter((e) => e.hp > 0);

    if (action === 'flee') {
      const fled = Math.random() < 0.5;
      if (fled) {
        lines.push('你瞅準空隙,脫身而去。');
        save.hp = combat.playerHp;
        save.mp = combat.playerMp;
        save.activeCombat = null;
        save.activeVenture = null;
        await saveGame(req.user.userId, save);
        return res.json({ state: publicState(save), combatEnded: 'fled', lines });
      }
      lines.push('你想脫身,卻被纏住,無法脫身!');
      playerActed = true;
    } else if (action === 'potion') {
      const potion = getPotion(potionId);
      if (!potion) return res.status(400).json({ error: '無此藥水' });
      if (!(save.potions[potionId] > 0)) return res.status(400).json({ error: '藥水數量不足' });
      save.potions[potionId] -= 1;
      if (potion.kind === 'hp') {
        const amt = Math.round(combat.playerMaxHp * potion.healPct);
        combat.playerHp = Math.min(combat.playerMaxHp, combat.playerHp + amt);
        lines.push(`使用了${potion.name},恢復 ${amt} 點氣血。`);
      } else {
        const amt = Math.round(combat.playerMaxMp * potion.healPct);
        combat.playerMp = Math.min(combat.playerMaxMp, combat.playerMp + amt);
        lines.push(`使用了${potion.name},恢復 ${amt} 點真力。`);
      }
      playerActed = true;
    } else if (action === 'defend') {
      // 防禦:這回合不輸出,但敵方攻擊傷害減半——用來應付王的蓄力爆發,是「攻擊以外」的真正戰術選擇
      lines.push('你收起攻勢,擺出防禦姿態,準備抵禦接下來的攻擊!');
      playerActed = true;
    } else if (action === 'basic' || action === 'aoe' || action === 'buff') {
      const skill = cls.skills[action];
      if (save.level < skill.unlockLevel) {
        return res.status(400).json({ error: `尚未達到等級,無法施展「${skill.name}」(需 Lv.${skill.unlockLevel})` });
      }
      if (combat.playerMp < skill.mpCost) {
        return res.status(400).json({ error: `真力不足,無法施展「${skill.name}」(需 ${skill.mpCost} 點,目前 ${combat.playerMp} 點)` });
      }
      combat.playerMp -= skill.mpCost;
      const atkStat = cls.attackType === 'matk' ? stats.matk : stats.atk;
      const critRate = stats.critRate + sumBuffValue(combat.buffs, 'critRatePct');
      const atkMult = 1 + sumBuffValue(combat.buffs, 'atkPct');
      // 王的物理/魔法抗性依玩家攻擊類型(matk=魔法/atk=物理)套用,一般小怪無此欄位則等同無抗性
      const resistFor = (target) => (cls.attackType === 'matk' ? target.magicResistPct : target.physicalResistPct) || 0;

      if (action === 'basic') {
        const idx = Number.isInteger(targetIndex) && combat.enemies[targetIndex]?.hp > 0 ? targetIndex : combat.enemies.findIndex((e) => e.hp > 0);
        const target = combat.enemies[idx];
        if (!target) return res.status(400).json({ error: '目標無效' });
        const { amount, isCrit } = rollDamage({ level: stats.level, atk: atkStat * atkMult, coeff: skill.coeff, def: target.def, critRate, resistPct: resistFor(target), critDamageMult: stats.critDamageMult });
        target.hp = Math.max(0, target.hp - amount);
        lines.push(`你施展「${skill.name}」!` + narrateAttack({ attackerName: '你', defenderName: target.name, amount, isCrit }));
        consumeWeaponDurability(save.equipment);
      } else if (action === 'aoe') {
        lines.push(`你施展「${skill.name}」,席捲全場!`);
        combat.enemies.forEach((target) => {
          if (target.hp <= 0) return;
          const { amount, isCrit } = rollDamage({ level: stats.level, atk: atkStat * atkMult, coeff: skill.coeff, def: target.def, critRate, resistPct: resistFor(target), critDamageMult: stats.critDamageMult });
          target.hp = Math.max(0, target.hp - amount);
          lines.push(narrateAttack({ attackerName: '你', defenderName: target.name, amount, isCrit }));
        });
        consumeWeaponDurability(save.equipment);
      } else if (skill.healPct) {
        const amt = Math.round(combat.playerMaxHp * skill.healPct);
        combat.playerHp = Math.min(combat.playerMaxHp, combat.playerHp + amt);
        lines.push(`你施展「${skill.name}」,恢復 ${amt} 點氣血。`);
      } else if (skill.durationTurns) {
        const [key, value] = Object.entries(skill.effect)[0];
        combat.buffs.push({ key, value, turnsLeft: skill.durationTurns });
        lines.push(`你施展「${skill.name}」!${skill.desc}`);
      }
      playerActed = true;
    } else {
      return res.status(400).json({ error: '無效的操作' });
    }

    if (playerActed && combat.playerHp > 0) {
      const defending = action === 'defend';
      aliveEnemies().forEach((enemy) => {
        if (combat.playerHp <= 0) return;

        // 狂暴判定:血量低於門檻且尚未狂暴過,永久提升攻擊力(只觸發一次,王機制之一)
        if (enemy.enrageHpPct != null && !enemy.enraged && enemy.hp / enemy.maxHp <= enemy.enrageHpPct) {
          enemy.enraged = true;
          enemy.atk = Math.round(enemy.atk * enemy.enrageAtkMult);
          lines.push(`⚠ ${enemy.name}的傷勢激起了狂暴,攻擊力大幅提升!`);
        }

        // 蓄力技能判定:蓄力中的這回合直接爆發攻擊;否則依回合數判斷是否改為蓄力(蓄力當回合不攻擊,只預警)
        let isChargeRelease = false;
        if (enemy.charging) {
          isChargeRelease = true;
          enemy.charging = false;
        } else if (enemy.chargeSkill) {
          enemy.turnCounter += 1;
          if (enemy.turnCounter % enemy.chargeSkill.triggerEveryTurns === 0) {
            enemy.charging = true;
            lines.push(`⚠ ${enemy.name}${enemy.chargeSkill.telegraphText}`);
            return; // 蓄力中,這回合不攻擊——玩家下回合要有所準備(防禦/吃藥)
          }
        }

        const { amount, isCrit, missed, blocked, mpAbsorbed } = rollDamage({ level: enemy.level, atk: enemy.atk, coeff: 1, def: stats.def, critRate: enemy.critRate, evasionPct: stats.evasionRate, blockRatePct: stats.blockRatePct, magicDamageReductionPct: stats.magicDamageReductionPct });
        if (missed) {
          lines.push(narrateEnemyAttack({ enemyName: enemy.name, targetName: '你', missed: true }));
          return;
        }
        // 法師的真氣減傷%不是憑空消失,而是用真力(MP)扛住這部分傷害——只要受到傷害就會觸發,
        // MP 不夠扛時,扛不住的差額要轉回傷害由氣血承受(不能讓沒有真力的法師還是白吃全額減傷)。
        let realAmount = amount;
        let mpUsedForAbsorb = 0;
        if (mpAbsorbed > 0) {
          mpUsedForAbsorb = Math.min(combat.playerMp, mpAbsorbed);
          combat.playerMp -= mpUsedForAbsorb;
          realAmount += mpAbsorbed - mpUsedForAbsorb;
        }
        const boosted = isChargeRelease ? Math.round(realAmount * enemy.chargeSkill.dmgMult) : realAmount;
        const finalAmount = defending ? Math.max(1, Math.ceil(boosted * 0.5)) : boosted;
        combat.playerHp = Math.max(0, combat.playerHp - finalAmount);
        consumeArmorDurability(save.equipment);
        const absorbText = mpUsedForAbsorb > 0 ? `(真氣抵擋了 ${mpUsedForAbsorb} 點傷害)` : '';
        if (isChargeRelease) {
          lines.push(`💥 ${enemy.name}蓄力已久,使出「${enemy.chargeSkill.name}」!造成 ${finalAmount} 點傷害${isCrit ? '(要害!)' : ''}${defending ? '(防禦大幅減輕了衝擊)' : ''}${absorbText}。`);
        } else {
          lines.push(narrateEnemyAttack({ enemyName: enemy.name, targetName: '你', amount: finalAmount, isCrit, blocked }) + (defending ? '(防禦減傷)' : '') + absorbText);
        }
      });
      combat.buffs = tickBuffs(combat.buffs);

      // 光環(被動)技能的每回合持續效果:法師真力回流,需等級達到 unlockLevel 才會生效
      // (hpRegenPct 是通用機制,目前沒有職業使用,保留供未來擴充)。
      const aura = cls.skills.aura;
      if (save.level >= aura.unlockLevel && combat.playerHp > 0) {
        if (aura.effect.mpRegenPerTurn) {
          combat.playerMp = Math.min(combat.playerMaxMp, combat.playerMp + aura.effect.mpRegenPerTurn);
        }
        if (aura.effect.hpRegenPct) {
          combat.playerHp = Math.min(combat.playerMaxHp, combat.playerHp + Math.round(combat.playerMaxHp * aura.effect.hpRegenPct));
        }
      }
    }

    combat.log.push(...lines);
    let combatEnded = null;

    if (aliveEnemies().length === 0) {
      // 真王被實際擊敗(打贏)才觸發全服共用重生計時——遇到但脫身/撤退不算。菁英(原小王/大王)
      // 已無冷卻機制,不需要在此標記任何東西。
      const combatMap = getMap(combat.mapId);
      if (combat.isTrueBossFight) await markTrueBossDefeated(combatMap.id, combatMap.trueBossRespawnMin);
      const rewardPenalty = overlevelPenaltyMultiplier(save.level, combatMap);
      let totalExp = 0;
      const drops = [];
      combat.enemies.forEach((enemy) => {
        totalExp += enemy.exp;
        (enemy.dropTable || []).forEach((d) => {
          // 套裝素材(elite_shard/trueboss_crystal,僅菁英/真王掉落,製作該地圖套裝專用)不受等級差
          // 懲罰——回頭刷早期地圖的王拿套裝材料是正常玩法(套裝配方本來就固定綁該地圖,不會因為
          // 玩家後來練到更高等級就不能再回去湊材料),不該被誤判成「刷簡單地圖賺錢」而被懲罰。
          // 只有雜物(純賣錢用)跟一般鍛材(gear_material,做基本裝備用)才會衰減。
          const dropPenalty = d.kind === 'set_material' ? 1 : rewardPenalty;
          if (Math.random() < d.chance * dropPenalty) {
            const amt = d.min + Math.floor(Math.random() * (d.max - d.min + 1));
            if (amt <= 0) return; // min:0 的掉落(如抉擇方塊)骰到0時,不加背包也不顯示戰報,避免出現「xxx x0」
            // 卷軸/方塊屬於強化消耗品,存放於 save.consumables(跟一般材料的 save.materials 分開)
            const enhanceItem = getEnhanceItem(d.id);
            if (enhanceItem) {
              save.consumables[d.id] = (save.consumables[d.id] || 0) + amt;
              drops.push(`${enhanceItem.name} x${amt}`);
            } else {
              save.materials[d.id] = (save.materials[d.id] || 0) + amt;
              drops.push(`${getItem(d.id)?.name || d.id} x${amt}`);
            }
          }
        });
        // 一般裝備掉落:一般小怪維持既有機率,菁英/真王不再直接掉落套裝成品(改為保底掉落套裝材料,
        // 見 monsterData.js 的 eliteShardDrop/trueBossCrystalDrop,材料需拿去對應商店製作成套裝裝備)。
        const gearChance = enemy.tier === 'boss' ? 0.35 : enemy.tier === 'miniboss' ? 0.25 : 0.12;
        if (Math.random() < gearChance) {
          const gear = generateCommonGear(enemy.level);
          save.inventory.push(gear);
          drops.push(`裝備:${gear.name}`);
        }
      });
      const finalExp = Math.max(1, Math.round(totalExp * rewardPenalty));
      save.exp += finalExp;
      lines.push(`擊敗了所有敵人!獲得 ${finalExp} 點經驗。`);
      if (drops.length) lines.push(`戰利品:${drops.join('、')}。`);
      addLog(save, `於${combat.mapName}擊敗${combat.enemies.map((e) => e.name).join('、')},獲得 ${totalExp} 點經驗${drops.length ? `,戰利品:${drops.join('、')}` : ''}。`);

      const leveledTo = checkLevelUp(save);
      if (leveledTo) {
        lines.push(`升級了!目前等級 Lv.${leveledTo},獲得 ${STAT_POINTS_PER_LEVEL} 點自由屬性點。`);
        addLog(save, `升級至 Lv.${leveledTo}。`);
      }
      save.hp = combat.playerHp;
      save.mp = combat.playerMp;
      save.activeCombat = null;

      const venture = save.activeVenture;
      if (venture) {
        venture.log.push(...lines);
        if (venture.stageIndex + 1 >= venture.totalStages) {
          addLog(save, `完整闖蕩了一趟${venture.mapName},滿載而歸。`);
          lines.push(`旅程完滿結束(共 ${venture.totalStages} 關)!`);
          save.activeVenture = null;
          combatEnded = 'venture_complete';
        } else {
          venture.pendingContinue = true;
          lines.push(`(第 ${venture.stageIndex + 1}/${venture.totalStages} 關完成,可繼續前進)`);
          combatEnded = 'stage_win';
        }
      } else {
        combatEnded = 'win';
      }
    } else if (combat.playerHp <= 0) {
      combatEnded = 'lose';
      lines.push('你力竭倒地,幸未傷及性命,狼狽退回。');

      // 戰敗懲罰:損失部分金幣與材料庫存(裝備欄與背包內的裝備不受影響,避免過度懲罰)。
      // 金幣已經很少時不再繼續扣(保留一個下限),避免戰敗→沒錢歇息→更容易再戰敗的死亡螺旋。
      const goldLost = save.gold > DEFEAT_GOLD_FLOOR ? Math.min(save.gold - DEFEAT_GOLD_FLOOR, Math.round(save.gold * DEFEAT_GOLD_LOSS_PCT)) : 0;
      save.gold -= goldLost;
      const lostMaterials = [];
      Object.keys(save.materials).forEach((matId) => {
        const have = save.materials[matId] || 0;
        if (have <= 0) return;
        const lost = Math.floor(have * DEFEAT_MATERIAL_LOSS_PCT);
        if (lost > 0) {
          save.materials[matId] -= lost;
          lostMaterials.push(`${getItem(matId)?.name || matId} x${lost}`);
        }
      });
      if (goldLost > 0) lines.push(`混亂中遺落了 ${goldLost} 枚金幣。`);
      if (lostMaterials.length) lines.push(`包裹也散落了些許材料:${lostMaterials.join('、')}。`);

      save.hp = Math.max(1, Math.round(stats.maxHp * 0.35));
      save.mp = combat.playerMp;
      save.activeCombat = null;
      save.activeVenture = null;
    }

    await saveGame(req.user.userId, save);
    res.json({ state: publicState(save), combatEnded, lines });
  });

  // ---- 裝備 ----
  // 裝備:武器/防具直接對應各自唯一的欄位;飾品是通用的 accessory,實際要放飾品一還是飾品二
  // 由前端傳入 targetSlot 指定——沒指定的話優先放空格,兩格都滿則預設放飾品一。
  router.post('/equipment/equip', async (req, res) => {
    const { itemId, targetSlot } = req.body || {};
    const save = await loadSave(req.user.userId);
    const idx = save.inventory.findIndex((i) => i.id === itemId);
    if (idx === -1) return res.status(404).json({ error: '背包內找不到該裝備' });
    const item = save.inventory[idx];
    if (!canEquip(save, item)) return res.status(400).json({ error: '職業不符,無法裝備' });
    if (item.maxDurability != null && (item.durability ?? item.maxDurability) <= 0) {
      return res.status(400).json({ error: '此裝備耐久度已耗盡,無法裝備,只能賣給雜貨店回收' });
    }

    let equipSlot = item.slot;
    if (item.slot === 'accessory') {
      if (targetSlot === 'accessory1' || targetSlot === 'accessory2') {
        equipSlot = targetSlot;
      } else if (!save.equipment.accessory1) {
        equipSlot = 'accessory1';
      } else if (!save.equipment.accessory2) {
        equipSlot = 'accessory2';
      } else {
        equipSlot = 'accessory1';
      }
    }

    const prev = save.equipment[equipSlot];
    save.equipment[equipSlot] = item;
    save.inventory.splice(idx, 1);
    if (prev) save.inventory.push(prev);
    await saveGame(req.user.userId, save);
    res.json({ state: publicState(save) });
  });

  router.post('/equipment/unequip', async (req, res) => {
    const { slot } = req.body || {};
    const save = await loadSave(req.user.userId);
    const item = save.equipment[slot];
    if (!item) return res.status(404).json({ error: '該部位沒有裝備' });
    save.equipment[slot] = null;
    save.inventory.push(item);
    await saveGame(req.user.userId, save);
    res.json({ state: publicState(save) });
  });

  // ---- 商店 ----
  router.get('/shop/:shopId', async (req, res) => {
    const shop = getShop(req.params.shopId);
    if (!shop) return res.status(404).json({ error: '無此商店' });
    const save = await loadSave(req.user.userId);
    // 套裝配方(菁英/真王):武器/副手依職業限定,只給玩家看得到自己能用的版本(防具/飾品職業通用,
    // classType 為 null 一律保留)。材料需求同樣補上中文名稱+目前持有量,跟一般配方格式一致。
    // setTierDescriptions:完整套裝效果說明(集滿幾件解鎖什麼),讓玩家在商店就能看到「值不值得湊」,
    // 不用等做完裝備穿上去才知道效果是什麼——武器/副手已有 classType 就直接代入,防具/飾品(無
    // classType)一律代入玩家自己的職業,方便玩家一眼看懂「穿上我這個職業會拿到什麼」。
    const setRecipes = getSetRecipesForShop(shop.id)
      .filter((r) => !r.classType || r.classType === save.classId)
      .map((r) => {
        const info = getSetInfo(r.setId);
        return {
          ...r,
          tierLabel: getTierNameZh(r.tier),
          setName: info?.name,
          setPieces: info?.pieces,
          setTierDescriptions: info ? describeSetTiers(info.tiers, r.classType || save.classId) : [],
          materialsDetail: Object.entries(r.materials).map(([matId, need]) => ({
            id: matId, name: getItem(matId)?.name || matId, need, have: save.materials[matId] || 0,
          })),
        };
      });
    if (shop.id === 'general') {
      return res.json({ shop, market: await getMarketSnapshot(), setRecipes });
    }
    // 配方的材料需求原本只有英文 id,前端無法直接顯示——這裡補上中文名稱與玩家目前持有數量,
    // 前端就能直接秀出「鐵礦 3/5」這種一目瞭然的格式,不用自己再查一次物品表。
    const recipes = getRareRecipes(shop.id).map((r) => ({
      ...r,
      tierLabel: getTierNameZh(r.tier),
      materialsDetail: Object.entries(r.materials).map(([matId, need]) => ({
        id: matId, name: getItem(matId)?.name || matId, need, have: save.materials[matId] || 0,
      })),
    }));
    res.json({ shop, recipes, setRecipes });
  });

  // 雜貨店回收:賣雜物/一般素材/稀有素材(是否留著製作或賣錢由玩家自行決定)或賣掉背包中的普通裝備
  // (稀有/超稀有裝備不可直接賣店,只能上架交易所)
  router.post('/shop/sell', async (req, res) => {
    const { itemId, qty, inventoryItemId } = req.body || {};
    const save = await loadSave(req.user.userId);
    if (inventoryItemId) {
      const idx = save.inventory.findIndex((i) => i.id === inventoryItemId);
      if (idx === -1) return res.status(404).json({ error: '背包內找不到該物品' });
      const item = save.inventory[idx];
      if (item.tier !== 'common') return res.status(400).json({ error: '非普通裝備無法直接賣給商店,請上架交易所' });
      const price = item.itemLevel * 2;
      save.inventory.splice(idx, 1);
      save.gold += price;
      await saveGame(req.user.userId, save);
      return res.json({ state: publicState(save), earned: price });
    }
    const item = getItem(itemId);
    if (!item || !['junk', 'material', 'rare_material', 'party_material', 'set_material'].includes(item.kind)) return res.status(400).json({ error: '此物品無法回收' });
    const have = save.materials[itemId] || 0;
    const sellQty = Math.min(Math.max(1, qty || 1), have);
    if (sellQty <= 0) return res.status(400).json({ error: '數量不足' });
    const earned = await sellItemToMarket(itemId, sellQty);
    save.materials[itemId] -= sellQty;
    save.gold += earned;
    await saveGame(req.user.userId, save);
    res.json({ state: publicState(save), earned });
  });

  router.post('/shop/buy-potion', async (req, res) => {
    const { potionId, qty } = req.body || {};
    const potion = getPotion(potionId);
    if (!potion) return res.status(400).json({ error: '無此藥水' });
    const amount = Math.max(1, Math.min(99, Math.floor(qty) || 1));
    const save = await loadSave(req.user.userId);
    const priceInfo = await getPotionPriceInfo(potionId);
    if (priceInfo.stock < amount) return res.status(400).json({ error: `庫存不足(剩餘${priceInfo.stock}瓶),請等待雜貨店回收雜物補貨` });
    if (save.gold < priceInfo.price * amount) return res.status(400).json({ error: '金幣不足' });
    const cost = await buyPotionFromMarket(potionId, amount);
    if (cost == null) return res.status(400).json({ error: '庫存不足,請等待雜貨店回收雜物補貨' });
    if (save.gold < cost) return res.status(400).json({ error: '金幣不足(價格已變動,請重新嘗試)' });
    save.gold -= cost;
    save.potions[potionId] = (save.potions[potionId] || 0) + amount;
    await saveGame(req.user.userId, save);
    res.json({ state: publicState(save), bought: amount, cost });
  });

  // 購買強化卷軸/潛能方塊:跟藥水一樣走全服供應庫存機制(見 marketEngine.js),庫存不足時無法購買,
  // 存放於 save.consumables(跟藥水分開,避免混淆)。抉擇方塊已下架,一律回 400(只能靠打王取得)。
  router.post('/shop/buy-enhance-item', async (req, res) => {
    const { itemId, qty } = req.body || {};
    const enhanceItem = getEnhanceItem(itemId);
    if (!enhanceItem) return res.status(400).json({ error: '無此物品' });
    const amount = Math.max(1, Math.min(99, Math.floor(qty) || 1));
    const save = await loadSave(req.user.userId);
    const cost = await buyEnhanceItemFromMarket(itemId, amount);
    if (cost == null) return res.status(400).json({ error: '庫存不足或此物品已不開放購買(只能靠擊敗王取得)' });
    if (save.gold < cost) return res.status(400).json({ error: '金幣不足(價格已變動,請重新嘗試)' });
    save.gold -= cost;
    save.consumables[itemId] = (save.consumables[itemId] || 0) + amount;
    await saveGame(req.user.userId, save);
    res.json({ state: publicState(save), bought: amount, cost });
  });

  // 依裝備 id 找出該裝備目前在「裝備欄」還是「背包」,兩者都用同一個物件參照,直接原地修改即可反映到對應位置
  function findEquippedOrInventoryItem(save, itemId) {
    for (const slot of GEAR_SLOTS) {
      if (save.equipment[slot]?.id === itemId) return save.equipment[slot];
    }
    return save.inventory.find((i) => i.id === itemId) || null;
  }

  // 裝備強化:每件裝備最多使用 5 次卷軸,一般卷軸每次全部現有屬性一起 -3~+3(百分比類屬性為
  // 百分點),王家卷軸(只有真王掉落)則是 -1~+5,範圍更好——不是穩定往上疊的系統,是真正有賭注
  // 的強化,運氣差可能讓裝備比原本更差,運氣好則能大幅超越基礎數值。
  router.post('/equipment/enhance', async (req, res) => {
    const { itemId, scrollId } = req.body || {};
    const save = await loadSave(req.user.userId);
    const item = findEquippedOrInventoryItem(save, itemId);
    if (!item) return res.status(404).json({ error: '找不到該裝備' });
    const scroll = getEnhanceItem(scrollId);
    if (!scroll || (scroll.kind !== 'scroll' && scroll.kind !== 'scroll_royal')) return res.status(400).json({ error: '無此強化卷軸' });
    if (!getEnhanceItemAppliesToSlot(scroll.appliesTo, item.slot)) return res.status(400).json({ error: '此卷軸不適用於該裝備部位' });
    if ((save.consumables[scrollId] || 0) < 1) return res.status(400).json({ error: '卷軸數量不足' });
    if ((item.enhanceUses || 0) >= ENHANCE_MAX_USES) return res.status(400).json({ error: `已達強化次數上限(${ENHANCE_MAX_USES}/${ENHANCE_MAX_USES})` });
    save.consumables[scrollId] -= 1;
    const result = rollEnhance(item, scroll.kind === 'scroll_royal');
    const levelText = item.enhanceLevel >= 0 ? `+${item.enhanceLevel}` : `${item.enhanceLevel}`;
    const deltaText = result.delta > 0 ? `+${result.delta}` : `${result.delta}`;
    // delta 是 -3~+3 均勻隨機,0 代表這次沒有任何效果(不算加強也不算削弱),要跟真正的加強/削弱分開講清楚
    const resultDesc = result.delta > 0 ? `這次是加強(${deltaText})` : result.delta < 0 ? `這次是削弱(${deltaText})` : '這次沒有任何效果(抽到0)';
    addLog(save, `強化「${item.name}」${resultDesc},目前淨強化 ${levelText}(還可使用 ${result.usesLeft} 次)。`);
    await saveGame(req.user.userId, save);
    res.json({ state: publicState(save), success: result.success, delta: result.delta, usesLeft: result.usesLeft, deltas: result.deltas, item });
  });

  // 潛能洗鍊:消耗一顆方塊,沒有潛能就從稀有開始,已有則重洗詞條並有機率升階
  router.post('/equipment/cube', async (req, res) => {
    const { itemId, cubeId } = req.body || {};
    const save = await loadSave(req.user.userId);
    const item = findEquippedOrInventoryItem(save, itemId);
    if (!item) return res.status(404).json({ error: '找不到該裝備' });
    const cube = getEnhanceItem(cubeId);
    if (!cube || cube.kind !== 'cube') return res.status(400).json({ error: '無此潛能方塊' });
    if ((save.consumables[cubeId] || 0) < 1) return res.status(400).json({ error: '方塊數量不足' });
    save.consumables[cubeId] -= 1;
    const result = rollCube(item);
    addLog(save, `為「${item.name}」洗鍊潛能${result.upgraded ? `,升階至【${getTierNameZh(item.potential.tier)}】!` : '。'}`);
    await saveGame(req.user.userId, save);
    res.json({ state: publicState(save), upgraded: result.upgraded, item });
  });

  // 抉擇方塊(cube_potential_choice):固定洗出3條詞條,但「先預覽再選擇」——這裡只消耗方塊+
  // 產生預覽(暫存在伺服器記憶體,不接受前端直接帶入詞條內容,避免竄改數值),不會修改裝備本身。
  router.post('/equipment/cube-choice-preview', async (req, res) => {
    const { itemId } = req.body || {};
    const save = await loadSave(req.user.userId);
    const item = findEquippedOrInventoryItem(save, itemId);
    if (!item) return res.status(404).json({ error: '找不到該裝備' });
    if ((save.consumables.cube_potential_choice || 0) < 1) return res.status(400).json({ error: '抉擇方塊數量不足' });
    save.consumables.cube_potential_choice -= 1;
    const preview = rollCubeChoicePreview(req.user.userId, itemId);
    await saveGame(req.user.userId, save);
    res.json({ state: publicState(save), preview });
  });

  // 套用抉擇方塊預覽結果:讀取伺服器暫存的預覽(不是前端傳來的資料),套用後清除暫存
  router.post('/equipment/cube-choice-apply', async (req, res) => {
    const { itemId } = req.body || {};
    const save = await loadSave(req.user.userId);
    const item = findEquippedOrInventoryItem(save, itemId);
    if (!item) return res.status(404).json({ error: '找不到該裝備' });
    const preview = getPendingChoicePreview(req.user.userId, itemId);
    if (!preview) return res.status(400).json({ error: '沒有可套用的預覽結果,請先使用抉擇方塊' });
    item.potential = preview;
    clearChoicePreview(req.user.userId);
    addLog(save, `為「${item.name}」套用了抉擇方塊洗出的新潛能。`);
    await saveGame(req.user.userId, save);
    res.json({ state: publicState(save), item });
  });

  // 放棄抉擇方塊預覽結果:保留原本潛能不變(方塊已消耗,不退還),僅清除伺服器暫存狀態
  router.post('/equipment/cube-choice-cancel', async (req, res) => {
    clearChoicePreview(req.user.userId);
    res.json({ ok: true });
  });

  // 裝備製作:稀有配方(blacksmith/leather/magic/church)與套裝配方(elite/trueboss set,
  // 消耗地圖專屬材料)共用同一個入口——先查稀有配方清單,找不到再查套裝配方清單。
  // 兩者都只看素材+金幣是否足夠,不設等級門檻,有材料就能做。
  router.post('/shop/craft', async (req, res) => {
    const { shopId, recipeId } = req.body || {};
    const save = await loadSave(req.user.userId);
    const rareRecipe = getRareRecipes(shopId).find((r) => r.id === recipeId);
    const setRecipe = rareRecipe ? null : getSetRecipeById(shopId, recipeId);
    const recipe = rareRecipe || setRecipe;
    if (!recipe) return res.status(400).json({ error: '無此配方' });
    if (recipe.classType && recipe.classType !== save.classId) return res.status(400).json({ error: '職業不符,無法製作此配方' });
    if (save.gold < recipe.gold) return res.status(400).json({ error: '金幣不足' });
    const missing = Object.entries(recipe.materials).filter(([matId, need]) => (save.materials[matId] || 0) < need);
    if (missing.length > 0) {
      const names = missing.map(([matId]) => getItem(matId)?.name || matId).join('、');
      return res.status(400).json({ error: `素材不足:缺少 ${names}` });
    }
    save.gold -= recipe.gold;
    Object.entries(recipe.materials).forEach(([matId, need]) => { save.materials[matId] -= need; });
    const item = rareRecipe ? craftRareItem(shopId, recipe) : craftSetItem(recipe);
    save.inventory.push(item);
    addLog(save, `於${getShop(shopId).name}打造出「${item.name}」!`);
    await saveGame(req.user.userId, save);
    res.json({ state: publicState(save), crafted: item });
  });

  // ---- 玩家交易所 ----
  router.get('/auction/listings', async (req, res) => {
    res.json({ listings: await getListings(), feePct: LISTING_FEE_PCT });
  });

  router.post('/auction/list', async (req, res) => {
    const { itemId, price } = req.body || {};
    const save = await loadSave(req.user.userId);
    const idx = save.inventory.findIndex((i) => i.id === itemId);
    if (idx === -1) return res.status(404).json({ error: '背包內找不到該物品(請先卸下裝備)' });
    const candidateItem = save.inventory[idx];
    // 耐久度歸零的裝備不能上架賣給其他玩家(等於賣一個報廢品),只能去雜貨店賣掉回收
    if (candidateItem.maxDurability != null && (candidateItem.durability ?? candidateItem.maxDurability) <= 0) {
      return res.status(400).json({ error: '此裝備耐久度已耗盡,無法上架交易所,只能賣給雜貨店回收' });
    }
    const numPrice = Math.round(Number(price));
    if (!numPrice || numPrice <= 0) return res.status(400).json({ error: '請輸入有效的開價' });
    const fee = Math.max(1, Math.round(numPrice * LISTING_FEE_PCT));
    if (save.gold < fee) return res.status(400).json({ error: `金幣不足,上架手續費需 ${fee} 枚` });
    const [item] = save.inventory.splice(idx, 1);
    save.gold -= fee;
    await listItem(req.user.userId, await getDisplayName(req.user.userId), item, numPrice);
    await saveGame(req.user.userId, save);
    res.json({ state: publicState(save), fee });
  });

  router.post('/auction/buy', async (req, res) => {
    const { listingId } = req.body || {};
    const listing = await getListingById(listingId);
    if (!listing) return res.status(404).json({ error: '此上架物品已不存在(可能已售出或過期)' });
    if (listing.sellerId === req.user.userId) return res.status(400).json({ error: '不能購買自己上架的物品' });
    const save = await loadSave(req.user.userId);
    if (save.gold < listing.price) return res.status(400).json({ error: '金幣不足' });
    await removeListing(listingId);
    save.gold -= listing.price;
    save.inventory.push(listing.item);
    await saveGame(req.user.userId, save);

    const sellerRow = await getSaveStmt.get(listing.sellerId);
    if (sellerRow) {
      const sellerSave = JSON.parse(sellerRow.data);
      sellerSave.gold += listing.price;
      addLog(sellerSave, `你上架的「${listing.item.name}」被 ${(await getDisplayName(req.user.userId)) || '一位玩家'} 以 ${listing.price} 枚金幣購入。`);
      await saveGame(listing.sellerId, sellerSave);
    }
    res.json({ state: publicState(save) });
  });

  router.post('/auction/cancel', async (req, res) => {
    const { listingId } = req.body || {};
    const listing = await getListingById(listingId);
    if (!listing) return res.status(404).json({ error: '此上架物品已不存在' });
    if (listing.sellerId !== req.user.userId) return res.status(403).json({ error: '這不是你上架的物品' });
    await removeListing(listingId);
    const save = await loadSave(req.user.userId);
    save.inventory.push(listing.item);
    await saveGame(req.user.userId, save);
    res.json({ state: publicState(save) });
  });

  return router;
}
