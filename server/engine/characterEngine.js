// 角色狀態模組(奇幻練功MMO):等級制(1~30)+ STR/DEX/INT/LUK 自由配點,取代先前武俠版本的境界修煉系統。
import { getClass, expForNextLevel, STAT_POINTS_PER_LEVEL, MAX_LEVEL } from '../data/classData.js';
import { GEAR_SLOTS } from '../data/itemData.js';
import { getItemTotalStats } from './itemEngine.js';
import { computeEvasionRate } from './combatEngine.js';
import { getSetInfo, CLASS_SPECIAL_STAT_KEY, describeSetTiers } from '../data/setGearData.js';

export const HP_REGEN_PCT_PER_MINUTE = 0.04; // 氣血自然恢復:每分鐘回復上限的 4%(離線也會累積),城鎮/藥水才是主要恢復手段
export const MP_REGEN_PCT_PER_MINUTE = 0.06; // 真力自然恢復略快於氣血
// 會心率上限:LUK/DEX配點 + 裝備critRatePct + 潛能 + 套裝加成 + 光環被動疊加起來理論上可以無限疊加,
// 沒有這道上限的話,堆到100%以上只是純粹浪費(超過100%的部分完全沒有實際效果,任何一擊必定觸發
// 會心早就已經到頂了),玩家卻感覺不出來「這樣點/洗到底有沒有用」。訂在89%(而非100%)保留一點點
// 「非會心」的機率下限,不讓任何build完全抹除傷害的隨機性。
export const CRIT_RATE_CAP = 0.89;

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
// 裝備耐久度歸零(0/上限,見 itemEngine.js MAX_DURABILITY)視同「損壞、暫時卸下」——不提供任何
// 數值加成,但保留在裝備欄位上讓玩家看得到(需要玩家自己去雜貨店賣掉騰出空位,見 game.js 的耐久相關邏輯)。
function isItemUsable(item) {
  if (!item) return false;
  if (item.maxDurability == null) return true; // 飾品沒有耐久度上限,永遠有效
  return (item.durability ?? item.maxDurability) > 0;
}

// 套裝效果(菁英2件2條/真王4件4條,見 setGearData.js):統計玩家目前裝備中每個 setId 各穿了幾件,
// 依 tiers 的 count 門檻彙總已解鎖的效果加成。value 是百分比數字(如8代表8%),這裡轉成小數方便套用。
function countEquippedSets(save) {
  const setCounts = {};
  GEAR_SLOTS.forEach((slot) => {
    const item = save.equipment[slot];
    if (!isItemUsable(item) || !item.setId) return;
    setCounts[item.setId] = (setCounts[item.setId] || 0) + 1;
  });
  return setCounts;
}

function computeSetBonuses(save) {
  const setCounts = countEquippedSets(save);
  const bonuses = { atkPowerPct: 0, classSpecialPct: 0, allRawStatsPct: 0, allStatsExceptSpecialPct: 0 };
  Object.entries(setCounts).forEach(([setId, count]) => {
    const info = getSetInfo(setId);
    if (!info) return;
    info.tiers.forEach((tier) => {
      if (count >= tier.count) bonuses[tier.key] += tier.value / 100;
    });
  });
  return bonuses;
}

// 供前端顯示「目前穿著套裝進度」:只列出玩家目前至少穿1件的套裝,附總部位數/已穿件數/
// 完整效果定義(每個門檻是否已解鎖,text 是已代入職業特色的中文描述),玩家不用自己心算
// 就能看出套裝效果觸發到哪裡(見套裝效果 Modal)。
export function getEquippedSetProgress(save) {
  const setCounts = countEquippedSets(save);
  return Object.entries(setCounts).map(([setId, count]) => {
    const info = getSetInfo(setId);
    if (!info) return null;
    const descriptions = describeSetTiers(info.tiers, save.classId);
    return {
      setId,
      name: info.name,
      pieces: info.pieces,
      equippedCount: count,
      tiers: info.tiers.map((t, i) => ({ ...t, text: descriptions[i].text, unlocked: count >= t.count })),
    };
  }).filter(Boolean);
}

