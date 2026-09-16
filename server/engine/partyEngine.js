// 組隊系統(即時):以記憶體管理暫時性的隊伍與共同戰鬥狀態,不寫入存檔資料庫
// (隊伍本身是暫時的社交狀態,重開伺服器即清空,不影響各自的主線存檔進度)。
import { getMap, getMonster } from '../data/monsterData.js';
import { rollDamage, narrateAttack, narrateEnemyAttack } from './combatEngine.js';

const parties = new Map(); // partyCode -> party

function randomCode() {
  return Math.random().toString(36).slice(2, 7).toUpperCase();
}

export function createParty(leader) {
  let code = randomCode();
  while (parties.has(code)) code = randomCode();
  const party = {
    code,
    members: [leader], // { userId, username, stats, socketId }
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

export function updateMemberSocket(userId, socketId) {
  const party = findPartyByUser(userId);
  if (!party) return null;
  const member = party.members.find((m) => m.userId === userId);
  if (member) member.socketId = socketId;
  return party;
}

// 開始共鬥懸賞目標:所有隊員共同對抗指定地圖的大王(mapId 由前端傳入,對應該地圖的 boss)
export function startBountyCombat(party, mapId) {
  const map = getMap(mapId);
  if (!map) return null;
  const enemy = getMonster(map.boss);
  if (!enemy) return null;
  party.combat = {
    mapId: map.id,
    enemyId: enemy.id,
    enemyName: enemy.name,
    enemyLevel: enemy.level,
    enemyHp: enemy.hp,
    enemyMaxHp: enemy.hp,
    enemyDef: enemy.def,
    enemyAtk: enemy.atk,
    enemyCritRate: enemy.critRate,
    members: Object.fromEntries(
      party.members.map((m) => [m.userId, { username: m.username, hp: m.stats.hp, maxHp: m.stats.hp, stats: m.stats }])
    ),
    log: [`「${enemy.name}」現身,眾人合力迎戰!`],
    ended: null,
  };
  return party.combat;
}

// 隊伍中一名成員出手攻擊(傷害套用到共用的敵方血量),敵方隨機反擊其中一位存活隊員
export function partyMemberAttack(party, userId) {
  const combat = party.combat;
  if (!combat || combat.ended) return null;
  const actor = combat.members[userId];
  if (!actor || actor.hp <= 0) return { lines: ['你已倒下,無法出手。'] };

  const lines = [];
  const { amount, isCrit } = rollDamage({ level: actor.stats.level, atk: actor.stats.atk, coeff: 1, def: combat.enemyDef, critRate: actor.stats.critRate });
  combat.enemyHp = Math.max(0, combat.enemyHp - amount);
  lines.push(narrateAttack({ attackerName: actor.username, defenderName: combat.enemyName, amount, isCrit }));

  if (combat.enemyHp <= 0) {
    combat.ended = 'win';
    lines.push(`眾人齊心,擊敗了「${combat.enemyName}」!`);
    return { lines, ended: 'win' };
  }

  // 敵方從存活隊員中隨機挑一位反擊
  const alive = Object.entries(combat.members).filter(([, m]) => m.hp > 0);
  if (alive.length > 0) {
    const [targetId, target] = alive[Math.floor(Math.random() * alive.length)];
    const atk = rollDamage({ level: combat.enemyLevel, atk: combat.enemyAtk, coeff: 1, def: target.stats.def, critRate: combat.enemyCritRate });
    target.hp = Math.max(0, target.hp - atk.amount);
    lines.push(narrateEnemyAttack({ enemyName: combat.enemyName, targetName: target.username, amount: atk.amount, isCrit: atk.isCrit }));
  }

  const stillAlive = Object.values(combat.members).some((m) => m.hp > 0);
  if (!stillAlive) {
    combat.ended = 'lose';
    lines.push('隊伍全數力竭,懸賞目標揚長而去。');
    return { lines, ended: 'lose' };
  }

  return { lines, ended: null };
}

export function endCombat(party) {
  party.combat = null;
}
