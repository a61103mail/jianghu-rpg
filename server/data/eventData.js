// 地圖上的非戰鬥事件(奇幻練功MMO):讓「闖蕩」不是每關都打怪,穿插拾獲/頓悟/陷阱/挖寶/小憩等變化。
// weight 為抽選權重(數字越大越常出現),text 為敘事模板函式。
export const MAP_EVENTS = [
  {
    id: 'find_gold',
    weight: 3,
    type: 'gold',
    min: 8,
    max: 25,
    text: (amt) => `你在路旁發現一個遺落的錢袋,拾得 ${amt} 枚金幣。`,
  },
  {
    id: 'find_material',
    weight: 3,
    type: 'material',
    text: (matName, amt) => `你眼尖注意到附近散落著${matName},順手撿了 ${amt} 份。`,
  },
  {
    id: 'training',
    weight: 2,
    type: 'exp',
    min: 5,
    max: 15,
    text: (amt) => `途中稍作演練,略有心得,獲得 ${amt} 點經驗。`,
  },
  {
    id: 'trap',
    weight: 2,
    type: 'trap',
    pct: 0.08,
    text: (amt) => `不慎踩中陷阱,受了點輕傷,損失 ${amt} 點氣血。`,
  },
  {
    id: 'treasure',
    weight: 1,
    type: 'treasure',
    text: () => '你循著若有似無的痕跡四處挖掘……',
  },
  {
    id: 'rest_stop',
    weight: 8, // 野外自然回復的重要來源,權重刻意拉高,不必每次都靠金幣回城才能回血
    type: 'rest',
    hpPct: 0.4,
    mpPct: 0.4,
    text: (hpAmt, mpAmt) => `你找了處僻靜之地就地紮營歇息,恢復了 ${hpAmt} 點氣血、${mpAmt} 點真力。`,
  },
];

// 抽選一個奇遇事件。boostGold 為 true 時(僅在玩家「真正一無所有」——金幣與可販售材料/雜物皆為0,
// 裝備不列入計算——才會設為 true),大幅提高撿到金幣事件的權重,當作真正的最後安全網。
export function rollMapEvent({ boostGold = false } = {}) {
  const weights = MAP_EVENTS.map((e) => (boostGold && e.type === 'gold' ? e.weight * 5 : e.weight));
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  let roll = Math.random() * totalWeight;
  for (let i = 0; i < MAP_EVENTS.length; i += 1) {
    roll -= weights[i];
    if (roll <= 0) return MAP_EVENTS[i];
  }
  return MAP_EVENTS[0];
}
