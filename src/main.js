// 勇者闖蕩:前端主程式(單一 view-state 應用,無框架)
import { api, setToken, clearToken, getToken } from './api.js';
import { connectSocket, getSocket, disconnectSocket } from './socket.js';

const app = document.getElementById('app');

const SHOP_NAMES = { blacksmith: '鐵匠鋪', leather: '皮革店', magic: '法術店', church: '黑市', general: '雜貨店' };
const SHOP_ORDER = ['blacksmith', 'leather', 'magic', 'church', 'general'];
// common:打怪隨機掉落的普通裝備(itemEngine.js generateCommonGear 固定寫死此字面值)。
// novice_plains ~ ruined_borderlands:商店配方的基本裝備,依地圖成長(見 itemData.js)。
// elite_set / trueboss_set:套裝配方。三者是同一個 tier 欄位、三種互不重疊的來源。
const ITEM_TIER_LABEL = {
  common: '普通',
  novice_plains: '新手平原', goblin_forest: '哥布林森林', stone_mines: '石化礦坑',
  dark_swamp: '幽暗沼澤', ruined_borderlands: '遺跡邊境',
  elite_set: '菁英套裝', trueboss_set: '真王套裝',
};
function itemTierLabel(tier) { return ITEM_TIER_LABEL[tier] || tier; }

// 藥水按鈕文字統一格式,一定要帶回復量——先前只顯示名稱+持有數量,玩家完全不知道這瓶到底回多少,
// 等於盲買盲用。4個使用藥水的地方(城鎮/戰鬥面板/王警示面板/組隊副本)都共用這個函式。
function potionButtonLabel(p) {
  return `${p.name}(回${p.kind === 'hp' ? '氣血' : '真力'}${Math.round((p.healPct || 0) * 100)}%,x${p.count})`;
}

// 裝備部位/屬性代碼一律翻成中文顯示,不要讓 weapon/atk/critRatePct 這種英文代碼直接出現在畫面上
const SLOT_LABEL_ZH = { weapon: '武器', armor: '防具', offhand: '副手', accessory1: '飾品一', accessory2: '飾品二', accessory: '飾品' };
function slotLabelZh(slot) { return SLOT_LABEL_ZH[slot] || slot; }
const STAT_LABEL_ZH = {
  atk: '攻擊力', matk: '魔法攻擊力', def: '防禦力', hp: '氣血上限', mp: '真力上限',
  critRatePct: '會心率', hpRegenPct: '氣血回復', atkPowerPct: '攻擊強度', defPct: '防禦', hpPct: '氣血',
  str: '力量', dex: '敏捷', int: '智力', luk: '幸運',
  blockRatePct: '格擋率', magicDamageReductionPct: '真氣減傷', evasionRatePct: '迴避率', critDamagePct: '會心傷害',
};
function statLabelZh(key) { return STAT_LABEL_ZH[key] || key; }
function statsText(stats) {
  // 數值可能為負(強化失敗倒扣),正數才加 + 號,負數本身帶 - 號不需要額外處理,
  // 否則會變成「格擋率+-5」這種雙重符號的畸形顯示。百分比類屬性(欄位名含Pct)額外補上 % 符號,
  // 不然玩家分不清「格擋率+5」是+5個百分點還是+5點數值。
  return Object.entries(stats || {}).map(([k, v]) => {
    const isPct = k.toLowerCase().includes('pct');
    return `${statLabelZh(k)}${v >= 0 ? '+' : ''}${v}${isPct ? '%' : ''}`;
  }).join('、');
}

// 裝備比較:算出「這件裝備」跟「另一件(通常是目前裝備中同部位的那件)」逐項屬性的差值,
// 讓玩家不用自己心算兩件裝備的數值就能直接看出哪件比較強。只列出兩邊至少一方有值的屬性,
// 差值為0(完全一樣)的屬性不顯示,避免版面塞滿一堆「+0」的雜訊。
function diffItemStats(newStats, otherStats) {
  const diff = {};
  const keys = new Set([...Object.keys(newStats || {}), ...Object.keys(otherStats || {})]);
  keys.forEach((k) => {
    const d = Math.round(((newStats?.[k] || 0) - (otherStats?.[k] || 0)) * 1000) / 1000;
    if (d !== 0) diff[k] = d;
  });
  return diff;
}
// 把比較差值渲染成一行帶顏色的文字:更強(正值)綠色、更弱(負值)紅色,一眼就能判斷該不該換裝。
function renderStatDiff(label, diff) {
  const entries = Object.entries(diff);
  if (entries.length === 0) return null;
  return h('div', { style: 'font-size:12px;margin-top:2px;' }, [
    h('span', { class: 'hint' }, `${label}:`),
    ...entries.map(([k, v]) => {
      const isPct = k.toLowerCase().includes('pct');
      return h('span', { style: `color:${v > 0 ? '#4ade80' : '#f87171'};margin-left:6px;` }, `${statLabelZh(k)}${v >= 0 ? '+' : ''}${v}${isPct ? '%' : ''}`);
    }),
  ]);
}
function classNameZh(classId) {
  return S.classes.find((c) => c.id === classId)?.name || classId;
}

