// 組隊副本系統(即時):以記憶體管理暫時性的隊伍與共同戰鬥狀態,不寫入存檔資料庫
// (隊伍本身是暫時的社交狀態,重開伺服器即清空,不影響各自的主線存檔進度)。
//
// 本輪重新設計(取代先前「大家一起打同一隻大王的血條、只能點攻擊」的陽春版本):
// - 兩波結構:第一波為地圖小怪(數量依隊伍人數增減),第二波為地圖大王,清完第一波才會出現第二波,
//   讓「副本」真正有「過關卡」的節奏感,而不是單一場戰鬥。
// - 每位成員可使用自己的完整技能組(單體/範圍/BUFF/防禦),不再只能點「攻擊」,
//   各自追蹤自己的HP/MP/BUFF,傷害計算與解鎖等級規則跟單人戰鬥完全一致。
// - 王波完整套用 monsterData.js 的新機制:物理/魔法抗性(依攻擊者職業的攻擊屬性判定)、
//   蓄力預警與爆發傷害、血量門檻觸發狂暴——不再是空有數值、純比拼誰打得痛的無腦互毆。
// - 通關獎勵:每位成員各自獲得所有波次擊敗敵人的完整經驗值,並各自獨立擲骰掉落表
//   (材料/雜物/裝備),不用「比手速搶最後一擊」,人人都有實質收穫。
import { getMap, getMonster } from '../data/monsterData.js';
import { getClass } from '../data/classData.js';
import { rollDamage, narrateAttack, narrateEnemyAttack, sumBuffValue, tickBuffs, consumeWeaponDurability, consumeArmorDurability } from './combatEngine.js';

const parties = new Map(); // partyCode -> party

function randomCode() {
  return Math.random().toString(36).slice(2, 7).toUpperCase();
}

export function createParty(leader) {
  // 建立新隊伍前,先清掉此玩家可能殘留在「其他隊伍」的舊身分——先前斷線時只會清空 socketId、
  // 不會真的移除成員資格(見 disconnect 處理的說明),若玩家很久以前組過隊卻沒有正式「離隊」就
  // 直接關閉分頁,對他來說形同已經離開,但伺服器記憶體裡這個隊伍其實還留著他的殘影,下次他再
  // 建立新隊伍時,舊隊伍的殘影跟新隊伍是兩個獨立的東西,不會互相污染,但為了避免同一玩家同時
  // 「掛名」在多個隊伍造成混亂與資料不一致,一律先清乾淨舊身分再建立新隊伍。
  leaveParty(leader.userId);
  let code = randomCode();
  while (parties.has(code)) code = randomCode();
  const party = {
    code,
    members: [leader], // { userId, username, classId, stats, socketId }
    combat: null,
  };
  parties.set(code, party);
  return party;
}

export function getParty(code) {
  return parties.get(code);
}

export function findPartyByUser(userId) {
  for (const party of parties.values()) {
    if (party.members.some((m) => m.userId === userId)) return party;
  }
  return null;
}

export function joinParty(code, member) {
  const party = parties.get(code);
  if (!party) return null;
  if (party.combat) return null; // 戰鬥進行中不可中途加入
  if (party.members.length >= 4) return null;
  // 加入新隊伍前同樣先清掉舊隊伍的殘留身分,理由同 createParty
  if (findPartyByUser(member.userId)?.code !== code) leaveParty(member.userId);
  if (!party.members.find((m) => m.userId === member.userId)) {
    party.members.push(member);
  }
  return party;
}

export function leaveParty(userId) {
  const party = findPartyByUser(userId);
  if (!party) return null;
  party.members = party.members.filter((m) => m.userId !== userId);
  if (party.members.length === 0) {
    parties.delete(party.code);
    return null;
  }
  return party;
}

// 副本結束(通關或落敗)後清理:任何在戰鬥途中斷線、socketId 已是 null 的成員視同已離隊——
// 不然這些「幽靈成員」會一直掛在隊伍名單裡,下次真正的隊員回來看到的人數對不上實際在線人數,
// 也會讓王波規模(依人數決定隻數/血量倍率)被幽靈成員錯誤地放大。
export function purgeDisconnectedMembers(party) {
  if (!party) return;
  const ghosts = party.members.filter((m) => !m.socketId).map((m) => m.userId);
  ghosts.forEach((uid) => leaveParty(uid));
}

