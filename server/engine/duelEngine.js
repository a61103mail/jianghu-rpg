// 決鬥系統(即時 PvP):分為兩種賭注——
//   'win'   論勝負:分出高下即結束,敗者僅承受氣血損耗與些許顏面無光,不影響帳號。
//   'death' 決生死:雙方皆需明確同意的生死狀,敗者(氣血歸零)將被永久刪除帳號與存檔,不可復原。
// 以記憶體管理暫時性的對戰狀態,不寫入存檔資料庫。
import { rollDamage, narrateAttack } from './combatEngine.js';

const duels = new Map(); // duelId -> duel
const pendingChallenges = new Map(); // targetUserId -> { challengerId, challengerName, stakes }

function randomId() {
  return `duel_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function challenge(challenger, targetUserId, stakes) {
  pendingChallenges.set(targetUserId, { challengerId: challenger.userId, challengerName: challenger.username, stakes });
}

export function getPendingChallenge(userId) {
  return pendingChallenges.get(userId) || null;
}

export function declineChallenge(userId) {
  pendingChallenges.delete(userId);
}

// 雙方同意後正式開戰;stakes 由挑戰時決定,雙方需在 UI 上都明確看過提示才能接受(前端負責顯示警語)
export function acceptChallenge(challenger, target, stakes) {
  pendingChallenges.delete(target.userId);
  const id = randomId();
  const duel = {
    id,
    stakes, // 'win' | 'death'
    a: { userId: challenger.userId, username: challenger.username, hp: challenger.stats.hp, maxHp: challenger.stats.hp, stats: challenger.stats },
    b: { userId: target.userId, username: target.username, hp: target.stats.hp, maxHp: target.stats.hp, stats: target.stats },
    log: stakes === 'death' ? ['雙方立下生死戰約,此戰不死不休!'] : ['雙方點頭致意,點到為止,以決高下!'],
    ended: null,
    loserUserId: null,
  };
  duels.set(id, duel);
  return duel;
}

export function getDuel(id) {
  return duels.get(id);
}

export function findDuelByUser(userId) {
  for (const duel of duels.values()) {
    if (!duel.ended && (duel.a.userId === userId || duel.b.userId === userId)) return duel;
  }
  return null;
}

export function duelAttack(duel, userId) {
  const isA = duel.a.userId === userId;
  const actor = isA ? duel.a : duel.b;
  const target = isA ? duel.b : duel.a;
  if (duel.ended) return { lines: ['此戰已分出結果。'] };

  // 依攻擊方職業的攻擊屬性(物理atk/魔法matk)決定傷害來源——先前不分職業一律用atk,
  // 導致法師/牧師這類幾乎不點物理攻擊的職業在決鬥中打不出真正傷害,是與此處緊密相關的既有bug,一併修正。
  const atkStat = actor.stats.attackType === 'matk' ? actor.stats.matk : actor.stats.atk;
  const { amount, isCrit, missed } = rollDamage({ level: actor.stats.level, atk: atkStat, coeff: 1, def: target.stats.def, critRate: actor.stats.critRate, evasionPct: target.stats.evasionRate });
  if (missed) {
    return { lines: [narrateAttack({ attackerName: actor.username, defenderName: target.username, missed: true })], ended: null, loserUserId: null };
  }
  target.hp = Math.max(0, target.hp - amount);
  const lines = [narrateAttack({ attackerName: actor.username, defenderName: target.username, amount, isCrit })];

  if (target.hp <= 0) {
    duel.ended = duel.stakes;
    duel.loserUserId = target.userId;
    if (duel.stakes === 'death') {
      lines.push(`${target.username}氣血盡失,倒地不起——這份生死戰約,再無回天之力。`);
    } else {
      lines.push(`${target.username}力竭認輸,${actor.username}技高一籌!`);
    }
  }
  return { lines, ended: duel.ended, loserUserId: duel.loserUserId };
}

export function endDuel(duel) {
  duels.delete(duel.id);
}
