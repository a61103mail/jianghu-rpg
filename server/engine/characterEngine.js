// 角色狀態模組(奇幻練功MMO):等級制(1~30)+ STR/DEX/INT/LUK 自由配點,取代先前武俠版本的境界修煉系統。
import { getClass, expForNextLevel, STAT_POINTS_PER_LEVEL, MAX_LEVEL } from '../data/classData.js';
import { GEAR_SLOTS } from '../data/itemData.js';
import { getItemTotalStats } from './itemEngine.js';

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
export function computeStats(save) {
  const cls = getClass(save.classId);
  const alloc = save.allocatedStats || { str: 0, dex: 0, int: 0, luk: 0 };
  const str = cls.baseStat.str + (alloc.str || 0);
  const dex = cls.baseStat.dex + (alloc.dex || 0);
  const int_ = cls.baseStat.int + (alloc.int || 0);
  const luk = cls.baseStat.luk + (alloc.luk || 0);

  let maxHp = cls.baseHp + cls.hpPerLevel * (save.level - 1) + str * 3;
  let maxMp = cls.baseMp + cls.mpPerLevel * (save.level - 1) + int_ * 2;
  let atk = save.classId === 'archer' ? Math.round(dex * 1.4 + str * 0.2) : Math.round(str * 1.4 + dex * 0.3);
  let matk = Math.round(int_ * 1.5);
  let def = Math.round(str * 0.3 + dex * 0.3 + save.level * 0.5);
  let critRate = 0.05 + luk * 0.002 + dex * 0.001;

  // 光環(被動)技能:常駐加成,需等級達到 unlockLevel 才會生效(不是一開始就有)
  const aura = cls.skills.aura;
  if (save.level >= aura.unlockLevel) {
    if (aura.effect.defPct) def = Math.round(def * (1 + aura.effect.defPct));
    if (aura.effect.critRatePct) critRate += aura.effect.critRatePct;
  }

  GEAR_SLOTS.forEach((slot) => {
    const item = save.equipment[slot];
    if (!item) return;
    const bonus = getItemTotalStats(item);
    atk += bonus.atk || 0;
    matk += bonus.matk || 0;
    def += bonus.def || 0;
    maxHp += bonus.hp || 0;
    maxMp += bonus.mp || 0;
    if (bonus.critRatePct) critRate += bonus.critRatePct / 100;
  });

  // 潛能(方塊洗出的隨機百分比詞條):加總所有已裝備物品的潛能詞條,最後以乘算方式套用在對應屬性上
  // (潛能詞條本身已是小數形式的百分比,如 0.03 代表 +3%,不需要再除以100,跟上方 item.stats.critRatePct 的「百分點」表示法不同)
  let potentialAtkPct = 0, potentialMatkPct = 0, potentialDefPct = 0, potentialHpPct = 0, potentialCritRatePct = 0;
  GEAR_SLOTS.forEach((slot) => {
    const item = save.equipment[slot];
    if (!item?.potential?.lines) return;
    item.potential.lines.forEach((line) => {
      if (line.key === 'atkPct') potentialAtkPct += line.value;
      else if (line.key === 'matkPct') potentialMatkPct += line.value;
      else if (line.key === 'defPct') potentialDefPct += line.value;
      else if (line.key === 'hpPct') potentialHpPct += line.value;
      else if (line.key === 'critRatePct') potentialCritRatePct += line.value;
    });
  });
  atk = Math.round(atk * (1 + potentialAtkPct));
  matk = Math.round(matk * (1 + potentialMatkPct));
  def = Math.round(def * (1 + potentialDefPct));
  maxHp = maxHp * (1 + potentialHpPct);
  critRate += potentialCritRatePct;

  return {
    str, dex, int: int_, luk,
    atk, matk, def, critRate,
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