export function updateMemberSocket(userId, socketId) {
  const party = findPartyByUser(userId);
  if (!party) return null;
  const member = party.members.find((m) => m.userId === userId);
  if (member) member.socketId = socketId;
  return party;
}

// 依 monsterData.js 的怪物資料實例化一份「戰鬥用副本」,帶入王的抗性/蓄力/狂暴機制欄位
// (欄位設計與 routes/game.js 的 instantiateEnemy 完全一致,單人/組隊共用同一套王機制)
function instantiatePartyEnemy(monsterId) {
  const m = getMonster(monsterId);
  return {
    monsterId: m.id, name: m.name, level: m.level, hp: m.hp, maxHp: m.hp, atk: m.atk, def: m.def, critRate: m.critRate, exp: m.exp, tier: m.tier || 'normal', dropTable: m.dropTable,
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

// 第一波小怪數量:依隊伍人數增減(單人也能組隊挑戰,但人越多小怪越多,維持壓力感),上限6隻避免過度混亂
function trashWaveCount(partySize) {
  return Math.min(6, partySize + 1);
}

// 王波的規模設計:你都組隊了,王卻只有一個人在打,人越多反而越無腦——不加以調整的話,
// 4人隊伍會把王秒殺,完全沒有「王」該有的份量。這裡用「多隻王同時出現」而非單純幫同一隻王
// 加血,一來更符合組隊的直覺(一群人對抗一群敵人),二來天生沿用既有的多目標索敵/王機制
// (蓄力/狂暴/抗性每隻各自獨立判定),不需要另外發明新公式。
// 王隻數依人數增加,「每隻」王的血量/攻擊力也隨人數微幅提升——讓 2 人小隊也比單人吃力一些,
// 不是非要湊滿 3~4 人才有感覺;血量提升幅度大於攻擊力,因為攻擊觸發次數本身就已經隨人數
// 自然增加了(見 partyMemberAction:每次任一成員行動,存活的王都會各自反擊一次)。
function bossCountForPartySize(size) {
  return size >= 3 ? 2 : 1;
}
function bossStatMultiplier(size) {
  return { hp: 1 + (size - 1) * 0.35, atk: 1 + (size - 1) * 0.12 };
}
// 通關獎勵倍率:注意「王隻數隨人數增加」本身已經自然疊加出對應的經驗/掉落總量
// (多打一隻王,等同連續打贏兩隻王,這部分公平,不需要額外倍率補償),這裡的倍率只用來
// 補償「每隻王個別血量/攻擊力也被調高」這一小部分額外難度,幅度務必保守——
// 曾經誤用 0.4 的倍率跟王隻數疊加太重,4人隊伍變成經驗x4.4倍、稀有素材機率直接觸頂到
// 100%必掉,完全失去稀有感,故意壓低到只補償「每隻王變強」的比例,不含王隻數增加的部分。
function bossRewardMultiplier(size) {
  return 1 + (size - 1) * 0.15;
}

// 開始副本:兩波結構(小怪波→王波),party.members 需已在 create/join 時記錄 classId 與 stats
export function startBountyCombat(party, mapId) {
  const map = getMap(mapId);
  if (!map) return null;
  const partySize = party.members.length;
  const trashCount = trashWaveCount(partySize);
  const trashEnemies = Array.from({ length: trashCount }, () => instantiatePartyEnemy(map.monsterPool[Math.floor(Math.random() * map.monsterPool.length)]));

  party.combat = {
    mapId: map.id,
    mapName: map.name,
    partySize, // 開戰當下記錄人數,即使中途有人斷線也維持原定的王波規模與獎勵倍率不變
    waveIndex: 0, // 0 = 小怪波, 1 = 王波
    totalWaves: 2,
    enemies: trashEnemies,
    bossRewardMult: 1, // 王波才會設為 bossRewardMultiplier(partySize),小怪波維持 1(不加成)
    totalExp: 0, // 累計至今擊敗敵人的經驗值,通關時一次性發放給所有成員
    defeatedDropTables: [], // 累計至今擊敗敵人的 dropTable,通關時每位成員各自獨立擲骰
    members: Object.fromEntries(
      party.members.map((m) => [m.userId, {
        username: m.username,
        classId: m.classId,
        hp: m.stats.maxHp ?? m.stats.hp,
        maxHp: m.stats.maxHp ?? m.stats.hp,
        mp: m.stats.maxMp ?? m.stats.mp,
        maxMp: m.stats.maxMp ?? m.stats.mp,
        stats: m.stats,
        equipment: m.equipment, // 直接引用(非深拷貝):戰鬥中耐久度消耗會直接改到這份物件,
        // 通關/落敗時 index.js 的 reward 迴圈需要把這份耐久度變化寫回真正的存檔。
        buffs: [],
      }])
    ),
    log: [`—— 第 1/2 波:遭遇 ${trashEnemies.length} 隻小怪!——`],
    ended: null,
  };
  return party.combat;
}

function aliveEnemies(combat) {
  return combat.enemies.filter((e) => e.hp > 0);
}
function aliveMembers(combat) {
  return Object.entries(combat.members).filter(([, m]) => m.hp > 0);
}

// 進入下一波,或若已是最後一波則宣告通關(由呼叫端負責發放獎勵,這裡只切換戰鬥狀態)
function advanceWave(party) {
  const combat = party.combat;
  const map = getMap(combat.mapId);
  combat.waveIndex += 1;
  if (combat.waveIndex >= combat.totalWaves) {
    combat.ended = 'win';
    return;
  }
  // 目前設計固定兩波,第二波即為地圖大王——依隊伍人數決定同時出現幾隻、每隻的血量/攻擊力倍率
  const count = bossCountForPartySize(combat.partySize);
  const mult = bossStatMultiplier(combat.partySize);
  const bosses = Array.from({ length: count }, () => {
    const boss = instantiatePartyEnemy(map.boss);
    boss.hp = Math.round(boss.hp * mult.hp);
    boss.maxHp = boss.hp;
    boss.atk = Math.round(boss.atk * mult.atk);
    return boss;
  });
  combat.enemies = bosses;
  combat.bossRewardMult = bossRewardMultiplier(combat.partySize);
  combat.log.push(count > 1
    ? `—— 第 2/2 波:${count} 隻大王「${bosses[0].name}」同時現身!——`
    : `—— 第 2/2 波:大王「${bosses[0].name}」現身!——`);
}

// 隊伍成員的戰鬥行動:action 為 'basic'/'aoe'/'buff'/'defend'/'potionHeal',與單人戰鬥的技能規則完全一致
// (potionHeal 的實際扣除藥水庫存由呼叫端處理,這裡只負責套用戰鬥數值本身)
export function partyMemberAction(party, userId, action, extra = {}) {
  const combat = party.combat;
  if (!combat || combat.ended) return null;
  const actor = combat.members[userId];
  if (!actor || actor.hp <= 0) return { lines: ['你已倒下,無法行動。'] };

  const cls = getClass(actor.classId);
  const lines = [];
  let acted = false;

  if (action === 'defend') {
    lines.push(`${actor.username}收起攻勢,擺出防禦姿態!`);
    acted = true;
  } else if (action === 'potionHeal') {
    if (extra.healAmount) {
      actor.hp = Math.min(actor.maxHp, actor.hp + extra.healAmount);
      lines.push(`${actor.username}使用了${extra.potionName},恢復 ${extra.healAmount} 點氣血。`);
    } else if (extra.manaAmount) {
      actor.mp = Math.min(actor.maxMp, actor.mp + extra.manaAmount);
      lines.push(`${actor.username}使用了${extra.potionName},恢復 ${extra.manaAmount} 點真力。`);
    }
    acted = true;
  } else if (action === 'basic' || action === 'aoe' || action === 'buff') {
    const skill = cls.skills[action];
    if (!skill) return { lines: ['無此技能。'] };
    if (actor.stats.level < skill.unlockLevel) return { lines: [`尚未達到等級,無法施展「${skill.name}」(需 Lv.${skill.unlockLevel})`] };
    if (actor.mp < skill.mpCost) return { lines: [`真力不足,無法施展「${skill.name}」`] };
    actor.mp -= skill.mpCost;
    const atkStat = cls.attackType === 'matk' ? actor.stats.matk : actor.stats.atk;
    const critRate = actor.stats.critRate + sumBuffValue(actor.buffs, 'critRatePct');
    const atkMult = 1 + sumBuffValue(actor.buffs, 'atkPct');
    const resistFor = (target) => (cls.attackType === 'matk' ? target.magicResistPct : target.physicalResistPct) || 0;

    if (action === 'basic') {
      const idx = Number.isInteger(extra.targetIndex) && combat.enemies[extra.targetIndex]?.hp > 0 ? extra.targetIndex : combat.enemies.findIndex((e) => e.hp > 0);
      const target = combat.enemies[idx];
      if (!target) return { lines: ['目標無效。'] };
      const { amount, isCrit } = rollDamage({ level: actor.stats.level, atk: atkStat * atkMult, coeff: skill.coeff, def: target.def, critRate, resistPct: resistFor(target), critDamageMult: actor.stats.critDamageMult });
      target.hp = Math.max(0, target.hp - amount);
      lines.push(`${actor.username}施展「${skill.name}」!` + narrateAttack({ attackerName: actor.username, defenderName: target.name, amount, isCrit }));
      consumeWeaponDurability(actor.equipment);
    } else if (action === 'aoe') {
      lines.push(`${actor.username}施展「${skill.name}」,席捲全場!`);
      combat.enemies.forEach((target) => {
        if (target.hp <= 0) return;
        const { amount, isCrit } = rollDamage({ level: actor.stats.level, atk: atkStat * atkMult, coeff: skill.coeff, def: target.def, critRate, resistPct: resistFor(target), critDamageMult: actor.stats.critDamageMult });
        target.hp = Math.max(0, target.hp - amount);
        lines.push(narrateAttack({ attackerName: actor.username, defenderName: target.name, amount, isCrit }));
      });
      consumeWeaponDurability(actor.equipment);
    } else if (skill.healPct) {
      const amt = Math.round(actor.maxHp * skill.healPct);
      actor.hp = Math.min(actor.maxHp, actor.hp + amt);
      lines.push(`${actor.username}施展「${skill.name}」,恢復 ${amt} 點氣血。`);
    } else if (skill.durationTurns) {
      const [key, value] = Object.entries(skill.effect)[0];
      actor.buffs.push({ key, value, turnsLeft: skill.durationTurns });
      lines.push(`${actor.username}施展「${skill.name}」!${skill.desc}`);
    }
    acted = true;
  } else {
    return { lines: ['無效的操作。'] };
  }

  if (!acted) return { lines };

  // 敵方回合:王機制(蓄力預警/爆發/狂暴)與單人戰鬥邏輯完全一致,差別是攻擊目標從存活成員中隨機挑選
  const defending = action === 'defend';
  aliveEnemies(combat).forEach((enemy) => {
    const alive = aliveMembers(combat);
    if (alive.length === 0) return;
    const [targetId, target] = alive[Math.floor(Math.random() * alive.length)];

    if (enemy.enrageHpPct != null && !enemy.enraged && enemy.hp / enemy.maxHp <= enemy.enrageHpPct) {
      enemy.enraged = true;
      enemy.atk = Math.round(enemy.atk * enemy.enrageAtkMult);
      lines.push(`⚠ ${enemy.name}的傷勢激起了狂暴,攻擊力大幅提升!`);
    }

    let isChargeRelease = false;
    if (enemy.charging) {
      isChargeRelease = true;
      enemy.charging = false;
    } else if (enemy.chargeSkill) {
      enemy.turnCounter += 1;
      if (enemy.turnCounter % enemy.chargeSkill.triggerEveryTurns === 0) {
        enemy.charging = true;
        lines.push(`⚠ ${enemy.name}${enemy.chargeSkill.telegraphText}`);
        return;
      }
    }

    const { amount, isCrit, missed, blocked, mpAbsorbed } = rollDamage({ level: enemy.level, atk: enemy.atk, coeff: 1, def: target.stats.def, critRate: enemy.critRate, evasionPct: target.stats.evasionRate, blockRatePct: target.stats.blockRatePct, magicDamageReductionPct: target.stats.magicDamageReductionPct });
    if (missed) {
      lines.push(narrateEnemyAttack({ enemyName: enemy.name, targetName: target.username, missed: true }));
      return;
    }
    // 法師的真氣減傷%不是憑空消失,而是用真力(MP)扛住這部分傷害,MP不夠扛時差額轉回傷害由氣血承受
    let realAmount = amount;
    let mpUsedForAbsorb = 0;
    if (mpAbsorbed > 0) {
      mpUsedForAbsorb = Math.min(target.mp, mpAbsorbed);
      target.mp -= mpUsedForAbsorb;
      realAmount += mpAbsorbed - mpUsedForAbsorb;
    }
    const boosted = isChargeRelease ? Math.round(realAmount * enemy.chargeSkill.dmgMult) : realAmount;
    // 防禦只減輕「行動者自己」承受的傷害(跟單人戰鬥一致的設計精神:防禦是主動選擇要扛下這一擊的人)
    const isDefendingTarget = defending && targetId === userId;
    const finalAmount = isDefendingTarget ? Math.max(1, Math.ceil(boosted * 0.5)) : boosted;
    target.hp = Math.max(0, target.hp - finalAmount);
    consumeArmorDurability(target.equipment);
    const absorbText = mpUsedForAbsorb > 0 ? `(真氣抵擋了 ${mpUsedForAbsorb} 點傷害)` : '';
    if (isChargeRelease) {
      lines.push(`💥 ${enemy.name}蓄力已久,使出「${enemy.chargeSkill.name}」!對${target.username}造成 ${finalAmount} 點傷害${isCrit ? '(要害!)' : ''}${isDefendingTarget ? '(防禦大幅減輕了衝擊)' : ''}${absorbText}。`);
    } else {
      lines.push(narrateEnemyAttack({ enemyName: enemy.name, targetName: target.username, amount: finalAmount, isCrit, blocked }) + (isDefendingTarget ? '(防禦減傷)' : '') + absorbText);
    }
  });

  // 每位成員各自的buff結算(跟單人戰鬥一致,每回合遞減)
  Object.values(combat.members).forEach((m) => { m.buffs = tickBuffs(m.buffs); });

  combat.log.push(...lines);

  if (aliveEnemies(combat).length === 0) {
    // 王波(bossRewardMult > 1)擊敗時,經驗與掉落機率一併按倍率提升——王被放大了,獎勵也要跟著放大,
    // 呼應「花時間湊人打更難的王,要真的比單刷划算」的設計方向,小怪波(倍率恆為1)則不受影響。
    const mult = combat.bossRewardMult || 1;
    const defeatedExp = Math.round(combat.enemies.reduce((sum, e) => sum + e.exp, 0) * mult);
    combat.totalExp += defeatedExp;
    combat.defeatedDropTables.push(...combat.enemies.map((e) => {
      const dropTable = (e.dropTable || []).map((d) => ({ ...d, chance: Math.min(1, d.chance * mult) }));
      return { dropTable, tier: e.tier, level: e.level };
    }));
    lines.push(`本波敵人已全數擊敗!獲得 ${defeatedExp} 點經驗。`);
    advanceWave(party);
    if (combat.ended === 'win') {
      lines.push(`副本通關!眾人合力擊敗了「${combat.mapName}」的挑戰。`);
      return { lines, ended: 'win', totalExp: combat.totalExp, defeatedDropTables: combat.defeatedDropTables };
    }
  }

  const stillAlive = aliveMembers(combat).length > 0;
  if (!stillAlive) {
    combat.ended = 'lose';
    lines.push('隊伍全數力竭,副本挑戰失敗。');
    return { lines, ended: 'lose' };
  }

  return { lines, ended: null };
}

export function endCombat(party) {
  party.combat = null;
}
