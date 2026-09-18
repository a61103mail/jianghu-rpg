// 角色狀態模組(奇幻練功MMO):等級制(1~30)+ STR/DEX/INT/LUK 自由配點,取代先前武俠版本的境界修煉系統。
import { getClass, expForNextLevel, STAT_POINTS_PER_LEVEL, MAX_LEVEL } from '../data/classData.js';
import { GEAR_SLOTS } from '../data/itemData.js';
import { getItemTotalStats } from './itemEngine.js';
import { computeEvasionRate } from './combatEngine.js';

export const HP_REGEN_PCT_PER_MINUTE = 0.04; // 氣血自然恢復:每分鐘回復上限的 4%(離線也會累積),城鎮/藥水才是主要恢復手段
export const MP_REGEN_PCT_PER_MINUTE = 0.06; // 真力自然恢復略快於氣血

export function createDefaultSave(classId = 'warrior') {
  const cls = getClass(classId);
  return {
    classId,
    classChosen: false, // 是否已由玩家「主動選擇」職業
    level: 1,
    exp: 0,
    statPoints: 0, // 尚未分配的自由屬性點(每升1級 +5點)
    allocatedStats: { str: 0, dex: 0, int: 0, luk: 0 }, // 玩家自行分配、疊加在職業基礎值之上
    equipment: GEAR_SLOTS.reduce((acc, slot) => ({ ...acc, [slot]: null }), {}),
    inventory: [],
    materials: {}, // 雜物/素材/稀有素材統一存放於此(itemId -> count),依 itemData.js 的 kind 分類
    potions: {}, // potionId -> count
    consumables: {}, // 強化卷軸/潛能方塊 -> count(裝備強化用,見 enhanceEngine.js,跟藥水分開存放避免混淆)
    gold: 50,
    hp: cls.baseHp,
    mp: cls.baseMp,
    lastHpRegenAt: Date.now(),
    lastMpRegenAt: Date.now(),
    currentMapId: 'novice_plains',
    bossCooldowns: {}, // { [mapId]: { miniBossReadyAt, bossReadyAt } } 個人進度制,不是全服搶王
    activeCombat: null,
    activeVenture: null,
    log: [],
  };
}

export function computeHpRegen(lastRegenAt, currentHp, maxHp) {
  const now = Date.now();
  const elapsedMinutes = Math.max(0, (now - lastRegenAt) / 60000);
  const regen = Math.floor(elapsedMinutes * maxHp * HP_REGEN_PCT_PER_MINUTE);
  if (regen <= 0) return { hp: currentHp, lastRegenAt };
  return { hp: Math.min(maxHp, currentHp + regen), lastRegenAt: now };
}

export function computeMpRegen(lastRegenAt, currentMp, maxMp) {
  const now = Date.now();
  const elapsedMinutes = Math.max(0, (now - lastRegenAt) / 60000);
  const regen = Math.floor(elapsedMinutes * maxMp * MP_REGEN_PCT_PER_MINUTE);
  if (regen <= 0) return { mp: currentMp, lastRegenAt };
  return { mp: Math.min(maxMp, currentMp + regen), lastRegenAt: now };
}

// 依職業基礎值 + 玩家配點 + 等級 + 裝備,計算角色目前完整戰鬥屬性
// 裝備耐久度歸零(0/500)視同「損壞、暫時卸下」——不提供任何數值加成,但保留在裝備欄位上讓玩家
// 看得到(需要玩家自己去雜貨店賣掉騰出空位或修理,見 game.js 的耐久相關邏輯)。
function isItemUsable(item) {
  if (!item) return false;
  if (item.maxDurability == null) return true; // 飾品沒有耐久度上限,永遠有效
  return (item.durability ?? item.maxDurability) > 0;
}

