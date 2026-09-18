// 決鬥系統(即時 PvP):分為兩種賭注——
//   'win'   論勝負:分出高下即結束,敗者僅承受氣血損耗與些許顏面無光,不影響帳號。
//   'death' 決生死:雙方皆需明確同意的生死狀,敗者(氣血歸零)將被永久刪除帳號與存檔,不可復原。
// 以記憶體管理暫時性的對戰狀態,不寫入存檔資料庫。
//
// 回合制設計:先前完全沒有回合限制,雙方誰都能隨時呼叫攻擊,變成「誰連點滑鼠快就贏」,
// 毫無策略可言。改為明確的 turnUserId 欄位——比較雙方敏捷(DEX),數值高的先手(相同則
// 隨機決定),每次成功攻擊後輪轉給對方,伺服器端強制驗證「現在是不是你的回合」,不是前端
// 自律就能解決的(前端隱藏按鈕只是體驗優化,真正的防線在後端拒絕不合法的攻擊請求)。
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
  // 先攻判定:敏捷(DEX)較高的一方先手,體現「身法快的人搶得先機」;數值相同時隨機決定,
  // 避免永遠固定某一方(例如永遠是挑戰者)先攻,對配點沒有敏捷優勢的一方也不會顯得不公平。
  const challengerDex = challenger.stats.dex || 0;
  const targetDex = target.stats.dex || 0;
  let turnUserId;
  if (challengerDex > targetDex) turnUserId = challenger.userId;
  else if (targetDex > challengerDex) turnUserId = target.userId;
  else turnUserId = Math.random() < 0.5 ? challenger.userId : target.userId;
  const firstName = turnUserId === challenger.userId ? challenger.username : target.username;

  const duel = {
    id,
    stakes, // 'win' | 'death'
    a: { userId: challenger.userId, username: challenger.username, hp: challenger.stats.hp, maxHp: challenger.stats.hp, stats: challenger.stats },
    b: { userId: target.userId, username: target.username, hp: target.stats.hp, maxHp: target.stats.hp, stats: target.stats },
    turnUserId,
    log: [
      stakes === 'death' ? '雙方立下生死戰約,此戰不死不休!' : '雙方點頭致意,點到為止,以決高下!',
      `${firstName}身法更勝一籌,率先出手!`,
    ],
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
  if (duel.ended) return { lines: ['此戰已分出結果。'], rejected: true };
  // 強制回合驗證:不是你的回合,直接拒絕——這是先前「誰連點快誰贏」的根本解方,
  // 不管前端有沒有正確隱藏按鈕,伺服器這裡才是真正擋住非法搶攻的防線。
  if (duel.turnUserId !== userId) return { lines: ['尚未輪到你出手,請等待對方行動。'], rejected: true };

  const atkStat = actor.stats.attackType === 'matk' ? actor.stats.matk : actor.stats.atk;
  const { amount, isCrit, missed, blocked } = rollDamage({ level: actor.stats.level, atk: atkStat, coeff: 1, def: target.stats.def, critRate: actor.stats.critRate, evasionPct: target.stats.evasionRate, blockRatePct: target.stats.blockRatePct, magicDamageReductionPct: target.stats.magicDamageReductionPct });
  duel.turnUserId = target.userId; // 不論本回合有沒有命中,行動後一律輪到對方——「未命中」不該讓你連續多打一次
  if (missed) {
    return { lines: [narrateAttack({ attackerName: actor.username, defenderName: target.username, missed: true })], ended: null, loserUserId: null };
  }
  target.hp = Math.max(0, target.hp - amount);
  const lines = [narrateAttack({ attackerName: actor.username, defenderName: target.username, amount, isCrit, blocked })];

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
