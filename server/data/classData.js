// 職業資料(奇幻練功MMO):四大職業,對應鐵匠鋪/皮革店/法術店/教堂四間裝備商店。
// 每個職業固定 4 招技能:基本攻擊(單體)、範圍技能(AOE)、BUFF技能(短暫增益)、光環技能(常駐被動)。
// 技能倍率(coeff)全部固定不變,不設「技能等級」——技能會不會變強,完全綁定在角色的攻擊力/魔攻上,
// 而攻擊力/魔攻又由「等級線性成長的基礎值」+「STR/DEX/INT/LUK配點與裝備」共同決定
// (見 combatEngine.js 的 rollDamage:傷害 = 等級基礎值 + 攻擊力*coeff,而非單純攻擊力*倍率)。
// 四個技能依 30 等曲線分階段解鎖(unlockLevel),不是一開始就全部可用,讓 1~30 等的過程持續有新招式可期待。
export const CLASSES = {
  warrior: {
    id: 'warrior',
    name: '戰士',
    tagline: '近身搏殺,以力破敵。',
    weaponShop: 'blacksmith', // 決定武器/防具對應的商店(見 itemData.js)
    attackType: 'atk', // 此職業技能傷害採用的攻擊屬性('atk'=物理,'matk'=魔法)
    primaryStat: 'str',
    buildGuide: '主力輸出看力量(決定物理攻擊力與氣血上限)。推薦配點:每 5 點約 3~4 點力量、1~2 點敏捷(增加防禦與會心)。',
    baseStat: { str: 12, dex: 6, int: 3, luk: 4 },
    baseHp: 100,
    baseMp: 20,
    hpPerLevel: 14,
    mpPerLevel: 2,
    blockRatePct: 0.08, // 格擋基礎值:戰士是牧師的一半(近戰肉身格擋,靠裝備/副手再往上疊加)
    skills: {
      basic: { id: 'w_slash', name: '猛力斬', type: 'single', unlockLevel: 1, mpCost: 0, coeff: 1.3, desc: '掄起兵器全力一斬,對單一敵人造成傷害。' },
      aoe: { id: 'w_whirl', name: '旋風斬', type: 'aoe', unlockLevel: 8, mpCost: 8, coeff: 0.8, desc: '橫掃全場,對所有敵人造成傷害。' },
      buff: { id: 'w_roar', name: '戰吼', type: 'buff', unlockLevel: 15, mpCost: 12, durationTurns: 3, effect: { atkPct: 0.2 }, desc: '振奮軍心,3回合內攻擊力提升 20%。' },
      aura: { id: 'w_body', name: '剛體光環', type: 'aura', unlockLevel: 22, effect: { defPct: 0.1 }, desc: '（被動)護體天生提升 10%。' },
    },
  },
  mage: {
    id: 'mage',
    name: '法師',
    tagline: '操控元素,遠程灼燒。',
    weaponShop: 'magic',
    attackType: 'matk',
    primaryStat: 'int',
    buildGuide: '主力輸出「完全」看智力(魔法攻擊力與真力上限的唯一來源,力量/敏捷對傷害幾乎沒有幫助)。推薦幾乎全點智力,若有餘裕可加幸運衝會心率。',
    baseStat: { str: 3, dex: 5, int: 13, luk: 4 },
    baseHp: 65,
    baseMp: 50,
    hpPerLevel: 8,
    mpPerLevel: 6,
    blockRatePct: 0, // 法師不走格擋路線,防禦手段是裝備副手固定觸發的50%真氣減傷(見 characterEngine.js)
    skills: {
      basic: { id: 'm_bolt', name: '火焰彈', type: 'single', unlockLevel: 1, mpCost: 4, coeff: 1.4, desc: '射出一枚火焰彈,對單一敵人造成傷害。' },
      aoe: { id: 'm_burst', name: '烈焰爆', type: 'aoe', unlockLevel: 8, mpCost: 10, coeff: 0.9, desc: '引爆烈焰,對所有敵人造成傷害。' },
      buff: { id: 'm_focus', name: '魔力灌注', type: 'buff', unlockLevel: 15, mpCost: 14, durationTurns: 3, effect: { atkPct: 0.25 }, desc: '凝聚魔力,3回合內魔攻提升 25%。' },
      aura: { id: 'm_flow', name: '魔力回流', type: 'aura', unlockLevel: 22, effect: { mpRegenPerTurn: 2 }, desc: '（被動)每回合額外回復 2 點真力。' },
    },
  },
  priest: {
    id: 'priest',
    name: '牧師',
    tagline: '聖光庇護,亦攻亦療。',
    weaponShop: 'church',
    attackType: 'matk',
    primaryStat: 'int',
    buildGuide: '雖然有治療技能,但牧師不是「點力量的坦克」——主力輸出同樣看智力(魔法攻擊力),治療量則固定看氣血上限。推薦主點智力,其餘點幸運衝會心,或少量力量增加氣血與生存。',
    baseStat: { str: 5, dex: 4, int: 11, luk: 6 },
    baseHp: 80,
    baseMp: 45,
    hpPerLevel: 10,
    mpPerLevel: 5,
    blockRatePct: 0.16, // 格擋基礎值:牧師是四職業中最高的(聖光護體),戰士是牧師的一半
    skills: {
      basic: { id: 'p_smite', name: '聖光箭', type: 'single', unlockLevel: 1, mpCost: 4, coeff: 1.15, desc: '聖光凝聚成箭,對單一敵人造成傷害。' },
      aoe: { id: 'p_wave', name: '神聖震擊', type: 'aoe', unlockLevel: 8, mpCost: 10, coeff: 0.7, desc: '聖光震盪四方,對所有敵人造成傷害。' },
      buff: { id: 'p_pray', name: '治癒祝禱', type: 'buff', unlockLevel: 15, mpCost: 12, healPct: 0.3, desc: '祈禱聖光,立即恢復 30% 氣血上限。' },
      aura: { id: 'p_bless', name: '生命祝福', type: 'aura', unlockLevel: 22, effect: { hpRegenPct: 0.03 }, desc: '（被動)每回合額外回復 3% 氣血上限。' },
    },
  },
  archer: {
    id: 'archer',
    name: '弓箭手',
    tagline: '身法靈巧,箭無虛發。',
    weaponShop: 'leather',
    attackType: 'atk',
    primaryStat: 'dex',
    buildGuide: '主力輸出看敏捷(弓箭手是特例,敏捷才是物理攻擊力的主要來源,不是力量)。推薦幾乎全點敏捷,若有餘裕可加幸運進一步提升會心率。',
    baseStat: { str: 5, dex: 13, int: 3, luk: 5 },
    baseHp: 85,
    baseMp: 30,
    hpPerLevel: 10,
    mpPerLevel: 4,
    blockRatePct: 0, // 弓箭手的防禦主軸維持迴避率(DEX天生高),不給格擋基礎值
    skills: {
      basic: { id: 'a_shot', name: '疾風箭', type: 'single', unlockLevel: 1, mpCost: 3, coeff: 1.35, desc: '快速射出一箭,對單一敵人造成傷害。' },
      aoe: { id: 'a_rain', name: '亂箭齊發', type: 'aoe', unlockLevel: 8, mpCost: 9, coeff: 0.85, desc: '箭如雨下,對所有敵人造成傷害。' },
      buff: { id: 'a_eagle', name: '鷹眼', type: 'buff', unlockLevel: 15, mpCost: 10, durationTurns: 3, effect: { critRatePct: 0.15 }, desc: '凝神專注,3回合內會心率提升 15%。' },
      aura: { id: 'a_agile', name: '敏捷光環', type: 'aura', unlockLevel: 22, effect: { critRatePct: 0.05 }, desc: '（被動)會心率天生提升 5%。' },
    },
  },
};