export function computeStats(save) {
  const cls = getClass(save.classId);
  const alloc = save.allocatedStats || { str: 0, dex: 0, int: 0, luk: 0 };

  // 裝備直接提供的原始屬性加成(STR/DEX/INT/LUK):跟玩家自行配點「完全等價」疊加,
  // 一起流入下方攻擊力/防禦/氣血/會心/迴避的衍生公式——而不是額外獨立加在最終數值上。
  // 這讓裝備能真正把玩家推向某個build方向(例如DEX裝備讓弓箭手的迴避build更進一步),
  // 而不只是單純疊加atk/def這些「已經算好」的死數字。
  let gearStr = 0, gearDex = 0, gearInt = 0, gearLuk = 0;
  GEAR_SLOTS.forEach((slot) => {
    const item = save.equipment[slot];
    if (!isItemUsable(item) || !item.stats) return;
    gearStr += item.stats.str || 0;
    gearDex += item.stats.dex || 0;
    gearInt += item.stats.int || 0;
    gearLuk += item.stats.luk || 0;
  });

  const str = cls.baseStat.str + (alloc.str || 0) + gearStr;
  const dex = cls.baseStat.dex + (alloc.dex || 0) + gearDex;
  const int_ = cls.baseStat.int + (alloc.int || 0) + gearInt;
  const luk = cls.baseStat.luk + (alloc.luk || 0) + gearLuk;

  let maxHp = cls.baseHp + cls.hpPerLevel * (save.level - 1) + str * 3;
  let maxMp = cls.baseMp + cls.mpPerLevel * (save.level - 1) + int_ * 2;
  let atk = save.classId === 'archer' ? Math.round(dex * 1.4 + str * 0.2) : Math.round(str * 1.4 + dex * 0.3);
  let matk = Math.round(int_ * 1.5);
  let def = Math.round(str * 0.3 + dex * 0.3 + save.level * 0.5);
  let critRate = 0.05 + luk * 0.002 + dex * 0.001;
  // 迴避率:DEX + 等級共同決定,上限80%(見 combatEngine.js 說明)。弓箭手天生DEX高、
  // 全點DEX時迴避明顯優於其他職業,戰士天生DEX低、迴避明顯較弱但氣血/防禦更高——
  // 這條公式讓「弓箭手擅長閃避、戰士擅長硬扛」的職業定位自然浮現,不需要另外寫特例判斷職業。
  let evasionRate = computeEvasionRate({ dex, level: save.level });
  // 格擋率:戰士/牧師的職業特色機制,職業基礎值(牧師較高、戰士是牧師的一半,見 classData.js)
  // 疊加裝備(尤其是副手)提供的加成。法師/弓箭手基礎值為0,弓箭手維持迴避為主軸,
  // 法師則改用下面的真氣減傷%(magicDamageReductionPct,完全來自副手裝備,無職業基礎值)。
  let blockRatePct = cls.blockRatePct || 0;
  // 真氣減傷%:法師副手專屬機制,固定生效不看機率(見 combatEngine.js rollDamage),封頂80%避免傷害完全歸零。
  let magicDamageReductionPct = 0;

  // 光環(被動)技能:常駐加成,需等級達到 unlockLevel 才會生效(不是一開始就有)
  const aura = cls.skills.aura;
  if (save.level >= aura.unlockLevel) {
    if (aura.effect.defPct) def = Math.round(def * (1 + aura.effect.defPct));
    if (aura.effect.critRatePct) critRate += aura.effect.critRatePct;
  }

  GEAR_SLOTS.forEach((slot) => {
    const item = save.equipment[slot];
    if (!isItemUsable(item)) return;
    const bonus = getItemTotalStats(item);
    atk += bonus.atk || 0;
    matk += bonus.matk || 0;
    def += bonus.def || 0;
    maxHp += bonus.hp || 0;
    maxMp += bonus.mp || 0;
    if (bonus.critRatePct) critRate += bonus.critRatePct / 100;
    if (bonus.blockRatePct) blockRatePct += bonus.blockRatePct / 100;
    if (bonus.magicDamageReductionPct) magicDamageReductionPct += bonus.magicDamageReductionPct / 100;
  });
  blockRatePct = Math.max(0, Math.min(0.95, blockRatePct));
  magicDamageReductionPct = Math.max(0, Math.min(0.8, magicDamageReductionPct));

  // 潛能(方塊洗出的隨機百分比詞條):加總所有已裝備物品的潛能詞條,最後以乘算方式套用在對應屬性上
  // (潛能詞條本身已是小數形式的百分比,如 0.03 代表 +3%,不需要再除以100,跟上方 item.stats.critRatePct 的「百分點」表示法不同)。
  // 攻擊強度(atkPowerPct)統一套用到該職業實際使用的攻擊屬性(物理職業吃atk、魔法職業吃matk)——
  // 先前分成 atkPct/matkPct 兩條獨立詞條,對任何職業而言永遠有一半的洗鍊結果是完全無用的死詞條,
  // 合併成單一詞條後,不管洗到什麼結果都對自己有意義。
  let potentialAtkPowerPct = 0, potentialDefPct = 0, potentialHpPct = 0, potentialCritRatePct = 0;
  GEAR_SLOTS.forEach((slot) => {
    const item = save.equipment[slot];
    if (!isItemUsable(item) || !item?.potential?.lines) return;
    item.potential.lines.forEach((line) => {
      if (line.key === 'atkPowerPct') potentialAtkPowerPct += line.value;
      else if (line.key === 'defPct') potentialDefPct += line.value;
      else if (line.key === 'hpPct') potentialHpPct += line.value;
      else if (line.key === 'critRatePct') potentialCritRatePct += line.value;
    });
  });
  if (cls.attackType === 'matk') matk = Math.round(matk * (1 + potentialAtkPowerPct));
  else atk = Math.round(atk * (1 + potentialAtkPowerPct));
  def = Math.round(def * (1 + potentialDefPct));
  maxHp = maxHp * (1 + potentialHpPct);
  critRate += potentialCritRatePct;

  return {
    str, dex, int: int_, luk,
    atk, matk, def, critRate, evasionRate, blockRatePct, magicDamageReductionPct,
    maxHp: Math.round(maxHp), maxMp: Math.round(maxMp),
    hp: Math.round(maxHp), mp: Math.round(maxMp), // 相容別名:partyEngine/duelEngine 沿用舊欄位名稱取用「滿血滿真力」初始值
    level: save.level,
    attackType: cls.attackType,
  };
}

export function addLog(save, text) {
  save.log.unshift({ text, at: Date.now() });
  if (save.log.length > 50) save.log.length = 50;
}

// 檢查是否累積了足夠經驗以升級(一次呼叫可連續升多級,並發放對應的自由屬性點)
export function checkLevelUp(save) {
  let leveledTo = null;
  while (save.level < MAX_LEVEL) {
    const needed = expForNextLevel(save.level);
    if (save.exp < needed) break;
    save.exp -= needed;
    save.level += 1;
    save.statPoints += STAT_POINTS_PER_LEVEL;
    leveledTo = save.level;
  }
  return leveledTo;
}
