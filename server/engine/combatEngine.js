// 戰鬥推演引擎(奇幻練功MMO):傷害公式為「等級線性基礎值 + 攻擊力(或魔攻)*固定係數」的加法結構,
// 而非單純的攻擊力倍率——確保就算完全不點屬性、不換裝備,等級越高基礎傷害仍會線性成長(每一級都有感),
// 而真正拉開差距的是 STR/DEX/INT/LUK 配點與裝備帶來的攻擊力/魔攻加成。技能係數(coeff)本身固定不變,
// 不設「技能等級」——技能會不會變強,完全綁定在角色攻擊力上,呼應「技能成長跟裝備綁定」的設計。
// 支援多敵人同場戰鬥(見 routes/game.js 的關卡/戰鬥orchestration)。

const LEVEL_BASE_COEF = 4; // 每級提供的基礎威力(等級30時基礎值為120,約略對應「100+攻擊力*0.X」的量級)

const ATTACK_VERBS = ['奮力揮擊', '欺身突進', '猛然出手', '瞄準破綻攻去', '使出全力一擊'];
const CRIT_PHRASES = ['正中要害', '是漂亮的會心一擊', '力道貫穿而入'];
const NORMAL_PHRASES = ['扎實挨了一記', '未能完全閃避', '硬生生受了一下'];
const MISS_PHRASES = ['堪堪被躲開', '撲了個空', '對方身法更快一步閃開'];
const ENEMY_TURN_VERBS = ['猛撲而來', '張牙舞爪地攻擊', '毫不留情地反擊', '狂暴地衝撞而來'];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// 依「等級線性基礎值 + 攻擊力*固定係數」計算單次攻擊傷害(coeff 預設 1,代表一般攻擊/敵方普攻;
// 技能傷害則傳入該技能固定的 coeff)。level 為攻擊方等級,def 為受擊方防禦。
// resistPct:受擊方對此傷害類型(物理/魔法)的抗性,正值減傷、負值(弱點)增傷,套用在防禦力扣減之前。
export function rollDamage({ level, atk, coeff = 1, def, critRate = 0.1, resistPct = 0 }) {
  const isCrit = Math.random() < critRate;
  const levelBase = LEVEL_BASE_COEF * level;
  const raw = (levelBase + atk * coeff) * (1 - resistPct);
  const varied = raw * (0.85 + Math.random() * 0.3);
  const mitigated = Math.max(1, Math.round(varied - def * 0.5));
  const amount = isCrit ? Math.round(mitigated * 1.6) : mitigated;
  return { amount: Math.max(1, amount), isCrit };
}

export function narrateAttack({ attackerName, defenderName, amount, isCrit, missed }) {
  const verb = pick(ATTACK_VERBS);
  if (missed) return `${attackerName}${verb},${defenderName}${pick(MISS_PHRASES)}。`;
  const phrase = isCrit ? pick(CRIT_PHRASES) : pick(NORMAL_PHRASES);
  return `${attackerName}${verb},${defenderName}${phrase},造成 ${amount} 點傷害${isCrit ? '(會心一擊!)' : ''}。`;
}

export function narrateEnemyAttack({ enemyName, targetName, amount, isCrit }) {
  const verb = pick(ENEMY_TURN_VERBS);
  return `${enemyName}${verb},${targetName}${isCrit ? '猝不及防,傷勢不輕' : '硬接下來'},損失 ${amount} 點氣血${isCrit ? '(要害!)' : ''}。`;
}

export function levelGapDescription(playerLevel, enemyLevel) {
  const gap = enemyLevel - playerLevel;
  if (gap >= 5) return '對手等級明顯高出許多,此戰十分凶險。';
  if (gap >= 2) return '對手等級略高一些,不可掉以輕心。';
  if (gap >= -1) return '雙方等級相當,勝負全看臨場發揮。';
  return '你等級遠勝對手,此戰當可從容應對。';
}

// 加總目前所有生效中的百分比類 buff(例如 atkPct、critRatePct),供傷害/會心計算時套用
export function sumBuffValue(buffs, key) {
  return (buffs || []).reduce((sum, b) => (b.key === key ? sum + b.value : sum), 0);
}

// 每回合結束時,buff 持續時間 -1,清除歸零的 buff
export function tickBuffs(buffs) {
  return (buffs || []).map((b) => ({ ...b, turnsLeft: b.turnsLeft - 1 })).filter((b) => b.turnsLeft > 0);
}