// 力量/敏捷/智力/幸運 四圍屬性的實際效果說明(對應 characterEngine.js 的 computeStats 公式),
// 供前端配點畫面顯示,讓玩家清楚知道「點這個屬性到底在幹嘛」,不必自己猜或去看程式碼。
export const STAT_INFO = {
  str: { label: '力量', desc: '提升氣血上限與防禦;對戰士/牧師/法師而言也是物理攻擊力的來源(弓箭手例外,弓箭手物理攻擊力改看敏捷)。' },
  dex: { label: '敏捷', desc: '提升防禦、會心率、迴避率(上限80%,對手攻擊有機率直接落空);對弓箭手而言是物理攻擊力的主要來源。弓箭手全點敏捷可堆出很高的迴避率但氣血會偏低,戰士配點多在力量、迴避率天生較低但氣血防禦更高——這是兩職業的定位差異。' },
  int: { label: '智力', desc: '提升真力上限,是法師與牧師「魔法攻擊力」的唯一來源——這兩個職業的技能傷害完全看智力,不看力量/敏捷。' },
  luk: { label: '幸運', desc: '提升會心率,對任何職業都有效但增幅較小,通常作為次要加點。' },
};

export const CLASS_ORDER = ['warrior', 'mage', 'priest', 'archer'];

export function getClass(id) {
  return CLASSES[id] || CLASSES.warrior;
}

// 每級可自由分配的屬性點數
export const STAT_POINTS_PER_LEVEL = 5;

// 等級上限與經驗曲線:先前武俠版本用指數曲線太快讓玩家迅速衝頂,
// 這次改用「開頭快、後段拉長」的 1.7 次方曲線,前期練功有感,後期需要真正花時間刷。
export const MAX_LEVEL = 30;
export function expForNextLevel(level) {
  return Math.round(50 * Math.pow(level, 1.7));
}