export function computeStats(save) {
  const cls = getClass(save.classId);
  const alloc = save.allocatedStats || { str: 0, dex: 0, int: 0, luk: 0 };
  const setBonuses = computeSetBonuses(save);

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

  // 套裝效果「全屬性%」(allRawStatsPct,真王套裝第3件解鎖):str/dex/int/luk 一起乘算提升,
  // 要在此處(衍生屬性計算之前)套用,才能連帶把攻擊力/防禦/氣血等下游公式一起放大。
  const rawStatsMult = 1 + setBonuses.allRawStatsPct;
  const str = (cls.baseStat.str + (alloc.str || 0) + gearStr) * rawStatsMult;
  const dex = (cls.baseStat.dex + (alloc.dex || 0) + gearDex) * rawStatsMult;
  const int_ = (cls.baseStat.int + (alloc.int || 0) + gearInt) * rawStatsMult;
  const luk = (cls.baseStat.luk + (alloc.luk || 0) + gearLuk) * rawStatsMult;

  let maxHp = cls.baseHp + cls.hpPerLevel * (save.level - 1) + str * 3;
  let maxMp = cls.baseMp + cls.mpPerLevel * (save.level - 1) + int_ * 2;
  // 攻擊力:弓箭手看敏捷、盜賊看幸運(一魚兩吃,幸運同時也是會心率的來源),其餘職業看力量。
  let atk = save.classId === 'archer' ? Math.round(dex * 1.4 + str * 0.2)
    : save.classId === 'rogue' ? Math.round(luk * 1.4 + dex * 0.3)
    : Math.round(str * 1.4 + dex * 0.3);
  let matk = Math.round(int_ * 1.5);
  let def = Math.round(str * 0.3 + dex * 0.3 + save.level * 0.5);
  let critRate = 0.05 + luk * 0.002 + dex * 0.001;
  // 迴避率:DEX + 等級共同決定,上限80%(見 combatEngine.js 說明)。弓箭手天生DEX高、
  // 全點DEX時迴避明顯優於其他職業,戰士天生DEX低、迴避明顯較弱但氣血/防禦更高——
  // 這條公式讓「弓箭手擅長閃避、戰士擅長硬扛」的職業定位自然浮現,不需要另外寫特例判斷職業。
  let evasionRate = computeEvasionRate({ dex, level: save.level });
  // 格擋率:戰士的職業特色機制,職業基礎值 + 疊加裝備(尤其是副手)提供的加成。其餘職業基礎值為0。
  let blockRatePct = cls.blockRatePct || 0;
  // 真氣減傷:法師專屬機制,固定50%、不浮動、不可被任何裝備品質/強化/潛能/套裝疊加提升——
  // 只要「玩家職業是法師」且「已裝備副手」就直接生效,嚴格只看 save.classId,不看裝備本身
  // 實際帶了什麼屬性數值。這是刻意的防禦性寫法:先前弓箭手曾經被誤觸發這個機制扣到MP,
  // 之後不論任何裝備資料是否有異常殘留,非法師職業永遠不可能算出非0的真氣減傷。
  const MAGE_OFFHAND_REDUCTION_PCT = 0.5;
  const magicDamageReductionPct = (save.classId === 'mage' && isItemUsable(save.equipment.offhand)) ? MAGE_OFFHAND_REDUCTION_PCT : 0;
  // 會心傷害倍率:預設1.6倍(即 combatEngine.js 原本寫死的會心傷害)。盜賊專屬機制——副手/套裝
  // 提供的 critDamagePct 疊加在這個基礎倍率上,呼應盜賊皮薄但爆發傷害極高的定位。其餘職業
  // 沒有任何來源可以提升這個值,永遠停留在基礎的1.6倍。
  const BASE_CRIT_DAMAGE_MULT = 1.6;
  let critDamageMult = BASE_CRIT_DAMAGE_MULT;

  // 光環(被動)技能:常駐加成,需等級達到 unlockLevel 才會生效(不是一開始就有)
  const aura = cls.skills.aura;
  if (save.level >= aura.unlockLevel) {
    if (aura.effect.defPct) def = Math.round(def * (1 + aura.effect.defPct));
    if (aura.effect.critRatePct) critRate += aura.effect.critRatePct;
  }

  // 職業特色防禦/輸出機制的裝備加成(格擋率/迴避率/會心傷害):嚴格只認 save.classId 決定是否
  // 生效,不是看裝備本身帶了什麼屬性——避免任何裝備資料異常導致非對應職業被誤套用到不屬於
  // 自己的機制(同一份 GEAR_SLOTS 迴圈曾經對所有職業一視同仁疊加,是先前 bug 的根源)。
  let evasionRatePctFromGear = 0;
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
    if (save.classId === 'warrior' && bonus.blockRatePct) {
      blockRatePct += bonus.blockRatePct / 100;
    } else if (save.classId === 'archer' && bonus.evasionRatePct) {
      evasionRatePctFromGear += bonus.evasionRatePct / 100;
    } else if (save.classId === 'rogue' && bonus.critDamagePct) {
      critDamageMult += bonus.critDamagePct / 100;
    }
  });
  evasionRate = Math.min(0.8, evasionRate + evasionRatePctFromGear);

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
  // 套裝效果「攻擊力%」(atkPowerPct,菁英/真王套裝第1件即解鎖)跟潛能的攻擊強度%一起套用同一屬性
  const totalAtkPowerPct = potentialAtkPowerPct + setBonuses.atkPowerPct;
  if (cls.attackType === 'matk') matk = Math.round(matk * (1 + totalAtkPowerPct));
  else atk = Math.round(atk * (1 + totalAtkPowerPct));
  def = Math.round(def * (1 + potentialDefPct));
  maxHp = maxHp * (1 + potentialHpPct);
  critRate += potentialCritRatePct;

  // 套裝效果「職業特色屬性%」(classSpecialPct,菁英第2件/真王第2件解鎖):依職業對應到
  // 格擋率(戰士)、真力上限%(法師——真氣減傷固定50%不可疊加,套裝改給真力上限讓法師能撐更多
  // 次減傷)、迴避率(弓箭手)或會心傷害%(盜賊)。
  if (setBonuses.classSpecialPct > 0) {
    const specialKey = CLASS_SPECIAL_STAT_KEY[save.classId];
    if (specialKey === 'blockRatePct') blockRatePct += setBonuses.classSpecialPct;
    else if (specialKey === 'maxMpPct') maxMp *= (1 + setBonuses.classSpecialPct);
    else if (specialKey === 'evasionRate') evasionRate = Math.min(0.8, evasionRate + setBonuses.classSpecialPct);
    else if (specialKey === 'critDamagePct') critDamageMult += setBonuses.classSpecialPct;
  }
  blockRatePct = Math.max(0, Math.min(0.95, blockRatePct));

  // 套裝效果「全部能力%」(allStatsExceptSpecialPct,真王套裝第4件、集滿全套才解鎖的終極效果):
  // 除了上面已經處理過的職業特色屬性外,其餘全部現有戰鬥屬性一起乘算提升(含會心傷害倍率)。
  if (setBonuses.allStatsExceptSpecialPct > 0) {
    const mult = 1 + setBonuses.allStatsExceptSpecialPct;
    atk = Math.round(atk * mult);
    matk = Math.round(matk * mult);
    def = Math.round(def * mult);
    maxHp = maxHp * mult;
    maxMp = maxMp * mult;
    critRate *= mult;
    critDamageMult *= mult;
  }

  // 會心率最終上限(見上方 CRIT_RATE_CAP 說明):不論配點/裝備/潛能/套裝疊加到多高,一律鎖在89%,
  // 超過的部分是純粹溢出、沒有任何實際效果。
  critRate = Math.min(CRIT_RATE_CAP, critRate);

  return {
    str: Math.round(str), dex: Math.round(dex), int: Math.round(int_), luk: Math.round(luk),
    atk, matk, def, critRate, evasionRate, blockRatePct, magicDamageReductionPct, critDamageMult,
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