function formatCountdown(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}分${s}秒`;
}

const S = {
  view: 'auth', // auth | setPlayerId | chooseClass | hub | venture | inventory | shop | auction | party | duel | dead
  authMode: 'login',
  error: '',
  state: null,
  playerId: null, // 玩家自訂的遊戲暱稱(取代畫面上顯示帳號),null 代表尚未設定過,需先導向 setPlayerId 畫面
  classes: [],
  shopId: null,
  shopData: null,
  auctionListings: [],
  lastHuntLines: [],
  deathMessage: '',
  bossEncounterAck: false, // 是否已確認要應戰目前這場王戰(遇到王時先擋一個警示畫面,避免玩家沒注意到就悶頭打)
  party: null,
  duel: null,
  duelPending: null,
  duelMsg: '',
  onlinePlayers: [], // 在線玩家名單(不含自己),供決鬥畫面直接點選挑戰對象,不用手動輸入帳號
  enhanceModalItemId: null, // 目前開啟強化/洗潛能彈出視窗的裝備 id,null 代表沒開啟(見 renderEnhanceModal)
  cubeChoicePreview: null, // 抉擇方塊「先預覽再選擇」的暫存結果:{ itemId, preview: { tier, lines } },套用/放棄後清空
  auctionFilter: { potentialKeys: new Set(), minAtk: '', minEnhanceUses: '' }, // 交易所搜尋條件:潛能種類(複選)/攻擊或魔攻最小值/強化次數最少幾次
  setInfoModal: null, // 套裝效果彈出視窗內容:{ name, pieces, equippedCount(可選), tiers }(見 renderSetInfoModal)
  shopSlotFilter: 'weapon', // 商店裝備製作目前選中的部位分頁籤(武器/防具/副手/飾品),避免4部位x多稀有度全部展開要滑很長
  shopCategoryFilter: 'normal', // 商店裝備製作目前選中的類型分頁籤('normal'一般配方 | 'set'套裝配方)
  invSlotFilter: 'weapon', // 背包裝備目前選中的部位分頁籤,同樣避免4部位全部展開要滑很長
  invMaterialFilter: 'junk', // 背包材料/雜物目前選中的種類分頁籤
  bootId: null, // 這個分頁載入當下的伺服器版本標記,見 startVersionWatch()
  newVersionAvailable: false, // 偵測到伺服器版本跟載入當下不同(=有新部署),提示玩家重新整理
};

function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'onclick') el.addEventListener('click', v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v);
  });
  (Array.isArray(children) ? children : [children]).forEach((c) => {
    if (c === null || c === undefined) return;
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return el;
}

// 統一收尾:每個畫面都拆成「固定不動的標題/導覽列(headerNodes)」+「放不下才會內部捲動的主要內容
// (scrollNodes)」。#app 本身鎖死在 100dvh(視窗高度)且不開放整頁捲動,所以捲軸只會出現在
// .screen-scroll 這個區塊內、且高度是 flex 算出來的「視窗剩餘空間」而非寫死的像素值——不論使用者
// 螢幕解析度多大多小,標題列與操作按鈕永遠留在原位,不會被一路往下的內容推到畫面外。
//
// 保留捲動位置:每次 render() 都會整個 innerHTML='' 重建 DOM(沒有用虛擬DOM diff),先前每次戰鬥
// 動作後畫面都會被重設回最頂端——玩家在戰鬥中得「捲下去點技能→點完畫面跳回頂端→再捲下去」不斷重複,
// 非常擾民。這裡在重建前先記下舊的捲動位置,重建後立刻還原,同一畫面連續操作(例如戰鬥回合)才不會
// 每次都跳回頂端。
function mount(headerNodes, scrollNodes) {
  const prevScroll = document.querySelector('.screen-scroll');
  const scrollTop = prevScroll ? prevScroll.scrollTop : 0;

  const root = document.createElement('div');
  root.style.cssText = 'display:flex;flex-direction:column;height:100%;min-height:0;';
  (headerNodes || []).forEach((n) => { if (n) root.appendChild(n); });
  const scrollBox = h('div', { class: 'screen-scroll' }, (scrollNodes || []).filter((n) => n));
  root.appendChild(scrollBox);
  app.innerHTML = '';
  app.appendChild(root);
  scrollBox.scrollTop = scrollTop;

  // 彈出視窗(強化/套裝效果):疊在畫面最上層,直接掛在 body 而非 #app——#app 有 max-width/overflow:hidden
  // 限制,掛在裡面視窗會被裁切或無法真正置中滿版覆蓋。每次重繪都先清掉全部舊的,避免重複疊加。
  document.querySelectorAll('.modal-overlay').forEach((n) => n.remove());
  if (S.enhanceModalItemId) {
    const modalNode = renderEnhanceModal();
    if (modalNode) document.body.appendChild(modalNode);
  }
  if (S.setInfoModal) {
    const setModalNode = renderSetInfoModal();
    if (setModalNode) document.body.appendChild(setModalNode);
  }
}

// 系統訊息(S.error,身兼「錯誤」與「操作成功提示」兩用)一律放進 mount() 的 headerNodes(固定不動
// 的區域),不要放進可捲動內容的最下面——先前訊息混在內容區塊尾端,玩家操作後畫面沒有明顯反應,
// 得自己往下捲才看得到「金額不足」之類的提示,還以為是系統沒反應/bug。放在標題列正下方,
// 不管內容多長、捲到哪裡,訊息永遠在最顯眼、不需要捲動就看得到的位置。
function errorBanner() {
  return S.error ? h('div', { class: 'error-msg', style: 'margin:6px 0 0;' }, S.error) : null;
}

async function refreshState() {
  const res = await api.getState();
  S.state = res.state;
  S.error = '';
  render();
}

function statBlock(stats) {
  return h('div', { class: 'stat-grid' }, [
    h('div', {}, [h('b', {}, '力量 '), String(stats.str)]),
    h('div', {}, [h('b', {}, '敏捷 '), String(stats.dex)]),
    h('div', {}, [h('b', {}, '智力 '), String(stats.int)]),
    h('div', {}, [h('b', {}, '幸運 '), String(stats.luk)]),
    h('div', {}, [h('b', {}, '物攻 '), String(stats.atk)]),
    h('div', {}, [h('b', {}, '魔攻 '), String(stats.matk)]),
    h('div', {}, [h('b', {}, '防禦 '), String(stats.def)]),
    h('div', {}, [h('b', {}, '會心 '), `${Math.round(stats.critRate * 100)}%`]),
    h('div', {}, [h('b', {}, '迴避 '), `${Math.round((stats.evasionRate || 0) * 100)}%`]),
    // 格擋/真氣減傷互斥(戰士走格擋,法師走副手真氣減傷),沒有的一方為0時不顯示,避免版面塞滿無意義的「0%」
    stats.blockRatePct > 0 ? h('div', {}, [h('b', {}, '格擋 '), `${Math.round(stats.blockRatePct * 100)}%`]) : null,
    stats.magicDamageReductionPct > 0 ? h('div', {}, [h('b', {}, '真氣減傷 '), `${Math.round(stats.magicDamageReductionPct * 100)}%`]) : null,
    // 會心傷害倍率:預設1.6倍,只有盜賊有機會透過副手/套裝推更高,超過基礎值才顯示,避免其他職業也看到一堆無意義的固定「160%」
    stats.critDamageMult > 1.6 ? h('div', {}, [h('b', {}, '會心傷害 '), `${Math.round(stats.critDamageMult * 100)}%`]) : null,
  ]);
}

function topBar() {
  const s = S.state;
  const hpPct = Math.round((s.hp / s.maxHp) * 100);
  const mpPct = Math.round((s.mp / s.maxMp) * 100);
  const expPct = Math.round((s.exp / s.expNeeded) * 100);
  return h('div', { class: 'panel' }, [
    h('div', {}, [
      h('h2', {}, `${S.playerId || ''} · ${s.className}`),
      // 等級跟金幣玩家反映不夠明顯,獨立拉出一整排、用大字+強調色顯示,不再跟其他小字資訊擠在一起
      h('div', { class: 'level-gold-row' }, [
        h('span', {}, `Lv.${s.level}`),
        h('span', { class: 'gold-value' }, `金幣 ${s.gold}`),
        s.statPoints > 0 ? h('span', {}, `可配點 ${s.statPoints}`) : null,
      ]),
    ]),
    // 氣血/真力/經驗值三條一起用同樣的進度條樣式顯示——經驗值先前只有小字文字「經驗0/50」不夠顯眼,
    // 玩家反映看不出進度,現在跟血條/真力條同樣視覺重量,一眼就能看出離升級還有多遠。
    h('div', { style: 'margin-top:6px;' }, [
      h('div', { class: 'bar-bg' }, [h('div', { class: 'bar-fill hp', style: `width:${hpPct}%` }), h('div', { class: 'bar-label' }, `氣血 ${s.hp}/${s.maxHp}`)]),
      h('div', { class: 'bar-bg', style: 'margin-top:4px;' }, [h('div', { class: 'bar-fill mp', style: `width:${mpPct}%` }), h('div', { class: 'bar-label' }, `真力 ${s.mp}/${s.maxMp}`)]),
      h('div', { class: 'bar-bg', style: 'margin-top:4px;' }, [h('div', { class: 'bar-fill exp', style: `width:${expPct}%` }), h('div', { class: 'bar-label' }, `經驗 ${s.exp}/${s.expNeeded}`)]),
    ]),
    statBlock(s.stats),
    h('div', { class: 'nav-tabs' }, [
      navBtn('hub', '城鎮'),
      navBtn('inventory', '裝備'),
      navBtn('auction', '交易所'),
      navBtn('party', '組隊副本'),
      navBtn('duel', '決鬥'),
      h('button', { class: 'btn', onclick: doLogout }, '登出'),
    ]),
  ]);
}

function navBtn(view, label) {
  return h('button', {
    class: `btn${S.view === view ? ' active' : ''}`,
    // 切換到不同畫面時清掉舊的提示訊息(S.error 身兼「錯誤」與「操作成功提示」兩用)——
    // 不然像是「在商店賣出東西」的提示會一路殘留、錯誤地出現在組隊副本這類完全無關的畫面上。
    onclick: () => { S.error = ''; if (view === 'auction') { openAuction(); } else if (view === 'duel') { openDuel(); } else { S.view = view; render(); } },
  }, label);
}

// 戰鬥中專用的精簡標題列:只留角色識別(玩家ID/職業/等級),不重複顯示氣血真力(戰鬥面板本身就有,
// 顯示兩次沒意義)、不顯示完整9項屬性、不顯示導覽按鈕(戰鬥中本來就不該切去別的畫面)。
// 目的是把每回合都要操作的技能按鈕盡量往上推,減少甚至消除戰鬥中還要捲動畫面的情況。
function combatTopBar() {
  const s = S.state;
  return h('div', { class: 'panel', style: 'padding:6px 14px;' }, [
    h('div', { class: 'hint' }, `${S.playerId || ''} · ${s.className} · Lv.${s.level}`),
  ]);
}

// ---- 認證畫面 ----
function renderAuth() {
  const box = h('div', { class: 'panel', style: 'max-width:360px;margin:60px auto;' }, [
    h('h1', {}, '勇者闖蕩'),
    h('p', { class: 'hint' }, '選定職業,踏上屬於你的冒險之路。'),
    h('input', { type: 'text', id: 'f-username', placeholder: '帳號(3~16字元)' }),
    h('input', { type: 'password', id: 'f-password', placeholder: '密碼(至少4碼)' }),
    S.error ? h('div', { class: 'error-msg' }, S.error) : null,
    h('div', {}, [
      h('button', {
        class: 'btn primary',
        onclick: async () => {
          const username = document.getElementById('f-username').value.trim();
          const password = document.getElementById('f-password').value;
          try {
            const fn = S.authMode === 'login' ? api.login : api.register;
            const res = await fn(username, password);
            setToken(res.token);
            S.username = res.username;
            S.playerId = res.playerId;
            await enterGame();
          } catch (e) {
            S.error = e.message;
            render();
          }
        },
      }, S.authMode === 'login' ? '登入' : '註冊'),
      h('button', {
        class: 'btn',
        onclick: () => { S.authMode = S.authMode === 'login' ? 'register' : 'login'; S.error = ''; render(); },
      }, S.authMode === 'login' ? '改為註冊新帳號' : '改為登入既有帳號'),
    ]),
  ]);
  mount([], [box]);
}

// ---- 設定玩家ID(遊戲內顯示暱稱,取代帳號):新帳號登入後、選職業前的第一步,只能設定一次 ----
function renderSetPlayerId() {
  const box = h('div', { class: 'panel', style: 'max-width:360px;margin:60px auto;' }, [
    h('h1', {}, '取個遊戲ID吧'),
    h('p', { class: 'hint' }, '這是你在遊戲中顯示給其他玩家看的名字(2~12字元,英數字/底線/中文),設定後不能更改,請謹慎輸入。'),
    h('input', { type: 'text', id: 'f-player-id', placeholder: '遊戲ID(2~12字元)' }),
    S.error ? h('div', { class: 'error-msg' }, S.error) : null,
    h('button', {
      class: 'btn primary',
      onclick: async () => {
        const playerId = document.getElementById('f-player-id').value.trim();
        try {
          const res = await api.setPlayerId(playerId);
          S.playerId = res.playerId;
          S.error = '';
          await enterGame();
        } catch (e) {
          S.error = e.message;
          render();
        }
      },
    }, '確定'),
  ]);
  mount([], [box]);
}

// ---- 選擇職業 ----
function renderChooseClass() {
  const box = h('div', { class: 'panel' }, [
    h('h1', {}, '選擇職業'),
    h('p', { class: 'hint' }, '每個職業都有 4 招固定技能:基本攻擊、範圍技能、增益技能、光環(被動)。'),
    ...S.classes.map((cls) =>
      h('div', {
        class: 'system-card',
        onclick: async () => {
          try {
            await api.chooseClass(cls.id);
            await enterGame();
          } catch (e) {
            S.error = e.message;
            render();
          }
        },
      }, [
        h('h3', {}, cls.name),
        h('div', { class: 'tagline' }, cls.tagline),
        h('div', { class: 'hint', style: 'margin:6px 0;color:#c9a227;' }, `配點建議:${cls.buildGuide}`),
        h('div', {}, Object.values(cls.skills).map((sk) => h('div', { class: 'hint' }, `【Lv.${sk.unlockLevel}】${sk.name}${sk.type === 'aura' ? '(被動)' : ''} — ${sk.desc}`))),
      ])
    ),
  ]);
  mount([], [box]);
}

// ---- 死亡結局畫面(決鬥生死戰用,不用原生 alert)----
function renderDeadScreen() {
  const box = h('div', { class: 'panel', style: 'max-width:420px;margin:80px auto;text-align:center;' }, [
    h('h1', {}, '角色殞落'),
    h('p', { class: 'narrative-text' }, S.deathMessage),
    h('button', {
      class: 'btn primary',
      onclick: () => {
        clearToken();
        disconnectSocket();
        S.state = null;
        S.deathMessage = '';
        S.view = 'auth';
        render();
      },
    }, '返回登入畫面'),
  ]);
  mount([], [box]);
}

// ---- 屬性配點 ----
function renderStatAllocator() {
  const s = S.state;
  const draft = S._statDraft || { str: 0, dex: 0, int: 0, luk: 0 };
  S._statDraft = draft;
  const used = draft.str + draft.dex + draft.int + draft.luk;
  const remaining = s.statPoints - used;

  function statRow(key, label) {
    const isPrimary = key === s.primaryStat;
    return h('div', { class: 'stat-alloc-row' }, [
      h('span', { style: isPrimary ? 'color:#c9a227;font-weight:bold;' : '' }, `${label}${isPrimary ? '★推薦主點' : ''}(目前 ${s.allocatedStats[key]})`),
      h('button', { class: 'btn', onclick: () => { if (draft[key] > 0) { draft[key] -= 1; render(); } } }, '-'),
      h('span', {}, String(draft[key])),
      h('button', { class: 'btn', onclick: () => { if (remaining > 0) { draft[key] += 1; render(); } } }, '+'),
      h('div', { class: 'hint', style: 'margin-left:8px;' }, s.statInfo[key].desc),
    ]);
  }

  return h('div', { class: 'panel' }, [
    h('h3', {}, `屬性配點(剩餘 ${remaining} 點)`),
    h('p', { class: 'hint', style: 'color:#c9a227;' }, `本職業配點建議:${s.buildGuide}`),
    statRow('str', '力量'),
    statRow('dex', '敏捷'),
    statRow('int', '智力'),
    statRow('luk', '幸運'),
    h('button', {
      class: 'btn primary',
      onclick: async () => {
        if (used <= 0) return;
        try {
          const res = await api.allocateStats(draft);
          S.state = res.state;
          S._statDraft = null;
          render();
        } catch (e) { S.error = e.message; render(); }
      },
    }, '確認配點'),
  ]);
}

// ---- 城鎮(主畫面):歇息、藥水、地圖選擇、商店入口 ----
function renderHub() {
  const s = S.state;

  const statAllocPanel = s.statPoints > 0 ? renderStatAllocator() : null;

  const missingHp = Math.max(0, s.maxHp - s.hp);
  const missingMp = Math.max(0, s.maxMp - s.mp);
  const fullRestCost = Math.max(5, Math.round(missingHp * 0.5 + missingMp * 0.5)); // 需與後端 REST_GOLD_PER_HP/MP/REST_MIN_COST 公式一致
  const affordablePct = fullRestCost > 0 ? Math.min(100, Math.round((Math.min(s.gold, fullRestCost) / fullRestCost) * 100)) : 100;

  const restPanel = h('div', { class: 'panel' }, [
    h('h3', {}, '城鎮'),
    missingHp > 0 || missingMp > 0
      ? h('p', { class: 'hint' }, `目前缺少 ${missingHp} 點氣血、${missingMp} 點真力;全額歇息需 ${fullRestCost} 枚金幣(你有 ${s.gold} 枚,依此推算約可恢復 ${affordablePct}%)。金幣不夠付全額也能歇息,依比例回復。`)
      : h('p', { class: 'hint' }, '氣血真力皆已全滿。'),
    h('button', {
      class: 'btn primary',
      onclick: async () => {
        try {
          const res = await api.rest();
          S.error = `歇息完畢,花費 ${res.spent} 枚金幣,恢復了 ${res.healedPct}%。`;
          S.state = res.state;
          render();
        } catch (e) { S.error = e.message; render(); }
      },
    }, '歇息(盡力恢復,金幣有多少花多少)'),
  ]);

  const potionPanel = h('div', { class: 'panel' }, [
    h('h3', {}, '藥水(城鎮/野外皆可使用,不限戰鬥中)'),
    ...s.potions.filter((p) => p.count > 0).map((p) =>
      h('button', {
        class: 'btn',
        onclick: async () => {
          try {
            const res = await api.usePotion(p.id);
            S.state = res.state;
            S.error = `使用了${p.name}。`;
            render();
          } catch (e) { S.error = e.message; render(); }
        },
      }, `使用${potionButtonLabel(p)}`)
    ),
    s.potions.every((p) => p.count === 0) ? h('div', { class: 'hint' }, '身上沒有任何藥水,可到雜貨店購買。') : null,
  ]);

  // 技能一覽:先前技能只有戰鬥中才看得到,城鎮完全沒地方確認解鎖狀態,玩家升級後不知道去哪確認。
  // 每招濃縮成一行(說明文字移到 title 提示,滑鼠停留才顯示),不佔用太多城鎮畫面的垂直空間。
  const SKILL_TYPE_LABEL = { single: '單體攻擊', aoe: '範圍攻擊', buff: '增益', aura: '光環(被動)' };
  const skillList = [s.skills.basic, s.skills.aoe, s.skills.buff, s.skills.aura];
  const skillsPanel = h('div', { class: 'panel' }, [
    h('h3', {}, `技能(Lv.${s.level})`),
    ...skillList.map((sk) => {
      const unlocked = s.level >= sk.unlockLevel;
      return h('div', {
        class: 'item-card',
        style: 'padding:5px 10px;',
        title: unlocked ? sk.desc : `Lv.${sk.unlockLevel} 解鎖 — ${sk.desc}`,
      }, `${unlocked ? '' : '🔒 '}${sk.name}(${SKILL_TYPE_LABEL[sk.type] || sk.type}${sk.mpCost != null ? `・真力${sk.mpCost}` : ''}${unlocked ? '' : `・Lv.${sk.unlockLevel}解鎖`})`);
    }),
  ]);

  const shopsPanel = h('div', { class: 'panel' }, [
    h('h3', {}, '商店'),
    ...SHOP_ORDER.map((id) => h('button', { class: 'btn', onclick: () => openShop(id) }, SHOP_NAMES[id])),
  ]);

  const mapsPanel = h('div', { class: 'panel' }, [
    h('h3', {}, '闖蕩地圖(多關卡:戰鬥/採集/奇遇交錯,沿途可能隨機遭遇菁英怪物或全服共用的真王)'),
    h('div', { class: 'card-grid' }, s.maps.map((m) => {
      const tb = m.bossStatus.trueBoss;
      return h('div', { class: 'item-card' }, [
        h('div', {}, `${m.name}(建議等級 Lv.${m.levelRange[0]}~${m.levelRange[1]},${m.minStages}~${m.maxStages}關)`),
        // 菁英(原小王/大王)已無重生冷卻,隨時可能於闖蕩途中遭遇,不再需要顯示倒數計時
        h('div', {
          class: 'hint',
          title: `菁英「${m.bossStatus.miniBoss.name}」・「${m.bossStatus.boss.name}」隨時可能於闖蕩途中遭遇`,
        }, '菁英怪物隨時可能於闖蕩途中遭遇'),
        // 真王一樣是隨機遭遇(機率遠低於菁英),不是點擊按鈕直接挑戰——這裡只顯示全服共用的
        // 重生狀態,讓玩家知道現在去闖蕩「有沒有機會」遇到真王,重生中則完全不會出現在遭遇池裡。
        h('div', {
          class: 'hint',
          title: `真王「${tb.name}」,全服玩家共用同一份重生計時`,
        }, tb.alive ? `⚔ 真王「${tb.name}」目前有機會遭遇!` : `真王「${tb.name}」重生中(還剩${formatCountdown(tb.respawnInSec)})`),
        h('button', {
          class: 'btn primary',
          onclick: async () => { try { S.bossEncounterAck = false; await api.huntStart(m.id); await refreshState(); } catch (e) { S.error = e.message; render(); } },
        }, '出發闖蕩'),
      ]);
    })),
  ]);

  // 左欄:歇息/藥水/技能/商店(操作與資訊類、較短);右欄:地圖列表/戰果/事蹟(內容較長)——並排顯示減少整頁滾動
  const content = h('div', { class: 'grid-2' }, [
    h('div', {}, [restPanel, potionPanel, skillsPanel, shopsPanel]),
    h('div', {}, [
      mapsPanel,
      S.lastHuntLines.length ? h('div', { class: 'panel' }, [h('h3', {}, '戰果'), ...S.lastHuntLines.map((l) => h('div', {}, l))]) : null,
      logPanel(),
    ]),
  ]);
  mount([topBar(), statAllocPanel, errorBanner()], [content]);
}

// ---- 闖蕩中的畫面調度:依 activeCombat / activeVenture 決定顯示內容 ----
function renderVenture() {
  const s = S.state;
  let content = [];

  if (s.activeCombat) {
    content = [renderVentureProgress(), s.activeCombat.isBossFight && !S.bossEncounterAck ? renderBossWarningPanel() : renderCombatPanel()];
  } else if (s.activeVenture?.pendingLootChoice) {
    content = [renderVentureProgress(), renderLootChoicePanel()];
  } else if (s.activeVenture) {
    content = [renderVentureProgress(), renderVentureStagePanel()];
  }
  // 戰鬥中改用精簡標題列(見 combatTopBar 說明):完整屬性列跟導覽按鈕在這裡不需要,
  // 省下的空間讓技能按鈕盡量不用捲動就能點到,不會每打一回合就被畫面重繪推回頂端又要捲一次。
  mount([s.activeCombat ? combatTopBar() : topBar(), errorBanner()], [...content]);
}

function renderVentureProgress() {
  const v = S.state.activeVenture;
  if (!v) return h('div');
  return h('div', { class: 'panel', style: 'padding:8px 14px;' }, [
    h('div', { class: 'hint' }, `${v.mapName} — 第 ${Math.min(v.stageIndex + 1, v.totalStages)}/${v.totalStages} 關`),
  ]);
}

// 拾獲遺物:展示最多3件陣亡玩家的遺物,只能挑選其中一件帶走,其餘隨之消散
function renderLootChoicePanel() {
  const v = S.state.activeVenture;
  const choice = v.pendingLootChoice;
  return h('div', { class: 'panel' }, [
    h('h3', {}, '拾獲遺物'),
    ...v.lastStageLines.map((l) => h('div', { class: 'narrative-text' }, l)),
    h('p', { class: 'hint' }, '只能挑選其中一件帶走,其餘遺物將隨之消散。'),
    ...choice.items.map((item, idx) =>
      h('div', { class: `item-card rarity-${item.tier}` }, [
        h('div', {}, itemLabel(item)),
        h('button', {
          class: 'btn primary',
          onclick: async () => {
            try {
              const res = await api.lootChoice(idx);
              S.state = res.state;
              S.error = res.lines?.[0] || '';
              render();
            } catch (e) { S.error = e.message; render(); }
          },
        }, '拾取此件'),
      ])
    ),
  ]);
}

function renderVentureStagePanel() {
  const v = S.state.activeVenture;
  const retreatPct = v.totalStages > 0 ? Math.round((v.stageIndex / v.totalStages) * 100) : 0;
  const retreatExp = Math.round(v.bonusExpPool * v.stageIndex / v.totalStages);
  return h('div', { class: 'panel' }, [
    h('h3', {}, '江湖奇遇'),
    ...v.lastStageLines.map((l) => h('div', { class: 'narrative-text' }, l)),
    h('div', { style: 'margin-top:10px;' }, [
      h('button', {
        class: 'btn primary',
        onclick: async () => {
          try {
            const res = await api.huntContinue();
            S.state = res.state;
            if (res.ventureEnded) { S.lastHuntLines = res.lines; S.view = 'hub'; }
            render();
          } catch (e) { S.error = e.message; render(); }
        },
      }, '繼續前進'),
      h('button', {
        class: 'btn danger',
        title: '結束旅程,已完成的關卡比例可換取旅程獎勵經驗;全部走完才能拿滿100%。',
        onclick: async () => {
          try {
            const res = await api.huntRetreat();
            S.state = res.state;
            S.lastHuntLines = res.lines;
            S.view = 'hub';
            render();
          } catch (e) { S.error = e.message; render(); }
        },
      }, `撤退返城(完成${retreatPct}%,可得旅程獎勵 ${retreatExp} 經驗)`),
    ]),
  ]);
}

// 遭遇小王/大王時的警示確認畫面:先前直接被拖進戰鬥,很容易沒注意到就悶頭打死——
// 現在強制停在這一步,清楚秀出王的名稱/等級/血量與自己目前氣血真力,玩家可選擇應戰或撤退(撤退=脫身,有機率失敗)。
function renderBossWarningPanel() {
  const c = S.state.activeCombat;
  const boss = c.enemies[0];
  const kindLabel = c.bossKind === 'boss' ? '大王' : '小王';
  const playerPct = Math.round((c.playerHp / c.playerMaxHp) * 100);
  const mpPct = Math.round((c.playerMp / c.playerMaxMp) * 100);
  return h('div', { class: 'panel', style: 'border:2px solid #ef4444;' }, [
    h('h3', { style: 'color:#ef4444;' }, `⚠ 遭遇${kindLabel}!「${boss.name}」(Lv.${boss.level})`),
    h('p', { class: 'hint' }, `${kindLabel}血量遠高於一般怪物,出手也更重,務必先確認自身狀態、準備好再應戰。`),
    h('div', { class: 'bar-bg' }, [h('div', { class: 'bar-fill enemy', style: 'width:100%' }), h('div', { class: 'bar-label' }, `${boss.name} ${boss.hp}/${boss.maxHp}`)]),
    h('div', { class: 'bar-bg', style: 'margin-top:6px;' }, [h('div', { class: 'bar-fill hp', style: `width:${playerPct}%` }), h('div', { class: 'bar-label' }, `你 ${c.playerHp}/${c.playerMaxHp}`)]),
    h('div', { class: 'bar-bg', style: 'margin-top:4px;' }, [h('div', { class: 'bar-fill mp', style: `width:${mpPct}%` }), h('div', { class: 'bar-label' }, `真力 ${c.playerMp}/${c.playerMaxMp}`)]),
    S.state.potions.some((p) => p.count > 0) ? h('p', { class: 'hint', style: 'margin-top:6px;' }, '應戰前可先在此使用藥水補血:') : null,
    h('div', {}, S.state.potions.filter((p) => p.count > 0).map((p) =>
      h('button', { class: 'btn', onclick: () => doCombatAction('potion', { potionId: p.id }) }, `使用${potionButtonLabel(p)}`)
    )),
    h('div', { style: 'margin-top:12px;' }, [
      h('button', { class: 'btn primary', onclick: () => { S.bossEncounterAck = true; render(); } }, `應戰!`),
      h('button', { class: 'btn danger', onclick: () => doCombatAction('flee') }, '謹慎撤退(有機率失敗)'),
    ]),
  ]);
}

// 預估技能傷害:公式須與後端 combatEngine.js 的 rollDamage 一致(等級線性基礎值 LEVEL_BASE_COEF=4 + 攻擊力*技能係數),
// 並套用目前生效中的攻擊力%類BUFF,讓玩家不用自己心算就能比較各技能威力(此為預估區間,未計入敵方防禦與會心)。
const LEVEL_BASE_COEF = 4;
function sumBuffValueClient(buffs, key) {
  return (buffs || []).reduce((sum, b) => (b.key === key ? sum + b.value : sum), 0);
}
function estimateSkillDamage(skill) {
  const stats = S.state.stats;
  const c = S.state.activeCombat;
  const atkBase = stats.attackType === 'matk' ? stats.matk : stats.atk;
  const atkMult = 1 + sumBuffValueClient(c?.buffs, 'atkPct');
  const raw = LEVEL_BASE_COEF * S.state.level + atkBase * atkMult * skill.coeff;
  return `約${Math.round(raw * 0.85)}~${Math.round(raw * 1.15)}`;
}

function renderCombatPanel() {
  const c = S.state.activeCombat;
  const skills = S.state.skills;
  const level = S.state.level;
  const playerPct = Math.round((c.playerHp / c.playerMaxHp) * 100);
  const mpPct = Math.round((c.playerMp / c.playerMaxMp) * 100);
  const aliveCount = c.enemies.filter((e) => e.hp > 0).length;
  return h('div', { class: 'panel' }, [
    h('h3', { style: c.isBossFight ? 'color:#ef4444;margin-bottom:4px;' : 'margin-bottom:4px;' }, c.isBossFight ? `⚠ ${c.bossKind === 'boss' ? '大王' : '小王'}戰!` : '遭遇戰!'),
    ...c.enemies.map((e, idx) => {
      const pct = Math.round((e.hp / e.maxHp) * 100);
      return h('div', { style: 'margin-bottom:6px;' }, [
        h('div', { class: 'bar-bg' }, [h('div', { class: 'bar-fill enemy', style: `width:${pct}%` }), h('div', { class: 'bar-label' }, `${e.name}(Lv.${e.level}) ${e.hp}/${e.maxHp}`)]),
      ]);
    }),
    h('div', { style: 'height:4px' }),
    h('div', { class: 'bar-bg' }, [h('div', { class: 'bar-fill hp', style: `width:${playerPct}%` }), h('div', { class: 'bar-label' }, `你 ${c.playerHp}/${c.playerMaxHp}`)]),
    h('div', { class: 'bar-bg', style: 'margin-top:4px;' }, [h('div', { class: 'bar-fill mp', style: `width:${mpPct}%` }), h('div', { class: 'bar-label' }, `真力 ${c.playerMp}/${c.playerMaxMp}`)]),
    h('div', {
      class: 'log-list',
      style: 'margin-top:8px;height:clamp(70px,12vh,140px);max-height:clamp(70px,12vh,140px);',
    }, c.log.map((l) => h('div', { class: l.includes('⚠') ? 'log-telegraph' : l.includes('💥') ? 'log-impact' : '' }, l))),

    // 技能欄:分排顯示——第一排單體攻擊、第二排範圍技能、第三排BUFF、第四排防禦,不要全部擠在同一排。
    // 傷害計算方式的說明移到滑鼠提示(title),畫面上只留下每回合真的需要看的警示文字,
    // 減少戰鬥中每回合都要重新掃過的文字量,技能按鈕才能盡量往上、不用捲動就點得到。
    h('h3', { style: 'margin-top:8px;font-size:15px;', title: '傷害為未扣敵方防禦、未計會心的預估區間,實際命中會依對象浮動。' }, '⚔ 技能'),
    c.log.some((l) => l.includes('⚠')) ? h('p', { class: 'hint log-telegraph', style: 'margin:2px 0 6px;' }, '⚠ 敵人正在蓄力,考慮這回合防禦!') : null,
    h('div', { class: 'skill-bar', style: 'flex-direction:column;align-items:stretch;margin-top:4px;' }, [
      h('div', { class: 'skill-row' }, [
        h('span', { class: 'skill-row-label' }, '單體'),
        ...c.enemies.map((e, idx) => e.hp > 0
          ? h('button', {
              class: 'skill-btn attack',
              title: `${skills.basic.desc}(預估未扣敵方防禦)`,
              onclick: () => doCombatAction('basic', { targetIndex: idx }),
            }, `${aliveCount > 1 ? `${skills.basic.name}→${e.name}` : skills.basic.name}(${estimateSkillDamage(skills.basic)})`)
          : null),
      ]),
      h('div', { class: 'skill-row' }, [
        h('span', { class: 'skill-row-label' }, '範圍'),
        level >= skills.aoe.unlockLevel
          ? h('button', { class: 'skill-btn', title: `${skills.aoe.desc}(預估未扣敵方防禦)`, onclick: () => doCombatAction('aoe') }, `${skills.aoe.name}(真力${skills.aoe.mpCost}, 每敵${estimateSkillDamage(skills.aoe)})`)
          : h('button', { class: 'skill-btn locked', disabled: true }, `🔒${skills.aoe.name}(Lv.${skills.aoe.unlockLevel})`),
      ]),
      h('div', { class: 'skill-row' }, [
        h('span', { class: 'skill-row-label' }, '增益'),
        level >= skills.buff.unlockLevel
          ? h('button', { class: 'skill-btn', title: skills.buff.desc, onclick: () => doCombatAction('buff') }, `${skills.buff.name}(真力${skills.buff.mpCost})`)
          : h('button', { class: 'skill-btn locked', disabled: true }, `🔒${skills.buff.name}(Lv.${skills.buff.unlockLevel})`),
      ]),
      h('div', { class: 'skill-row' }, [
        h('span', { class: 'skill-row-label' }, '防禦'),
        h('button', { class: 'skill-btn defend', title: '這回合不輸出,但敵方攻擊傷害減半——用來應付敵人蓄力的重擊', onclick: () => doCombatAction('defend') }, '防禦(減傷50%)'),
      ]),
    ]),

    // 次要操作:藥水與脫身,刻意用較不顯眼的一般按鈕樣式,跟技能欄做出區隔
    h('div', { style: 'margin-top:8px;' }, [
      ...S.state.potions.filter((p) => p.count > 0).map((p) =>
        h('button', { class: 'btn', onclick: () => doCombatAction('potion', { potionId: p.id }) }, `使用${potionButtonLabel(p)}`)
      ),
      h('button', { class: 'btn danger', onclick: () => doCombatAction('flee') }, '脫身'),
    ]),
  ]);
}

async function doCombatAction(action, extra = {}) {
  try {
    const res = await api.combatAction(action, extra);
    S.state = res.state;
    if (res.combatEnded) {
      S.bossEncounterAck = false; // 這場戰鬥結束了,下次再遇到王要重新警示確認
      if (res.combatEnded !== 'stage_win') {
        S.lastHuntLines = res.lines;
        if (!S.state.activeVenture && !S.state.activeCombat) S.view = 'hub';
      }
    }
    render();
  } catch (e) {
    S.error = e.message;
    render();
  }
}

function logPanel() {
  return h('div', { class: 'panel' }, [
    h('h3', {}, '事蹟'),
    // 城鎮的「事蹟」只是歷史記錄,不像戰鬥中的日誌那麼即時關鍵,給較矮的高度上限,把版面留給更常用的地圖列表。
    h('div', { class: 'log-list', style: 'height:clamp(90px,14vh,160px);max-height:clamp(90px,14vh,160px);' }, (S.state.log || []).map((l) => h('div', {}, l.text))),
  ]);
}

// ---- 裝備畫面 ----
// 裝備素質品質(對應後端 rollQuality,0~1):決定顯示的品質標籤與顏色,
// 讓玩家一眼就能分辨同名同階裝備是「爛裝」還是「極品」,不用自己心算數值落在哪個區間。
function rollQualityInfo(q) {
  const v = q == null ? 0.5 : q;
  if (v >= 0.85) return { label: '極品', className: 'quality-excellent' };
  if (v >= 0.6) return { label: '優良', className: 'quality-good' };
  if (v >= 0.4) return { label: '普通', className: 'quality-normal' };
  if (v >= 0.15) return { label: '不佳', className: 'quality-poor' };
  return { label: '劣質', className: 'quality-bad' };
}

// itemLabel 回傳一個完整的 <div> 容器(內部分 2 行,不拆得太瑣碎——標題行含名稱/品質/強化值/次數,
// 屬性行列出全部素質數值),呼叫端直接把回傳值當一個子節點插入,不要再展開陣列。
function itemLabel(item) {
  // enhanceLevel 新制下可能是負數(強化失敗會倒扣),原本只在 >0 時顯示會讓負值被吃掉、
  // 玩家看不出這件裝備其實已經被強化「弱化」過,改成只要不是 0 就顯示(正負皆標示清楚)。
  const enhanceText = item.enhanceLevel ? ` ${item.enhanceLevel > 0 ? '+' : ''}${item.enhanceLevel}` : '';
  const q = rollQualityInfo(item.rollQuality);
  const uses = item.enhanceUses || 0;
  // 耐久度只有武器/防具/副手才有(飾品 maxDurability 為 null,不顯示這段)
  const durabilityText = item.maxDurability != null ? `耐久 ${item.durability}/${item.maxDurability}` : null;
  const isBroken = item.maxDurability != null && item.durability <= 0;
  // 套裝裝備直接標示「目前穿著幾件」,即使這件還在背包沒穿上也能看到「穿上後」的套裝進度是多少
  // (見使用者回饋:不然誰知道有沒有觸發),詳細效果內容改點旁邊的 📖 圖示查看(renderSetInfoIconButton)。
  const setProgress = item.setId ? (S.state?.setProgress || []).find((p) => p.setId === item.setId) : null;
  return h('div', {}, [
    h('div', {}, [
      `${item.name}${enhanceText} `,
      h('span', { class: q.className }, `[${q.label}]`),
      ` (${itemTierLabel(item.tier)}${item.classType ? `・${classNameZh(item.classType)}` : ''}・Lv${item.itemLevel}・強化已用${uses}/${ENHANCE_MAX_USES}次${durabilityText ? `・${durabilityText}` : ''})`,
    ]),
    h('div', { class: 'hint' }, statsText(item.stats)),
    setProgress ? h('div', { class: 'hint', style: 'color:#22d3ee;' }, `套裝「${setProgress.name}」目前穿著 ${setProgress.equippedCount}/${setProgress.pieces} 件`) : null,
    isBroken ? h('div', { class: 'durability-broken' }, '已損壞,無法裝備,只能賣給雜貨店回收') : null,
  ]);
}

const POTENTIAL_TIER_LABEL = { rare: '稀有', epic: '史詩', legendary: '傳說' };
const POTENTIAL_TIER_COLOR = { rare: '#a855f7', epic: '#3b82f6', legendary: '#f59e0b' };
function potentialLine(item) {
  if (!item.potential) return null;
  const pct = (v) => `${Math.round(v * 1000) / 10}%`;
  const text = item.potential.lines.map((l) => `${l.label}+${pct(l.value)}`).join('、');
  return h('div', { style: `color:${POTENTIAL_TIER_COLOR[item.potential.tier]};font-size:13px;` }, `【${POTENTIAL_TIER_LABEL[item.potential.tier]}潛能】${text}`);
}

// 強化(卷軸)常數:須與後端 enhanceEngine.js 完全一致,純供前端顯示文字用。
// 新制不再是「穩定往上疊、成功率隨等級遞減」,而是每次從 -3~+3(共7個整數,機率均等)隨機抽一個
// 變動量,套用到裝備上每一項現有屬性一起變動,每件裝備最多用滿 5 次。
// 王家卷軸(只有真王掉落,不開放商店購買)範圍是 -1~+5,比一般卷軸更好。
const ENHANCE_MAX_USES = 5;
function slotToScrollId(slot) {
  if (slot === 'weapon') return 'scroll_weapon';
  if (slot === 'armor') return 'scroll_armor';
  if (slot === 'offhand') return 'scroll_offhand';
  return 'scroll_accessory';
}
function slotToRoyalScrollId(slot) {
  if (slot === 'weapon') return 'scroll_weapon_royal';
  if (slot === 'armor') return 'scroll_armor_royal';
  if (slot === 'offhand') return 'scroll_offhand_royal';
  return 'scroll_accessory_royal';
}

// 從裝備欄或背包裡依 id 找出裝備物件——強化彈出視窗需要每次重繪時抓最新資料(強化後素質會變),
// 不能只存一份物件快照,否則畫面顯示的會是操作前的舊數值。
function findItemById(itemId) {
  const s = S.state;
  if (!s || !itemId) return null;
  const equipped = Object.values(s.equipment).find((i) => i?.id === itemId);
  if (equipped) return equipped;
  return s.inventory.find((i) => i.id === itemId) || null;
}

// 強化/洗潛能圖示按鈕:放在每件裝備旁邊,用鐵砧圖示表示「打造/強化」,點擊後彈出獨立視窗操作,
// 不再把強化控制項固定展開佔用卡片版面——這是先前「東西太多、太亂」的主因之一。
function renderEnhanceIconButton(item) {
  return h('button', {
    class: 'btn enhance-icon-btn',
    title: '強化 / 洗潛能',
    onclick: () => { S.enhanceModalItemId = item.id; render(); },
  }, '⚒️');
}

// 強化/洗潛能彈出視窗本體:名稱/素質/潛能/耐久等完整資訊,以及實際操作按鈕,通通集中在這裡,
// 操作後視窗保持開啟並即時刷新(不用重新點擊圖示),關閉才回到背包/裝備欄列表。
function renderEnhanceModal() {
  const item = findItemById(S.enhanceModalItemId);
  if (!item) { S.enhanceModalItemId = null; return null; }
  const consumables = S.state.consumables || [];
  const scrollId = slotToScrollId(item.slot);
  const scroll = consumables.find((c) => c.id === scrollId);
  const royalScrollId = slotToRoyalScrollId(item.slot);
  const royalScroll = consumables.find((c) => c.id === royalScrollId);
  const cube = consumables.find((c) => c.id === 'cube_potential');
  const cubeChoice = consumables.find((c) => c.id === 'cube_potential_choice');
  const uses = item.enhanceUses || 0;
  const usesLeft = ENHANCE_MAX_USES - uses;
  const close = () => { S.enhanceModalItemId = null; render(); };
  // 抉擇方塊預覽:只在「目前這件裝備」有暫存預覽時才顯示選擇區塊
  const preview = S.cubeChoicePreview && S.cubeChoicePreview.itemId === item.id ? S.cubeChoicePreview.preview : null;
  // 一般卷軸/王家卷軸的強化按鈕共用同一個生成邏輯,只差消耗的道具與數值範圍說明文字——
  // 王家卷軸只有真王會掉、玩家沒有持有時完全不顯示這顆按鈕,避免介面混亂又用不到。
  const enhanceButton = (targetScrollId, targetScroll, isRoyal) => h('button', {
    class: isRoyal ? 'btn primary' : 'btn',
    title: isRoyal
      ? `消耗1張${targetScroll?.name || ''}。每次從 -1~+5 之間隨機抽一個數值套用到裝備「全部現有屬性」——範圍比一般卷軸更好,期望值更高、最壞情況跌幅也更小(只有真王會掉,商店買不到)。`
      : `消耗1張${targetScroll?.name || ''}。每次從 -3~+3 之間隨機抽一個數值(機率平均,7種結果各約1/7)套用到裝備「全部現有屬性」——這是賭注,不是穩定進步,運氣差可能讓裝備變得比原本更差,也可能剛好抽到0完全沒變化。`,
    onclick: async () => {
      try {
        const r = await api.enhanceItem(item.id, targetScrollId);
        const deltaText = r.delta > 0 ? `+${r.delta}` : `${r.delta}`;
        const resultDesc = r.delta > 0 ? `這次是加強(${deltaText})` : r.delta < 0 ? `這次是削弱(${deltaText})` : '這次沒有任何效果(抽到0)';
        S.error = `強化完成,${resultDesc}。`;
        S.state = r.state;
        render(); // 視窗保持開啟,直接刷新顯示最新素質,不用重新點鐵砧圖示
      } catch (e) { S.error = e.message; render(); }
    },
  }, `${isRoyal ? '王家強化' : '強化'}(還可用${usesLeft}/${ENHANCE_MAX_USES}次,需${targetScroll?.name || '卷軸'}x1,持有${targetScroll?.count || 0})`);
  let overlay;
  overlay = h('div', {
    class: 'modal-overlay',
    onclick: (e) => { if (e.target === overlay) close(); }, // 點擊半透明背景視同取消,不用特地找關閉按鈕
  }, [
    h('div', { class: 'modal-box' }, [
      h('h3', {}, `⚒️ 強化 / 洗潛能`),
      itemLabel(item),
      potentialLine(item),
      h('div', { style: 'margin-top:14px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;' }, [
        usesLeft > 0
          ? h('div', { style: 'display:flex;flex-wrap:wrap;gap:8px;' }, [
              enhanceButton(scrollId, scroll, false),
              royalScroll && royalScroll.count > 0 ? enhanceButton(royalScrollId, royalScroll, true) : null,
            ])
          : h('span', { class: 'hint' }, `已用完全部 ${ENHANCE_MAX_USES} 次強化機會`),
        h('button', {
          class: 'btn',
          title: `消耗1顆${cube?.name || ''}`,
          onclick: async () => {
            try {
              const r = await api.cubeItem(item.id, 'cube_potential');
              S.error = r.upgraded ? `洗鍊成功,潛能升階至【${POTENTIAL_TIER_LABEL[r.item.potential.tier]}】!` : '洗鍊完成,潛能詞條已重新產生。';
              S.state = r.state;
              render();
            } catch (e) { S.error = e.message; render(); }
          },
        }, `洗潛能(需${cube?.name || '方塊'}x1,持有${cube?.count || 0})`),
        // 抉擇方塊:固定洗3條,但用前先看過結果才決定要不要套用——已有預覽時這顆按鈕先隱藏,避免重複消耗
        !preview ? h('button', {
          class: 'btn',
          title: `消耗1顆${cubeChoice?.name || ''}。固定直接洗出3條【傳說】數值範圍的詞條,套用前可以先看過結果,自己選擇要換成新的還是保留原本的潛能——但方塊一經使用即消耗,不論最後選哪邊都不會退還。`,
          onclick: async () => {
            try {
              const r = await api.cubeChoicePreview(item.id);
              S.cubeChoicePreview = { itemId: item.id, preview: r.preview };
              S.state = r.state;
              S.error = '已洗出新的3條詞條,請選擇是否套用。';
              render();
            } catch (e) { S.error = e.message; render(); }
          },
        }, `抉擇洗潛能(需${cubeChoice?.name || '抉擇方塊'}x1,持有${cubeChoice?.count || 0})`) : null,
      ]),
      // 抉擇方塊預覽結果:並排顯示「新洗出的3條」與「目前原本的」,方便直接比較後再決定
      preview ? h('div', { style: 'margin-top:12px;padding:10px;border:1px dashed var(--panel-border);border-radius:6px;' }, [
        h('div', { style: `color:${POTENTIAL_TIER_COLOR.legendary};font-weight:bold;` }, '這次洗出的新詞條(尚未套用):'),
        h('div', {}, preview.lines.map((l) => `${l.label}+${Math.round(l.value * 1000) / 10}%`).join('、')),
        h('div', { style: 'margin-top:8px;display:flex;gap:8px;' }, [
          h('button', {
            class: 'btn primary',
            onclick: async () => {
              try {
                const r = await api.cubeChoiceApply(item.id);
                S.error = '已套用新的潛能詞條!';
                S.state = r.state;
                S.cubeChoicePreview = null;
                render();
              } catch (e) { S.error = e.message; render(); }
            },
          }, '套用新詞條'),
          h('button', {
            class: 'btn',
            onclick: async () => {
              try {
                await api.cubeChoiceCancel(item.id);
                S.error = '已保留原本的潛能,新詞條捨棄不用。';
                S.cubeChoicePreview = null;
                render();
              } catch (e) { S.error = e.message; render(); }
            },
          }, '保留原本'),
        ]),
      ]) : null,
      h('button', { class: 'btn', style: 'margin-top:16px;', onclick: close }, '關閉'),
    ]),
  ]);
  return overlay;
}

// 套裝效果圖示按鈕:只有 setId 存在(菁英/真王套裝)的裝備才會顯示,仿照強化圖示的模式——
// 用小圖示+彈出視窗呈現完整套裝效果說明,不把這些文字直接攤開佔用卡片版面。
function renderSetInfoIconButton(item) {
  if (!item.setId) return null;
  return h('button', {
    class: 'btn enhance-icon-btn',
    title: '查看套裝效果',
    onclick: () => {
      const progress = (S.state.setProgress || []).find((p) => p.setId === item.setId);
      S.setInfoModal = progress
        ? { name: progress.name, pieces: progress.pieces, equippedCount: progress.equippedCount, tiers: progress.tiers }
        : null;
      render();
    },
  }, '📖');
}

// 套裝效果彈出視窗:文字內容主要來自後端(商店配方帶 setTierDescriptions,已裝備的物品用
// S.state.setProgress),前端只負責排版顯示,不重複計算職業特色屬性要顯示成什麼名稱。
// info.equippedCount 有值時(從裝備欄/背包觸發)會額外標示每一階是否已解鎖;從商店配方觸發時
// 沒有這個欄位,單純列出完整效果內容供玩家評估「值不值得湊」。
function renderSetInfoModal() {
  const info = S.setInfoModal;
  if (!info) return null;
  const close = () => { S.setInfoModal = null; render(); };
  const showProgress = info.equippedCount != null;
  let overlay;
  overlay = h('div', {
    class: 'modal-overlay',
    onclick: (e) => { if (e.target === overlay) close(); },
  }, [
    h('div', { class: 'modal-box' }, [
      h('h3', {}, `📖 ${info.name}`),
      h('div', { class: 'hint' }, showProgress ? `目前穿著:${info.equippedCount}/${info.pieces} 件` : `共 ${info.pieces} 件套裝`),
      h('div', { style: 'margin-top:10px;' }, info.tiers.map((t) => {
        const unlocked = showProgress ? info.equippedCount >= t.count : null;
        const style = unlocked === true ? 'color:#22c55e;font-weight:bold;padding:4px 0;' : unlocked === false ? 'color:#888;padding:4px 0;' : 'padding:4px 0;';
        return h('div', { style }, `${unlocked === true ? '✅' : unlocked === false ? '⬜' : '・'} 穿${t.count}件:${t.text}`);
      })),
      h('button', { class: 'btn', style: 'margin-top:14px;', onclick: close }, '關閉'),
    ]),
  ]);
  return overlay;
}


const MATERIAL_KIND_LABEL = { junk: '雜物', material: '製作素材', rare_material: '稀有素材', party_material: '組隊限定素材', set_material: '套裝素材' };
const MATERIAL_KIND_ICON = { junk: '🗑', material: '🧱', rare_material: '💎', party_material: '🎫', set_material: '📦' };

// 背包裝備分類:依部位分組顯示(武器/防具/副手/飾品),而不是全部裝備混成一個長列表——
// 東西一多就分不清哪些是武器哪些是飾品,分類後同類裝備放在一起,找東西不用整排掃過去。
const INV_GROUP_ORDER = ['weapon', 'armor', 'offhand', 'accessory'];
const INV_GROUP_LABEL = { weapon: '⚔ 武器', armor: '🛡 防具', offhand: '🔰 副手', accessory: '💍 飾品' };
function groupInventoryBySlot(inventory) {
  const groups = { weapon: [], armor: [], offhand: [], accessory: [] };
  inventory.forEach((item) => {
    const key = groups[item.slot] ? item.slot : 'accessory'; // 未知部位保守歸類到飾品,不會憑空消失不見
    groups[key].push(item);
  });
  return groups;
}

// 裝備欄固定順序:武器/防具/副手各1格,飾品一/飾品二共2格
const EQUIP_SLOT_ORDER = ['weapon', 'armor', 'offhand', 'accessory1', 'accessory2'];

function renderInventory() {
  const s = S.state;

  // 裝備欄改用格子視覺化(仿照使用者提供的示意圖):固定寬高的槽位,一眼分辨哪些部位已裝備、
  // 哪些是空的,不再是純文字條列。格子內只留最關鍵的名稱/強化值/品質色,完整素質改用滑鼠提示(title)。
  const equipPanel = h('div', { class: 'panel' }, [
    h('h3', {}, '裝備欄'),
    h('p', { class: 'hint' }, '武器/防具/副手各1格;飾品(戒指/護符/項鍊/徽章)共2格,兩格用途相同、可任意放置,不分種類。滑鼠移到裝備名稱上可看完整素質。'),
    h('div', { class: 'equip-slot-grid' }, EQUIP_SLOT_ORDER.map((slot) => {
      const item = s.equipment[slot];
      const q = item ? rollQualityInfo(item.rollQuality) : null;
      const enhanceText = item?.enhanceLevel ? ` ${item.enhanceLevel > 0 ? '+' : ''}${item.enhanceLevel}` : '';
      // 套裝裝備直接標示「目前穿著幾件」,不用點進去才知道有沒有觸發效果(見使用者回饋)
      const setProgress = item?.setId ? (s.setProgress || []).find((p) => p.setId === item.setId) : null;
      return h('div', { class: `equip-slot${item ? ` rarity-${item.tier}` : ''}` }, [
        h('div', { class: 'hint', style: 'font-size:11px;' }, slotLabelZh(slot)),
        item
          ? h('div', { class: 'equip-slot-name', title: `${statsText(item.stats)}${item.maxDurability != null ? ` ・耐久${item.durability}/${item.maxDurability}` : ''}` }, [
              `${item.name}${enhanceText} `,
              h('span', { class: q.className }, `[${q.label}]`),
            ])
          : h('div', { class: 'equip-slot-name hint' }, '(空)'),
        setProgress ? h('div', { class: 'hint', style: 'font-size:11px;color:#22d3ee;' }, `套裝 ${setProgress.equippedCount}/${setProgress.pieces} 件`) : null,
        item
          ? h('div', { class: 'equip-slot-actions' }, [
              h('button', { class: 'btn', onclick: async () => { await api.unequip(slot); await refreshInvState(); } }, '卸下'),
              renderEnhanceIconButton(item),
              renderSetInfoIconButton(item),
            ])
          : null,
      ]);
    })),
  ]);

  // 單張背包裝備卡片:名稱/素質(見 itemLabel)+ 操作按鈕(裝備/賣出/上架/強化圖示)都在同一列,
  // 強化控制項已移到彈出視窗(見 renderEnhanceIconButton/renderEnhanceModal),卡片本身更精簡。
  function renderInventoryItemCard(item) {
    // 飾品是通用格(accessory),裝備時要讓玩家自己選放飾品一還是飾品二;
    // 武器/防具/副手維持單一「裝備」按鈕。
    const equipButtons = item.slot === 'accessory'
      ? [
          h('button', { class: 'btn', onclick: async () => { try { await api.equip(item.id, 'accessory1'); await refreshInvState(); } catch (e) { S.error = e.message; render(); } } }, '裝備至飾品一'),
          h('button', { class: 'btn', onclick: async () => { try { await api.equip(item.id, 'accessory2'); await refreshInvState(); } catch (e) { S.error = e.message; render(); } } }, '裝備至飾品二'),
        ]
      : [h('button', { class: 'btn', onclick: async () => { try { await api.equip(item.id); await refreshInvState(); } catch (e) { S.error = e.message; render(); } } }, '裝備')];
    // 裝備比較:跟目前裝備中同部位的裝備逐項比較數值差異,讓玩家不用自己心算就知道換了划不划算。
    // 飾品有兩格,分別跟飾品一/飾品二比較;其餘部位只有一格,直接比較。空格子(尚未裝備任何東西)
    // 不顯示比較(視為「還沒有基準可比」,不是「差了全部數值」)。
    const compareRows = item.slot === 'accessory'
      ? [
          s.equipment.accessory1 ? renderStatDiff('比飾品一', diffItemStats(item.stats, s.equipment.accessory1.stats)) : null,
          s.equipment.accessory2 ? renderStatDiff('比飾品二', diffItemStats(item.stats, s.equipment.accessory2.stats)) : null,
        ]
      : [s.equipment[item.slot] ? renderStatDiff('比目前裝備', diffItemStats(item.stats, s.equipment[item.slot].stats)) : null];
    return h('div', { class: `item-card rarity-${item.tier}` }, [
      itemLabel(item),
      ...compareRows,
      h('div', { style: 'margin-top:4px;' }, [
        ...equipButtons,
        item.tier === 'common' ? h('button', { class: 'btn', onclick: async () => { try { const r = await api.sellGear(item.id); S.error = `賣出獲得 ${r.earned} 金幣`; S.state = r.state; render(); } catch (e) { S.error = e.message; render(); } } }, '賣給商店') : null,
        h('input', { type: 'number', id: `price-${item.id}`, placeholder: '開價', style: 'width:80px;display:inline-block;margin:0 4px;' }),
        h('button', {
          class: 'btn',
          onclick: async () => {
            const price = Number(document.getElementById(`price-${item.id}`).value);
            try {
              const r = await api.listItem(item.id, price);
              S.error = `已上架,手續費 ${r.fee} 金幣`;
              S.state = r.state;
              render();
            } catch (e) { S.error = e.message; render(); }
          },
        }, '上架交易所'),
        renderEnhanceIconButton(item),
        renderSetInfoIconButton(item),
      ]),
    ]);
  }

  // 材料/雜物清單改用種類圖示分頁籤(仿商店分頁籤模式)——先前依種類全部展開條列,種類一多
  // 就要一路往下滑,現在一次只顯示一個種類,點圖示切換,不需要滑動就能看完(見使用者回饋)。
  const materialGroups = { junk: [], material: [], rare_material: [], party_material: [], set_material: [] };
  s.materials.forEach((m) => { if (materialGroups[m.kind]) materialGroups[m.kind].push(m); });
  const availableMatKinds = Object.keys(materialGroups).filter((k) => materialGroups[k].length > 0);
  if (!availableMatKinds.includes(S.invMaterialFilter)) S.invMaterialFilter = availableMatKinds[0];
  const materialsPanel = h('div', { class: 'panel' }, [
    h('h3', {}, '材料 / 雜物'),
    availableMatKinds.length === 0
      ? h('div', { class: 'hint' }, '身上沒有任何材料或雜物,去闖蕩狩獵/採集吧。')
      : h('div', {}, [
          h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;' }, availableMatKinds.map((k) =>
            h('button', {
              class: `btn${S.invMaterialFilter === k ? ' primary' : ''}`,
              onclick: () => { S.invMaterialFilter = k; render(); },
            }, `${MATERIAL_KIND_ICON[k]} ${MATERIAL_KIND_LABEL[k]}(${materialGroups[k].length})`)
          )),
          h('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;' },
            materialGroups[S.invMaterialFilter].map((m) => h('span', { class: 'item-card', style: 'padding:4px 8px;margin:0;' }, `${m.name} x${m.count}`))
          ),
        ]),
  ]);

  // 背包裝備改用部位圖示分頁籤:同樣道理,一次只顯示一個部位,不用4個部位全部展開往下滑。
  const invGroups = groupInventoryBySlot(s.inventory);
  const availableInvSlots = INV_GROUP_ORDER.filter((key) => invGroups[key].length > 0);
  if (!availableInvSlots.includes(S.invSlotFilter)) S.invSlotFilter = availableInvSlots[0];
  const invPanel = h('div', { class: 'panel' }, [
    h('h3', {}, '背包(裝備)'),
    s.inventory.length === 0
      ? h('div', { class: 'hint' }, '背包空空如也,去闖蕩累積裝備吧。')
      : h('div', {}, [
          h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;' }, availableInvSlots.map((key) =>
            h('button', {
              class: `btn${S.invSlotFilter === key ? ' primary' : ''}`,
              onclick: () => { S.invSlotFilter = key; render(); },
            }, `${INV_GROUP_LABEL[key]}(${invGroups[key].length})`)
          )),
          h('div', { class: 'card-grid', style: 'margin-top:8px;' }, invGroups[S.invSlotFilter].map(renderInventoryItemCard)),
        ]),
  ]);

  // 左欄:裝備欄+材料(較短、資訊型);右欄:背包裝備清單(改分頁籤後已精簡,不再需要額外捲動容器)
  const content = h('div', { class: 'grid-2' }, [
    h('div', {}, [equipPanel, materialsPanel]),
    h('div', {}, [invPanel]),
  ]);
  mount([topBar(), errorBanner()], [content]);
}

async function refreshInvState() {
  const res = await api.getState();
  S.state = res.state;
  S.error = '';
  render();
}

// ---- 商店畫面 ----
async function openShop(shopId) {
  S.shopId = shopId;
  S.error = ''; // 進入商店前先清掉其他畫面殘留的舊提示訊息
  try {
    S.shopData = await api.getShop(shopId);
  } catch (e) {
    S.error = e.message;
  }
  S.view = 'shop';
  render();
}

// 商店配方稀有度/套裝標籤的顏色,基本裝備(依地圖分5階)跟套裝配方(elite_set/trueboss_set)共用同一份色票
const TIER_COLOR = {
  novice_plains: '#b0b0b0', goblin_forest: '#4ade80', stone_mines: '#38bdf8',
  dark_swamp: '#a855f7', ruined_borderlands: '#f59e0b',
  elite_set: '#22d3ee', trueboss_set: '#ef4444',
};

// 商店配方卡片:一般配方與套裝配方共用同一種呈現方式(名稱/金幣/材料需求/屬性/製作按鈕)。
// 套裝配方額外帶 setTierDescriptions 時,顯示「📖 套裝效果」圖示按鈕彈出完整效果說明(仿強化圖示),
// 不把整段效果文字攤開佔用卡片版面——這是先前商店排版太長的主因之一。
function renderRecipeCard(shopId, r) {
  const canAfford = r.materialsDetail.every((d) => d.have >= d.need);
  const matText = r.materialsDetail.map((d) => `${d.name} ${d.have}/${d.need}`).join('、');
  // 跟目前裝備中同部位的裝備比較數值差異,讓玩家在「要不要花材料做這件」之前就能直接判斷划不划算,
  // 不用做出來穿上去才發現其實沒有比較強。飾品有兩格,分別跟兩邊比較。
  const equipment = S.state?.equipment || {};
  const compareRows = r.slot === 'accessory'
    ? [
        equipment.accessory1 ? renderStatDiff('比飾品一', diffItemStats(r.statBonus, equipment.accessory1.stats)) : null,
        equipment.accessory2 ? renderStatDiff('比飾品二', diffItemStats(r.statBonus, equipment.accessory2.stats)) : null,
      ]
    : [equipment[r.slot] ? renderStatDiff('比目前裝備', diffItemStats(r.statBonus, equipment[r.slot].stats)) : null];
  return h('div', { class: `item-card rarity-${r.tier}` }, [
    h('div', {}, `${r.name}(${r.gold} 金幣, `),
    h('span', { style: canAfford ? '' : 'color:#ef4444;' }, matText),
    h('span', {}, ')'),
    h('div', { class: 'hint' }, `屬性:${statsText(r.statBonus)}`),
    ...compareRows,
    h('div', { style: 'margin-top:4px;' }, [
      r.setTierDescriptions && r.setTierDescriptions.length > 0
        ? h('button', {
            class: 'btn',
            title: `${r.setName}套裝效果`,
            onclick: () => {
              S.setInfoModal = { name: r.setName, pieces: r.setPieces, tiers: r.setTierDescriptions };
              render();
            },
          }, '📖 套裝效果')
        : null,
      h('button', {
        class: 'btn primary',
        onclick: async () => {
          try {
            const res = await api.craft(shopId, r.id);
            S.error = `製作成功:${res.crafted.name}`;
            S.state = res.state;
            S.shopData = await api.getShop(shopId);
            render();
          } catch (e) { S.error = e.message; render(); }
        },
      }, '製作'),
    ]),
  ]);
}

function renderShop() {
  const shopId = S.shopId;
  const data = S.shopData;

  const panel = h('div', { class: 'panel' }, [
    h('h3', {}, `${SHOP_NAMES[shopId]}`),
    h('p', { class: 'hint' }, data?.shop?.desc || ''),
  ]);

  if (shopId === 'general' && data) {
    panel.appendChild(h('h3', {}, '藥水'));
    panel.appendChild(h('p', { class: 'hint' }, '藥水為全服共享庫存,庫存越低越貴、缺貨就買不到——庫存靠玩家回收雜物/素材補充(見下方回收區)。'));
    panel.appendChild(h('div', { class: 'card-grid' }, data.market.potions.map((p) => {
      const outOfStock = p.stock <= 0;
      return h('div', { class: 'item-card' }, [
        h('div', {}, `${p.name}(恢復${p.kind === 'hp' ? '氣血' : '真力'} ${Math.round(p.healPct * 100)}%上限) — 售價 ${p.price}`),
        h('div', { class: 'hint' }, outOfStock ? '目前缺貨,請稍後再來' : `庫存 ${p.stock} 瓶`),
        h('button', {
          class: 'btn primary',
          ...(outOfStock ? { disabled: true } : {}),
          onclick: async () => {
            try {
              const r = await api.buyPotion(p.id, 1);
              S.error = `購買成功,花費 ${r.cost} 金幣`;
              S.state = r.state;
              S.shopData = await api.getShop(shopId);
              render();
            } catch (e) { S.error = e.message; render(); }
          },
        }, '購買 x1'),
      ]);
    })));

    panel.appendChild(h('h3', { style: 'margin-top:14px;' }, '強化卷軸 / 潛能方塊(用於背包/裝備欄畫面強化裝備)'));
    panel.appendChild(h('p', { class: 'hint' }, '同樣是全服共享庫存,缺貨就買不到。抉擇方塊已不開放購買,只能擊敗菁英以上的王才有機會取得(0~2個,不保底)。'));
    panel.appendChild(h('div', { class: 'card-grid' }, data.market.enhanceItems.map((c) => {
      const held = S.state.consumables.find((x) => x.id === c.id)?.count || 0;
      const outOfStock = c.stock <= 0;
      return h('div', { class: 'item-card' }, [
        h('div', {}, `${c.name} — 售價 ${c.price} 金幣(持有 ${held})`),
        h('div', { class: 'hint' }, c.kind === 'scroll' ? `適用部位:${c.appliesTo === 'weapon' ? '武器' : c.appliesTo === 'offhand' ? '副手' : c.appliesTo === 'armor' ? '防具' : '飾品'}` : '可用於任何裝備,洗鍊隨機百分比詞條'),
        h('div', { class: 'hint' }, outOfStock ? '目前缺貨,請稍後再來' : `庫存 ${c.stock} 個`),
        h('button', {
          class: 'btn primary',
          ...(outOfStock ? { disabled: true } : {}),
          onclick: async () => {
            try {
              const r = await api.buyEnhanceItem(c.id, 1);
              S.error = `購買成功,花費 ${r.cost} 金幣`;
              S.state = r.state;
              S.shopData = await api.getShop(shopId);
              render();
            } catch (e) { S.error = e.message; render(); }
          },
        }, '購買 x1'),
      ]);
    })));

    panel.appendChild(h('h3', { style: 'margin-top:14px;' }, '回收雜物/素材(依全服庫存量動態計價;製作素材要留著做裝備還是賣錢由你決定)'));
    const mySellables = S.state.materials.filter((m) => ['junk', 'material', 'rare_material', 'party_material', 'set_material'].includes(m.kind));
    if (mySellables.length === 0) panel.appendChild(h('div', { class: 'hint' }, '身上沒有可回收的雜物或素材。'));
    const doSell = async (itemId, qty) => {
      try {
        const r = await api.sellJunk(itemId, qty);
        S.error = `賣出獲得 ${r.earned} 金幣`;
        S.state = r.state;
        S.shopData = await api.getShop(shopId);
        render();
      } catch (e) { S.error = e.message; render(); }
    };
    // 各素材種類的簡短提示文字(不含雜物,雜物不用額外標示種類)
    const KIND_HINT_ZH = { rare_material: '稀有素材', material: '製作素材', party_material: '組隊限定', set_material: '套裝素材' };
    panel.appendChild(h('div', { class: 'card-grid list-scroll' }, mySellables.map((m) => {
      const marketInfo = data.market.sellables.find((j) => j.id === m.id);
      const qtyInputId = `sell-qty-${m.id}`;
      return h('div', { class: 'item-card' }, [
        h('div', {}, `${m.name}${m.kind !== 'junk' ? `(${KIND_HINT_ZH[m.kind] || '製作素材'})` : ''} x${m.count}(單價 ${marketInfo?.currentPrice ?? '?'})`),
        h('div', { style: 'margin-top:4px;' }, [
          h('input', { type: 'number', id: qtyInputId, min: '1', max: String(m.count), value: String(m.count), style: 'width:70px;display:inline-block;margin-right:4px;' }),
          h('button', {
            class: 'btn',
            onclick: () => {
              const raw = Number(document.getElementById(qtyInputId).value);
              const qty = Math.min(m.count, Math.max(1, Math.floor(raw) || 1));
              doSell(m.id, qty);
            },
          }, '賣出'),
          h('button', { class: 'btn', onclick: () => doSell(m.id, 1) }, '只賣1個'),
        ]),
      ]);
    })));

    // 雜貨店也能製作「真王飾品」套裝配方(職業通用,固定放在此處統一製作,見 setGearData.js)
    if ((data.setRecipes || []).length > 0) {
      panel.appendChild(h('h3', { style: 'margin-top:14px;' }, '套裝製作(真王飾品,職業通用)'));
      panel.appendChild(h('div', { class: 'card-grid' }, data.setRecipes.map((r) => renderRecipeCard(shopId, r))));
    }
  } else if (data) {
    // 商店配方改為「部位分頁籤 + 一般/套裝類型分頁籤」:一次只顯示一個部位、一個類型的少量配方,
    // 不再 4 部位 x 5 種稀有度/套裝全部展開——先前那樣要一路往下滑很長才看得完,使用者明確要求
    // 「能在一個頁面看完就不要讓使用者滑動」。仿照強化功能給圖示彈視窗的思路,這裡改用分頁籤縮小
    // 同時顯示的範圍,而不是把所有配方都攤開。
    panel.appendChild(h('h3', {}, '裝備製作(僅此商店可製作,無法透過打怪取得;不設等級門檻,材料+金幣足夠即可製作)'));
    const SHOP_SLOT_ORDER = ['weapon', 'armor', 'offhand', 'accessory'];
    const SHOP_SLOT_LABEL = { weapon: '⚔ 武器', armor: '🛡 防具', offhand: '🔰 副手', accessory: '💍 飾品' };
    const availableSlots = SHOP_SLOT_ORDER.filter((slot) =>
      (data.recipes || []).some((r) => r.slot === slot) || (data.setRecipes || []).some((r) => r.slot === slot)
    );
    if (!availableSlots.includes(S.shopSlotFilter)) S.shopSlotFilter = availableSlots[0];

    panel.appendChild(h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;' }, availableSlots.map((slot) =>
      h('button', {
        class: `btn${S.shopSlotFilter === slot ? ' primary' : ''}`,
        onclick: () => { S.shopSlotFilter = slot; render(); },
      }, SHOP_SLOT_LABEL[slot])
    )));

    const normalRecipesForSlot = (data.recipes || []).filter((r) => r.slot === S.shopSlotFilter);
    const setRecipesForSlot = (data.setRecipes || []).filter((r) => r.slot === S.shopSlotFilter);
    const categories = [];
    if (normalRecipesForSlot.length > 0) categories.push({ key: 'normal', label: `一般配方(${normalRecipesForSlot.length})` });
    if (setRecipesForSlot.length > 0) categories.push({ key: 'set', label: `套裝配方(${setRecipesForSlot.length})` });
    if (!categories.some((c) => c.key === S.shopCategoryFilter)) S.shopCategoryFilter = categories[0]?.key;

    if (categories.length > 1) {
      panel.appendChild(h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;' }, categories.map((c) =>
        h('button', {
          class: `btn${S.shopCategoryFilter === c.key ? ' primary' : ''}`,
          onclick: () => { S.shopCategoryFilter = c.key; render(); },
        }, c.label)
      )));
    }

    if (S.shopCategoryFilter === 'normal') {
      // tier 欄位現在存地圖id(依地圖成長,見 itemData.js),用 S.state.maps 的順序逐一顯示——
      // 每個部位在每張地圖只有一張配方,5張地圖的卡片並排顯示(card-grid 自動換行),不用再多一層分頁籤。
      (S.state.maps || []).map((m) => m.id).forEach((mapId) => {
        const tierRecipes = normalRecipesForSlot.filter((r) => r.tier === mapId);
        if (tierRecipes.length === 0) return;
        panel.appendChild(h('div', { style: `color:${TIER_COLOR[mapId]};font-weight:bold;margin-top:8px;` }, `【${tierRecipes[0].tierLabel}】`));
        panel.appendChild(h('div', { class: 'card-grid' }, tierRecipes.map((r) => renderRecipeCard(shopId, r))));
      });
    } else if (S.shopCategoryFilter === 'set') {
      ['elite_set', 'trueboss_set'].forEach((tier) => {
        const tierRecipes = setRecipesForSlot.filter((r) => r.tier === tier);
        if (tierRecipes.length === 0) return;
        panel.appendChild(h('div', { style: `color:${TIER_COLOR[tier]};font-weight:bold;margin-top:8px;` }, `【${tierRecipes[0].tierLabel}・${tierRecipes[0].setName}】`));
        panel.appendChild(h('div', { class: 'card-grid' }, tierRecipes.map((r) => renderRecipeCard(shopId, r))));
      });
    }
  }

  mount([topBar(), errorBanner()], [panel, h('button', { class: 'btn', onclick: () => { S.error = ''; S.view = 'hub'; render(); } }, '返回城鎮')]);
}

// ---- 交易所 ----
async function openAuction() {
  try {
    const res = await api.getListings();
    S.auctionListings = res.listings;
  } catch (e) { S.error = e.message; }
  S.view = 'auction';
  render();
}

// 交易所搜尋:可篩選的潛能詞條種類(對應 enhanceEngine.js 的 POTENTIAL_LINE_POOL key,label 沿用同一份中文)
const POTENTIAL_FILTER_OPTIONS = [
  { key: 'atkPowerPct', label: '攻擊強度' },
  { key: 'defPct', label: '防禦力' },
  { key: 'hpPct', label: '氣血上限' },
  { key: 'critRatePct', label: '會心率' },
];

// 依 S.auctionFilter 篩選交易所清單:潛能種類複選(符合勾選其中任一種即算通過)、
// 攻擊/魔攻最小值(該裝備 atk 或 matk 其中一項達標即算通過,武器類裝備才有意義)、
// 強化次數最少幾次(enhanceUses >= 門檻)。三個條件都留空/未勾選時視為不篩選。
function filterAuctionListings(listings) {
  const f = S.auctionFilter;
  return listings.filter((l) => {
    const item = l.item;
    if (f.potentialKeys.size > 0) {
      const lines = item.potential?.lines || [];
      if (!lines.some((line) => f.potentialKeys.has(line.key))) return false;
    }
    if (f.minAtk !== '' && f.minAtk != null) {
      const minAtk = Number(f.minAtk);
      const atkVal = Math.max(item.stats?.atk || 0, item.stats?.matk || 0);
      if (atkVal < minAtk) return false;
    }
    if (f.minEnhanceUses !== '' && f.minEnhanceUses != null) {
      if ((item.enhanceUses || 0) < Number(f.minEnhanceUses)) return false;
    }
    return true;
  });
}

function renderAuctionFilterPanel() {
  const f = S.auctionFilter;
  const applyFilter = () => {
    f.minAtk = document.getElementById('auction-min-atk').value;
    f.minEnhanceUses = document.getElementById('auction-min-enhance').value;
    render();
  };
  return h('div', { class: 'panel' }, [
    h('h3', {}, '搜尋條件'),
    h('div', { class: 'hint', style: 'margin-bottom:4px;' }, '潛能詞條(複選,符合其中一種即顯示):'),
    h('div', { style: 'display:flex;flex-wrap:wrap;gap:10px;margin-bottom:8px;' }, POTENTIAL_FILTER_OPTIONS.map((opt) => {
      const checkbox = h('input', { type: 'checkbox', onclick: (e) => { if (e.target.checked) f.potentialKeys.add(opt.key); else f.potentialKeys.delete(opt.key); render(); } });
      if (f.potentialKeys.has(opt.key)) checkbox.checked = true; // 直接設 DOM 屬性而非傳入 attrs(避免 setAttribute('checked', null) 誤把 checkbox 弄成一律勾選)
      return h('label', { style: 'display:flex;align-items:center;gap:4px;' }, [checkbox, opt.label]);
    })),
    h('div', { style: 'display:flex;flex-wrap:wrap;gap:12px;align-items:center;' }, [
      h('label', { style: 'display:flex;align-items:center;gap:4px;' }, [
        '攻擊力/魔攻最少:',
        h('input', { type: 'number', id: 'auction-min-atk', value: f.minAtk, style: 'width:70px;' }),
      ]),
      h('label', { style: 'display:flex;align-items:center;gap:4px;' }, [
        '強化最少次數:',
        h('input', { type: 'number', id: 'auction-min-enhance', value: f.minEnhanceUses, style: 'width:60px;', min: '0', max: String(ENHANCE_MAX_USES) }),
      ]),
      h('button', { class: 'btn primary', onclick: applyFilter }, '套用搜尋'),
      (f.potentialKeys.size > 0 || f.minAtk !== '' || f.minEnhanceUses !== '') ? h('button', {
        class: 'btn',
        onclick: () => { f.potentialKeys = new Set(); f.minAtk = ''; f.minEnhanceUses = ''; render(); },
      }, '清除條件') : null,
    ]),
  ]);
}

function renderAuction() {
  const filtered = filterAuctionListings(S.auctionListings);
  const panel = h('div', { class: 'panel' }, [
    h('h3', {}, `交易所(${filtered.length}/${S.auctionListings.length})`),
    h('p', { class: 'hint' }, '玩家互相上架/購買裝備,上架收取開價 5% 手續費,24 小時後自動下架。'),
    h('div', { class: 'card-grid list-scroll' }, filtered.map((l) =>
      h('div', { class: `item-card rarity-${l.item.tier}` }, [
        itemLabel(l.item),
        potentialLine(l.item),
        h('div', { class: 'hint', style: 'margin-top:2px;' }, `賣家:${l.sellerName} — 開價 ${l.price} 金幣`),
        l.sellerName === S.playerId
          ? h('button', { class: 'btn danger', onclick: async () => { try { const r = await api.cancelListing(l.id); S.state = r.state; await openAuction(); } catch (e) { S.error = e.message; render(); } } }, '取消上架')
          : h('button', { class: 'btn primary', onclick: async () => { try { const r = await api.buyListing(l.id); S.state = r.state; S.error = '購買成功!'; await openAuction(); } catch (e) { S.error = e.message; render(); } } }, '購買'),
      ])
    )),
    filtered.length === 0 ? h('div', { class: 'hint' }, S.auctionListings.length === 0 ? '目前沒有任何上架物品。' : '沒有符合搜尋條件的物品。') : null,
  ]);
  mount([topBar(), errorBanner()], [renderAuctionFilterPanel(), panel]);
}

// ---- 組隊副本畫面 ----
function renderParty() {
  const sock = connectSocket();
  bindPartySocket(sock);

  const panel = h('div', { class: 'panel' }, [
    h('h3', {}, '組隊副本'),
    h('p', { class: 'hint' }, '選定一張地圖挑戰副本:先清一波小怪,再迎戰該圖大王(含蓄力/狂暴機制),通關人人都有經驗與戰利品。'),
    !S.party ? h('div', {}, [
      h('button', { class: 'btn primary', onclick: () => sock.emit('party:create') }, '建立隊伍'),
      h('input', { type: 'text', id: 'p-code', placeholder: '輸入隊伍代碼' }),
      h('button', { class: 'btn', onclick: () => sock.emit('party:join', { code: document.getElementById('p-code').value.trim().toUpperCase() }) }, '加入隊伍'),
    ]) : h('div', {}, [
      h('div', {}, `隊伍代碼:${S.party.code}`),
      h('div', {}, `成員:${S.party.members.map((m) => m.username).join('、')}`),
      // 戰鬥「進行中」(combat 存在且 ended 為 null)才需要隱藏地圖列表/離隊按鈕——一旦分出勝負
      // (combat.ended 為 'win' 或 'lose'),就要讓玩家能繼續選地圖再戰或離隊,不能卡在結果畫面
      // 什麼都按不了。先前沒有處理「戰鬥已結束」這個中間狀態,玩家(尤其單人挑戰,很容易落敗)
      // 打完一場就完全卡住,連「離隊」都點不到。
      (!S.party.combat || S.party.combat.ended) ? h('div', { class: 'card-grid' }, (S.state.maps || []).map((m) =>
        h('div', { class: 'item-card' }, [
          h('div', {}, `${m.name}(Lv.${m.levelRange[0]}~${m.levelRange[1]})`),
          h('button', { class: 'btn primary', onclick: () => sock.emit('party:start-bounty', { mapId: m.id }) }, '挑戰副本'),
        ])
      )) : null,
      (!S.party.combat || S.party.combat.ended) ? h('button', { class: 'btn', onclick: () => { sock.emit('party:leave'); S.party = null; render(); } }, '離隊') : null,
    ]),
    S.party?.combat ? renderPartyCombat(S.party.combat) : null,
  ]);
  // 副本戰鬥「進行中」才改用精簡標題列(理由同單人戰鬥,見 combatTopBar)——一旦分出勝負
  // (combat.ended 有值),要換回完整標題列,才能看到導覽分頁,不然畫面卡在精簡列、切不去別的畫面。
  const inActiveCombat = S.party?.combat && !S.party.combat.ended;
  mount([inActiveCombat ? combatTopBar() : topBar(), errorBanner()], [panel]);
}

function renderPartyCombat(combat) {
  const sock = getSocket();
  const selfEntry = Object.entries(combat.members).find(([, m]) => m.username === S.playerId);
  const self = selfEntry ? selfEntry[1] : null;
  const selfClassSkills = S.state.skills;
  const level = S.state.level;
  const aliveEnemyCount = combat.enemies.filter((e) => e.hp > 0).length;

  const doAction = (action, extra = {}) => sock.emit('party:action', { action, ...extra });

  return h('div', { style: 'margin-top:12px;' }, [
    h('h4', {}, `第 ${combat.waveIndex + 1}/${combat.totalWaves} 波 — ${combat.mapName}`),
    ...combat.enemies.map((e) => {
      const pct = Math.round((e.hp / e.maxHp) * 100);
      return h('div', { class: 'bar-bg', style: 'margin-bottom:4px;' }, [h('div', { class: 'bar-fill enemy', style: `width:${pct}%` }), h('div', { class: 'bar-label' }, `${e.name}(Lv.${e.level}) ${e.hp}/${e.maxHp}`)]);
    }),
    h('div', { style: 'height:6px' }),
    ...Object.entries(combat.members).map(([uid, m]) => {
      const pct = Math.round((m.hp / m.maxHp) * 100);
      const isSelf = m.username === S.playerId;
      return h('div', { style: 'margin-bottom:4px;' }, [
        h('div', { class: 'bar-bg' }, [h('div', { class: 'bar-fill hp', style: `width:${pct}%` }), h('div', { class: 'bar-label' }, `${m.username}${isSelf ? '(你)' : ''} ${m.hp}/${m.maxHp}`)]),
        isSelf ? h('div', { class: 'bar-bg', style: 'margin-top:2px;' }, [h('div', { class: 'bar-fill mp', style: `width:${Math.round((m.mp / m.maxMp) * 100)}%` }), h('div', { class: 'bar-label' }, `真力 ${m.mp}/${m.maxMp}`)]) : null,
      ]);
    }),
    h('div', {
      class: 'log-list',
      style: 'margin-top:10px;',
    }, combat.log.map((l) => h('div', { class: l.includes('⚠') ? 'log-telegraph' : l.includes('💥') ? 'log-impact' : '' }, l))),

    !combat.ended && self && self.hp > 0
      ? h('div', { class: 'skill-bar', style: 'flex-direction:column;align-items:stretch;margin-top:8px;' }, [
          h('div', { class: 'skill-row' }, [
            h('span', { class: 'skill-row-label' }, '單體'),
            ...combat.enemies.map((e, idx) => e.hp > 0
              ? h('button', { class: 'skill-btn attack', onclick: () => doAction('basic', { targetIndex: idx }) }, aliveEnemyCount > 1 ? `${selfClassSkills.basic.name}→${e.name}` : selfClassSkills.basic.name)
              : null),
          ]),
          h('div', { class: 'skill-row' }, [
            h('span', { class: 'skill-row-label' }, '範圍'),
            level >= selfClassSkills.aoe.unlockLevel
              ? h('button', { class: 'skill-btn', onclick: () => doAction('aoe') }, `${selfClassSkills.aoe.name}(真力${selfClassSkills.aoe.mpCost})`)
              : h('button', { class: 'skill-btn locked', disabled: true }, `🔒${selfClassSkills.aoe.name}(Lv.${selfClassSkills.aoe.unlockLevel})`),
          ]),
          h('div', { class: 'skill-row' }, [
            h('span', { class: 'skill-row-label' }, '增益'),
            level >= selfClassSkills.buff.unlockLevel
              ? h('button', { class: 'skill-btn', onclick: () => doAction('buff') }, `${selfClassSkills.buff.name}(真力${selfClassSkills.buff.mpCost})`)
              : h('button', { class: 'skill-btn locked', disabled: true }, `🔒${selfClassSkills.buff.name}(Lv.${selfClassSkills.buff.unlockLevel})`),
          ]),
          h('div', { class: 'skill-row' }, [
            h('span', { class: 'skill-row-label' }, '防禦'),
            h('button', { class: 'skill-btn defend', onclick: () => doAction('defend') }, '防禦(減傷50%)'),
          ]),
        ])
      : null,
    !combat.ended && self && self.hp > 0
      ? h('div', { style: 'margin-top:6px;' }, S.state.potions.filter((p) => p.count > 0).map((p) =>
          h('button', { class: 'btn', onclick: () => doAction('potion', { potionId: p.id }) }, `使用${p.name}(x${p.count})`)
        ))
      : null,

    combat.ended ? h('div', { class: 'hint', style: 'margin-top:8px;' }, combat.ended === 'win' ? '副本通關!' : '此戰落敗,副本挑戰失敗。') : null,
  ]);
}

function bindPartySocket(sock) {
  if (sock._partyBound) return;
  sock._partyBound = true;
  sock.on('party:joined', (data) => { S.party = { ...data, combat: S.party?.combat || null }; render(); });
  sock.on('party:combat-update', (data) => { if (S.party) { S.party.combat = data.combat; render(); } });
  sock.on('party:reward', (data) => {
    const dropsText = data.drops.length ? `,戰利品:${data.drops.join('、')}` : '';
    S.error = `副本獎勵:經驗+${data.totalExp}${dropsText}${data.leveledTo ? `,升級至Lv.${data.leveledTo}!` : ''}`;
    refreshState();
  });
  sock.on('party:error', (data) => { S.error = data.error; render(); });
}

// ---- 決鬥畫面 ----
function openDuel() {
  const sock = connectSocket();
  bindDuelSocket(sock);
  // 只在「切換進來」這個時間點要一次快照,不要放進 renderDuel() 本身——
  // 那樣的話收到 presence:update 觸發的重繪又會再要一次,變成無窮迴圈。
  sock.emit('presence:request');
  S.view = 'duel';
  render();
}

function renderDuel() {
  const sock = connectSocket();
  bindDuelSocket(sock);

  const challengeBtn = (targetPlayerId, stakes) => h('button', {
    class: stakes === 'death' ? 'btn danger' : 'btn',
    onclick: () => {
      if (stakes === 'death' && !confirm(`向「${targetPlayerId}」送出生死戰帖,敗者帳號將被永久刪除,確定?`)) return;
      sock.emit('duel:challenge', { targetPlayerId, stakes });
    },
  }, stakes === 'death' ? '決生死' : '論勝負');

  // 在線玩家名單:直接點選要挑戰的對象,顯示與下戰帖一律用玩家ID,不曝光任何人的登入帳號。
  const onlineListPanel = h('div', { class: 'panel' }, [
    h('h3', { style: 'font-size:15px;' }, `在線玩家(${S.onlinePlayers.length})`),
    S.onlinePlayers.length === 0
      ? h('div', { class: 'hint' }, '目前沒有其他玩家在線,晚點再來看看。')
      : h('div', { class: 'card-grid list-scroll' }, S.onlinePlayers.map((p) =>
          h('div', { class: 'item-card' }, [
            h('div', { style: 'margin-bottom:4px;' }, p.playerId || '(尚未取名)'),
            challengeBtn(p.playerId, 'win'),
            challengeBtn(p.playerId, 'death'),
          ])
        )),
  ]);

  const panel = h('div', { class: 'panel' }, [
    h('h3', {}, '決鬥'),
    h('p', { class: 'hint' }, '論勝負:切磋較量,點到為止。決生死:立下生死戰約,敗者帳號永久刪除,唯有勝者能得大量經驗。'),
    !S.duel ? h('div', {}, [
      h('p', { class: 'hint' }, '也可以直接輸入對方的玩家ID(不一定要在下方名單裡,但對方要在線才能收到戰帖):'),
      h('input', { type: 'text', id: 'd-target', placeholder: '對方玩家ID' }),
      h('button', { class: 'btn', onclick: () => sock.emit('duel:challenge', { targetPlayerId: document.getElementById('d-target').value.trim(), stakes: 'win' }) }, '下戰帖(論勝負)'),
      h('button', { class: 'btn danger', onclick: () => {
        if (confirm('此為生死決鬥,敗者帳號將被永久刪除,確定送出戰帖?')) {
          sock.emit('duel:challenge', { targetPlayerId: document.getElementById('d-target').value.trim(), stakes: 'death' });
        }
      } }, '下戰帖(決生死)'),
      S.duelPending ? h('div', { class: 'panel', style: 'margin-top:10px;' }, [
        h('div', {}, `${S.duelPending.challengerName} 向你下了${S.duelPending.stakes === 'death' ? '生死' : '較量'}戰帖!`),
        h('button', { class: 'btn primary', onclick: () => sock.emit('duel:accept') }, '應戰'),
        h('button', { class: 'btn', onclick: () => { sock.emit('duel:decline'); S.duelPending = null; render(); } }, '婉拒'),
      ]) : null,
    ]) : renderDuelCombat(),
  ]);
  // 決鬥「進行中」才用精簡標題列(理由同單人戰鬥/組隊副本)——一旦分出勝負就換回完整標題列,
  // 不用等玩家點「返回」才能看到導覽分頁。
  const inActiveDuel = S.duel && !S.duel.ended;
  mount([inActiveDuel ? combatTopBar() : topBar(), S.duelMsg ? h('div', { class: 'error-msg', style: 'margin:6px 0 0;' }, S.duelMsg) : null], [S.duel ? panel : onlineListPanel, S.duel ? null : panel]);
}

function renderDuelCombat() {
  const sock = getSocket();
  const d = S.duel;
  const aPct = Math.round((d.a.hp / d.a.maxHp) * 100);
  const bPct = Math.round((d.b.hp / d.b.maxHp) * 100);
  // 判斷是否輪到自己:比對 a/b 裡哪一方是自己(d.a.username/d.b.username 這兩個欄位實際存放的
  // 是玩家ID,見 duelEngine.js 的 displayName,故用 S.playerId 對照),再看該方的 userId 是否等於
  // 伺服器記錄的 turnUserId。伺服器端才是真正擋非法出手的防線,這裡純粹是體驗優化——輪到對方時
  // 不顯示按鈕,不用手動去點了才發現「尚未輪到你」的錯誤訊息。
  const selfSide = d.a.username === S.playerId ? d.a : d.b.username === S.playerId ? d.b : null;
  const isMyTurn = selfSide && d.turnUserId === selfSide.userId;
  return h('div', {}, [
    h('div', { class: 'bar-bg' }, [h('div', { class: 'bar-fill hp', style: `width:${aPct}%` }), h('div', { class: 'bar-label' }, `${d.a.username} ${d.a.hp}/${d.a.maxHp}`)]),
    h('div', { class: 'bar-bg', style: 'margin-top:4px;' }, [h('div', { class: 'bar-fill enemy', style: `width:${bPct}%` }), h('div', { class: 'bar-label' }, `${d.b.username} ${d.b.hp}/${d.b.maxHp}`)]),
    h('div', { class: 'log-list', style: 'margin-top:10px;' }, d.log.map((l) => h('div', {}, l))),
    !d.ended
      ? (isMyTurn
          ? h('button', { class: 'btn primary', onclick: () => sock.emit('duel:attack') }, '出手')
          : h('div', { class: 'hint' }, '等待對方出手……'))
      : h('div', {}, [
          h('div', { class: 'hint' }, '此戰已分勝負。'),
          // 分出勝負後要有明確的「返回」按鈕可以按,不然畫面卡在這裡沒有任何可操作項目
          // (先前只有 stakes:'death' 的生死戰勝負會收到額外事件重置畫面,論勝負的一般決鬥
          // 完全沒有任何機制清掉 S.duel,玩家會卡在這個結果畫面回不去)。
          h('button', { class: 'btn primary', style: 'margin-top:8px;', onclick: () => { S.duel = null; render(); } }, '返回'),
        ]),
  ]);
}

function bindDuelSocket(sock) {
  if (sock._duelBound) return;
  sock._duelBound = true;
  sock.on('presence:update', (data) => { S.onlinePlayers = data.players; if (S.view === 'duel') render(); });
  sock.on('duel:challenged', (data) => { S.duelPending = data; render(); });
  sock.on('duel:start', (data) => { S.duel = data.duel; S.duelPending = null; render(); });
  sock.on('duel:update', (data) => { S.duel = data.duel; render(); });
  sock.on('duel:error', (data) => { S.duelMsg = data.error; render(); });
  sock.on('duel:victory', () => { S.duelMsg = '你贏得了這場生死之戰,經驗大漲!'; S.duel = null; refreshState(); });
  sock.on('duel:eliminated', (data) => {
    S.deathMessage = data.message;
    S.view = 'dead';
    render();
  });
}

function doLogout() {
  clearToken();
  disconnectSocket();
  S.state = null;
  S.view = 'auth';
  render();
}

async function enterGame() {
  // 玩家ID(遊戲暱稱)是選職業前的第一道關卡,尚未設定就導向取ID畫面,不需要先取得角色狀態
  // (角色本來就還沒選職業,state 也沒什麼好顯示的)。
  if (!S.playerId) {
    S.view = 'setPlayerId';
    render();
    return;
  }
  const res = await api.getState();
  S.state = res.state;
  // 職業列表一律都要抓,不能只在「尚未選職業」時才抓——classNameZh() 顯示裝備的職業限定標示
  // (例如「戰士」專屬武器)全程都要靠 S.classes 查中文名稱,只在選職業畫面才抓的話,選完職業後
  // S.classes 會一直是空陣列,之後只要遇到帶 classType 的裝備就會直接顯示英文代碼(warrior/mage/
  // rogue/archer)而不是中文職業名稱。
  const clsRes = await api.getClasses();
  S.classes = clsRes.classes;
  S.view = S.state.classChosen ? 'hub' : 'chooseClass';
  render();
}

// ---- 版本更新偵測 ----
// 這是單頁應用(SPA),玩家分頁只要沒重新整理,就會一直執行「打開分頁當下」載入的舊版前端 JS,
// 但呼叫的 API 永遠是即時的新版後端。一旦某次更新改變了資料格式語意(例如曾經把裝備 tier 從
// common/rare/epic 改成地圖id),舊版前端的篩選邏輯可能完全對不上新版資料,玩家會看到「分類
// 數字明明有東西,底下清單卻是空的」這種自己完全無法判斷是不是程式壞掉的詭異現象。
// 開分頁當下記錄伺服器版本(見 server/index.js 的 SERVER_BOOT_ID),之後定期輪詢比對,一旦偵測到
// 後端已經重新部署,就顯示固定在畫面最上方的提示條,引導玩家重新整理拿到對應的新版前端。
function renderVersionBanner() {
  const existing = document.getElementById('version-banner');
  if (!S.newVersionAvailable) {
    if (existing) existing.remove();
    return;
  }
  if (existing) return; // 已經顯示過,不用重複插入
  const banner = h('div', {
    id: 'version-banner',
    style: 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#f59e0b;color:#1a1a1a;'
      + 'padding:8px 12px;text-align:center;font-size:14px;font-weight:bold;display:flex;'
      + 'align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;',
  }, [
    h('span', {}, '遊戲已推出新版本,請重新整理頁面(部分功能可能因版本不同而顯示異常)'),
    h('button', {
      style: 'padding:4px 12px;background:#1a1a1a;color:#f59e0b;border:1px solid #1a1a1a;border-radius:4px;font-weight:bold;cursor:pointer;',
      onclick: () => window.location.reload(),
    }, '立即重新整理'),
  ]);
  document.body.appendChild(banner);
}

function startVersionWatch() {
  const check = async () => {
    try {
      const { bootId } = await api.getVersion();
      if (S.bootId === null) {
        S.bootId = bootId; // 第一次檢查:記錄這個分頁載入當下的伺服器版本,之後才有東西可比對
        return;
      }
      if (bootId !== S.bootId && !S.newVersionAvailable) {
        S.newVersionAvailable = true;
        renderVersionBanner();
      }
    } catch {
      // 檢查失敗(離線/伺服器重啟中)不影響遊戲本身,靜默忽略,下次輪詢再試
    }
  };
  check();
  setInterval(check, 45000);
}

function render() {
  if (S.view === 'auth') return renderAuth();
  if (S.view === 'setPlayerId') return renderSetPlayerId();
  if (S.view === 'chooseClass') return renderChooseClass();
  if (S.view === 'dead') return renderDeadScreen();
  if (S.view === 'hub') {
    if (S.state.activeCombat || S.state.activeVenture) return renderVenture();
    return renderHub();
  }
  if (S.view === 'inventory') return renderInventory();
  if (S.view === 'shop') return renderShop();
  if (S.view === 'auction') return renderAuction();
  if (S.view === 'party') return renderParty();
  if (S.view === 'duel') return renderDuel();
}

(async function init() {
  startVersionWatch();
  if (getToken()) {
    try {
      // 頁面重新整理/重新開啟分頁時,token 還在 localStorage,但記憶體中的 S.username/S.playerId
      // 會被重置為初始值——用 api.me() 問伺服器目前登入者的完整資訊(playerId 是動態設定的資料,
      // 沒有編進 JWT,getUsernameFromToken() 只能還原 username,還原不了 playerId)。
      const me = await api.me();
      S.username = me.username;
      S.playerId = me.playerId;
      await enterGame();
      return;
    } catch {
      clearToken();
    }
  }
  render();
})();
