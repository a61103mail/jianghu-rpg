// 勇者闖蕩:前端主程式(單一 view-state 應用,無框架)
import { api, setToken, clearToken, getToken } from './api.js';
import { connectSocket, getSocket, disconnectSocket } from './socket.js';

const app = document.getElementById('app');

const SHOP_NAMES = { blacksmith: '鐵匠鋪', leather: '皮革店', magic: '法術店', church: '教堂', general: '雜貨店' };
const SHOP_ORDER = ['blacksmith', 'leather', 'magic', 'church', 'general'];
const ITEM_TIER_LABEL = { common: '普通', rare: '稀有', epic: '超稀有' };
function itemTierLabel(tier) { return ITEM_TIER_LABEL[tier] || '普通'; }

// 裝備部位/屬性代碼一律翻成中文顯示,不要讓 weapon/atk/critRatePct 這種英文代碼直接出現在畫面上
const SLOT_LABEL_ZH = { weapon: '武器', armor: '防具', accessory1: '飾品一', accessory2: '飾品二', accessory: '飾品' };
function slotLabelZh(slot) { return SLOT_LABEL_ZH[slot] || slot; }
const STAT_LABEL_ZH = {
  atk: '攻擊力', matk: '魔法攻擊力', def: '防禦力', hp: '氣血上限', mp: '真力上限',
  critRatePct: '會心率', hpRegenPct: '氣血回復', atkPct: '攻擊力%', matkPct: '魔攻%', defPct: '防禦%', hpPct: '氣血%',
};
function statLabelZh(key) { return STAT_LABEL_ZH[key] || key; }
function statsText(stats) {
  return Object.entries(stats || {}).map(([k, v]) => `${statLabelZh(k)}+${v}`).join('、');
}
function classNameZh(classId) {
  return S.classes.find((c) => c.id === classId)?.name || classId;
}

function formatCountdown(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}分${s}秒`;
}
function bossStatusText(entry) {
  return entry.alive ? '存活(可遇)' : `重生中(還剩${formatCountdown(entry.respawnInSec)})`;
}

const S = {
  view: 'auth', // auth | chooseClass | hub | venture | inventory | shop | auction | party | duel | dead
  authMode: 'login',
  error: '',
  state: null,
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

async function refreshState() {
  const res = await api.getState();
  S.state = res.state;
  S.error = '';
  render();
}

function statBlock(stats) {
  return h('div', { class: 'stat-grid' }, [
    h('div', {}, [h('b', {}, 'STR '), String(stats.str)]),
    h('div', {}, [h('b', {}, 'DEX '), String(stats.dex)]),
    h('div', {}, [h('b', {}, 'INT '), String(stats.int)]),
    h('div', {}, [h('b', {}, 'LUK '), String(stats.luk)]),
    h('div', {}, [h('b', {}, '物攻 '), String(stats.atk)]),
    h('div', {}, [h('b', {}, '魔攻 '), String(stats.matk)]),
    h('div', {}, [h('b', {}, '防禦 '), String(stats.def)]),
    h('div', {}, [h('b', {}, '會心 '), `${Math.round(stats.critRate * 100)}%`]),
  ]);
}

function topBar() {
  const s = S.state;
  const hpPct = Math.round((s.hp / s.maxHp) * 100);
  const mpPct = Math.round((s.mp / s.maxMp) * 100);
  return h('div', { class: 'panel' }, [
    h('div', { class: 'top-bar' }, [
      h('div', {}, [
        h('h2', {}, `${S.username || ''} · ${s.className} · Lv.${s.level}`),
        h('div', { class: 'hint' }, `經驗 ${s.exp}/${s.expNeeded} ・ 金幣 ${s.gold}${s.statPoints > 0 ? ` ・ 可配點 ${s.statPoints}` : ''}`),
      ]),
      h('div', { style: 'min-width:200px' }, [
        h('div', { class: 'bar-bg' }, [h('div', { class: 'bar-fill hp', style: `width:${hpPct}%` }), h('div', { class: 'bar-label' }, `氣血 ${s.hp}/${s.maxHp}`)]),
        h('div', { class: 'bar-bg', style: 'margin-top:4px;' }, [h('div', { class: 'bar-fill mp', style: `width:${mpPct}%` }), h('div', { class: 'bar-label' }, `真力 ${s.mp}/${s.maxMp}`)]),
      ]),
    ]),
    statBlock(s.stats),
    h('div', { class: 'nav-tabs' }, [
      navBtn('hub', '城鎮'),
      navBtn('inventory', '裝備'),
      navBtn('auction', '交易所'),
      navBtn('party', '組隊懸賞'),
      navBtn('duel', '決鬥'),
      h('button', { class: 'btn', onclick: doLogout }, '登出'),
    ]),
  ]);
}

function navBtn(view, label) {
  return h('button', {
    class: `btn${S.view === view ? ' active' : ''}`,
    onclick: () => { if (view === 'auction') { openAuction(); } else { S.view = view; render(); } },
  }, label);
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
  app.innerHTML = '';
  app.appendChild(box);
}

// ---- 選擇職業 ----
function renderChooseClass() {
  const box = h('div', { class: 'panel' }, [
    h('h1', {}, '選擇職業'),
    h('p', { class: 'hint' }, '每個職業都有 4 招固定技能:基本攻擊、範圍技能、BUFF技能、光環(被動)。'),
    ...S.classes.map((cls) =>
      h('div', {
        class: 'system-card',
        onclick: async () => {
          await api.chooseClass(cls.id);
          await enterGame();
        },
      }, [
        h('h3', {}, cls.name),
        h('div', { class: 'tagline' }, cls.tagline),
        h('div', { class: 'hint', style: 'margin:6px 0;color:#c9a227;' }, `配點建議:${cls.buildGuide}`),
        h('div', {}, Object.values(cls.skills).map((sk) => h('div', { class: 'hint' }, `【Lv.${sk.unlockLevel}】${sk.name}${sk.type === 'aura' ? '(被動)' : ''} — ${sk.desc}`))),
      ])
    ),
  ]);
  app.innerHTML = '';
  app.appendChild(box);
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
  app.innerHTML = '';
  app.appendChild(box);
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
    statRow('str', 'STR 力量'),
    statRow('dex', 'DEX 敏捷'),
    statRow('int', 'INT 智力'),
    statRow('luk', 'LUK 幸運'),
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
  const wrap = document.createElement('div');
  wrap.appendChild(topBar());
  const s = S.state;

  if (s.statPoints > 0) wrap.appendChild(renderStatAllocator());

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
      }, `使用${p.name}(x${p.count})`)
    ),
    s.potions.every((p) => p.count === 0) ? h('div', { class: 'hint' }, '身上沒有任何藥水,可到雜貨店購買。') : null,
  ]);

  // 技能一覽:先前技能只有戰鬥中才看得到,城鎮完全沒地方確認解鎖狀態,玩家升級後不知道去哪確認
  const SKILL_TYPE_LABEL = { single: '單體攻擊', aoe: '範圍攻擊', buff: 'BUFF', aura: '光環(被動)' };
  const skillList = [s.skills.basic, s.skills.aoe, s.skills.buff, s.skills.aura];
  const skillsPanel = h('div', { class: 'panel' }, [
    h('h3', {}, `技能(Lv.${s.level})`),
    ...skillList.map((sk) => {
      const unlocked = s.level >= sk.unlockLevel;
      return h('div', { class: 'item-card' }, [
        h('div', {}, `${unlocked ? '' : '🔒 '}${sk.name}(${SKILL_TYPE_LABEL[sk.type] || sk.type}${sk.mpCost != null ? `・MP${sk.mpCost}` : ''})`),
        h('div', { class: 'hint' }, unlocked ? sk.desc : `Lv.${sk.unlockLevel} 解鎖 — ${sk.desc}`),
      ]);
    }),
  ]);

  const shopsPanel = h('div', { class: 'panel' }, [
    h('h3', {}, '商店'),
    ...SHOP_ORDER.map((id) => h('button', { class: 'btn', onclick: () => openShop(id) }, SHOP_NAMES[id])),
  ]);

  const mapsPanel = h('div', { class: 'panel' }, [
    h('h3', {}, '闖蕩地圖(多關卡:戰鬥/採集/奇遇交錯,各有專屬小王與大王)'),
    h('div', { class: 'card-grid' }, s.maps.map((m) =>
      h('div', { class: 'item-card' }, [
        h('div', {}, `${m.name}(建議等級 Lv.${m.levelRange[0]}~${m.levelRange[1]},${m.minStages}~${m.maxStages}關)`),
        h('div', { class: 'hint' }, `小王「${m.bossStatus.miniBoss.name}」:${bossStatusText(m.bossStatus.miniBoss)}`),
        h('div', { class: 'hint' }, `大王「${m.bossStatus.boss.name}」:${bossStatusText(m.bossStatus.boss)}`),
        h('button', {
          class: 'btn primary',
          onclick: async () => { try { S.bossEncounterAck = false; await api.huntStart(m.id); await refreshState(); } catch (e) { S.error = e.message; render(); } },
        }, '出發闖蕩'),
      ])
    )),
  ]);

  // 左欄:歇息/藥水/技能/商店(操作與資訊類、較短);右欄:地圖列表/戰果/事蹟(內容較長)——並排顯示減少整頁滾動
  wrap.appendChild(h('div', { class: 'grid-2' }, [
    h('div', {}, [restPanel, potionPanel, skillsPanel, shopsPanel]),
    h('div', {}, [
      mapsPanel,
      S.lastHuntLines.length ? h('div', { class: 'panel' }, [h('h3', {}, '戰果'), ...S.lastHuntLines.map((l) => h('div', {}, l))]) : null,
      logPanel(),
    ]),
  ]));
  if (S.error) wrap.appendChild(h('div', { class: 'error-msg' }, S.error));
  app.innerHTML = '';
  app.appendChild(wrap);
}

// ---- 闖蕩中的畫面調度:依 activeCombat / activeVenture 決定顯示內容 ----
function renderVenture() {
  const wrap = document.createElement('div');
  wrap.appendChild(topBar());
  const s = S.state;

  if (s.activeCombat) {
    wrap.appendChild(renderVentureProgress());
    wrap.appendChild(s.activeCombat.isBossFight && !S.bossEncounterAck ? renderBossWarningPanel() : renderCombatPanel());
  } else if (s.activeVenture?.pendingLootChoice) {
    wrap.appendChild(renderVentureProgress());
    wrap.appendChild(renderLootChoicePanel());
  } else if (s.activeVenture) {
    wrap.appendChild(renderVentureProgress());
    wrap.appendChild(renderVentureStagePanel());
  }
  if (S.error) wrap.appendChild(h('div', { class: 'error-msg' }, S.error));
  app.innerHTML = '';
  app.appendChild(wrap);
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
      h('button', { class: 'btn', onclick: () => doCombatAction('potion', { potionId: p.id }) }, `使用${p.name}(x${p.count})`)
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
    h('h3', c.isBossFight ? { style: 'color:#ef4444;' } : {}, c.isBossFight ? `⚠ ${c.bossKind === 'boss' ? '大王' : '小王'}戰!` : '遭遇戰!'),
    ...c.enemies.map((e, idx) => {
      const pct = Math.round((e.hp / e.maxHp) * 100);
      return h('div', { style: 'margin-bottom:6px;' }, [
        h('div', { class: 'bar-bg' }, [h('div', { class: 'bar-fill enemy', style: `width:${pct}%` }), h('div', { class: 'bar-label' }, `${e.name}(Lv.${e.level}) ${e.hp}/${e.maxHp}`)]),
      ]);
    }),
    h('div', { style: 'height:8px' }),
    h('div', { class: 'bar-bg' }, [h('div', { class: 'bar-fill hp', style: `width:${playerPct}%` }), h('div', { class: 'bar-label' }, `你 ${c.playerHp}/${c.playerMaxHp}`)]),
    h('div', { class: 'bar-bg', style: 'margin-top:4px;' }, [h('div', { class: 'bar-fill mp', style: `width:${mpPct}%` }), h('div', { class: 'bar-label' }, `真力 ${c.playerMp}/${c.playerMaxMp}`)]),
    h('div', {
      class: 'log-list',
      style: 'margin-top:12px;',
    }, c.log.map((l) => h('div', { class: l.includes('⚠') ? 'log-telegraph' : l.includes('💥') ? 'log-impact' : '' }, l))),

    // 技能欄:分排顯示——第一排單體攻擊、第二排範圍技能、第三排BUFF、第四排防禦,不要全部擠在同一排
    h('h3', { style: 'margin-top:14px;font-size:15px;' }, '⚔ 技能'),
    h('p', { class: 'hint', style: 'margin:2px 0 6px;' }, '傷害為未扣敵方防禦、未計會心的預估區間,實際命中會依對象浮動。看到⚠警示代表敵人正在蓄力,考慮這回合防禦!'),
    h('div', { class: 'skill-bar', style: 'flex-direction:column;align-items:stretch;' }, [
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
          ? h('button', { class: 'skill-btn', title: `${skills.aoe.desc}(預估未扣敵方防禦)`, onclick: () => doCombatAction('aoe') }, `${skills.aoe.name}(MP${skills.aoe.mpCost}, 每敵${estimateSkillDamage(skills.aoe)})`)
          : h('button', { class: 'skill-btn locked', disabled: true }, `🔒${skills.aoe.name}(Lv.${skills.aoe.unlockLevel})`),
      ]),
      h('div', { class: 'skill-row' }, [
        h('span', { class: 'skill-row-label' }, 'BUFF'),
        level >= skills.buff.unlockLevel
          ? h('button', { class: 'skill-btn', title: skills.buff.desc, onclick: () => doCombatAction('buff') }, `${skills.buff.name}(MP${skills.buff.mpCost})`)
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
        h('button', { class: 'btn', onclick: () => doCombatAction('potion', { potionId: p.id }) }, `使用${p.name}(x${p.count})`)
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
    h('div', { class: 'log-list' }, (S.state.log || []).map((l) => h('div', {}, l.text))),
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

// itemLabel 回傳可混合字串與DOM節點的陣列(而非單純字串),才能插入有顏色的品質標籤;
// 呼叫端一律用陣列形式當作 h() 的 children,不要用樣板字串插值(那樣會把DOM節點轉成無意義文字)。
function itemLabel(item) {
  const enhanceText = item.enhanceLevel > 0 ? ` +${item.enhanceLevel}` : '';
  const q = rollQualityInfo(item.rollQuality);
  return [
    `${item.name}${enhanceText}(${itemTierLabel(item.tier)}${item.classType ? `・${classNameZh(item.classType)}` : ''})`,
    ' ',
    h('span', { class: q.className }, `[${q.label}]`),
    ` Lv${item.itemLevel} — ${statsText(item.stats)}`,
  ];
}

const POTENTIAL_TIER_LABEL = { rare: '稀有', epic: '史詩', legendary: '傳說' };
const POTENTIAL_TIER_COLOR = { rare: '#a855f7', epic: '#3b82f6', legendary: '#f59e0b' };
function potentialLine(item) {
  if (!item.potential) return null;
  const pct = (v) => `${Math.round(v * 1000) / 10}%`;
  const text = item.potential.lines.map((l) => `${l.label}+${pct(l.value)}`).join('、');
  return h('div', { style: `color:${POTENTIAL_TIER_COLOR[item.potential.tier]};font-size:13px;` }, `【${POTENTIAL_TIER_LABEL[item.potential.tier]}潛能】${text}`);
}

// 強化(卷軸)機率表,須與後端 enhanceEngine.js 的 ENHANCE_SUCCESS_RATE 完全一致,純供前端顯示預估成功率用
const ENHANCE_SUCCESS_RATE = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.25, 0.2, 0.15];
const ENHANCE_MAX_LEVEL = 10;
function slotToScrollId(slot) {
  if (slot === 'weapon') return 'scroll_weapon';
  if (slot === 'armor') return 'scroll_armor';
  return 'scroll_accessory';
}

// 強化+洗潛能按鈕:裝備欄跟背包都會用到,itemId 帶入後端會自動找出該裝備目前在哪個位置
function renderEnhanceControls(item) {
  const consumables = S.state.consumables || [];
  const scrollId = slotToScrollId(item.slot);
  const scroll = consumables.find((c) => c.id === scrollId);
  const cube = consumables.find((c) => c.id === 'cube_potential');
  const level = item.enhanceLevel || 0;
  const rate = level < ENHANCE_MAX_LEVEL ? ENHANCE_SUCCESS_RATE[level] : 0;
  return h('div', { style: 'margin-top:4px;' }, [
    potentialLine(item),
    level < ENHANCE_MAX_LEVEL
      ? h('button', {
          class: 'btn',
          title: `消耗1張${scroll?.name || ''},目前成功率約${Math.round(rate * 100)}%`,
          onclick: async () => {
            try {
              const r = await api.enhanceItem(item.id, scrollId);
              S.error = r.success ? `強化成功!提升至 +${r.item.enhanceLevel}` : '強化失敗,卷軸已耗盡。';
              S.state = r.state;
              render();
            } catch (e) { S.error = e.message; render(); }
          },
        }, `強化(+${level}→+${level + 1},約${Math.round(rate * 100)}%,需${scroll?.name || '卷軸'}x1,持有${scroll?.count || 0})`)
      : h('span', { class: 'hint' }, `已達強化上限 +${ENHANCE_MAX_LEVEL}`),
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
  ]);
}

const MATERIAL_KIND_LABEL = { junk: '雜物(雜貨店回收)', material: '製作素材', rare_material: '稀有素材(小王/大王掉落)' };

function renderInventory() {
  const wrap = document.createElement('div');
  wrap.appendChild(topBar());
  const s = S.state;

  const equipPanel = h('div', { class: 'panel' }, [
    h('h3', {}, '裝備欄'),
    h('p', { class: 'hint' }, '武器/防具各1格;飾品(戒指/護符/項鍊/徽章)共2格,兩格用途相同、可任意放置,不分種類。'),
    ...Object.entries(s.equipment).map(([slot, item]) =>
      h('div', { class: 'item-card' }, [
        h('div', {}, item ? [`【${slotLabelZh(slot)}】 `, ...itemLabel(item)] : `【${slotLabelZh(slot)}】(空)`),
        item ? h('button', { class: 'btn', onclick: async () => { await api.unequip(slot); await refreshInvState(); } }, '卸下') : null,
        item ? renderEnhanceControls(item) : null,
      ])
    ),
  ]);

  // 材料/雜物清單:先前只有雜貨店能看到「雜物」,製作素材/稀有素材完全沒地方顯示,身上到底有什麼完全看不到
  const materialGroups = { junk: [], material: [], rare_material: [] };
  s.materials.forEach((m) => { if (materialGroups[m.kind]) materialGroups[m.kind].push(m); });
  const materialsPanel = h('div', { class: 'panel' }, [
    h('h3', {}, '材料 / 雜物'),
    ...Object.entries(materialGroups).flatMap(([kind, list]) =>
      list.length === 0 ? [] : [
        h('div', { class: 'hint', style: 'margin-top:8px;' }, MATERIAL_KIND_LABEL[kind]),
        h('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;' }, list.map((m) => h('span', { class: 'item-card', style: 'padding:4px 8px;margin:0;' }, `${m.name} x${m.count}`))),
      ]
    ),
    s.materials.length === 0 ? h('div', { class: 'hint' }, '身上沒有任何材料或雜物,去闖蕩狩獵/採集吧。') : null,
  ]);

  const invPanel = h('div', { class: 'panel' }, [
    h('h3', {}, '背包(裝備)'),
    h('div', { class: 'card-grid' }, s.inventory.map((item) => {
      // 飾品是通用格(accessory),裝備時要讓玩家自己選放飾品一還是飾品二;
      // 武器/防具(或舊資料殘留的 accessory1/accessory2)維持單一「裝備」按鈕。
      const equipButtons = item.slot === 'accessory'
        ? [
            h('button', { class: 'btn', onclick: async () => { try { await api.equip(item.id, 'accessory1'); await refreshInvState(); } catch (e) { S.error = e.message; render(); } } }, '裝備至飾品一'),
            h('button', { class: 'btn', onclick: async () => { try { await api.equip(item.id, 'accessory2'); await refreshInvState(); } catch (e) { S.error = e.message; render(); } } }, '裝備至飾品二'),
          ]
        : [h('button', { class: 'btn', onclick: async () => { try { await api.equip(item.id); await refreshInvState(); } catch (e) { S.error = e.message; render(); } } }, '裝備')];
      return h('div', { class: `item-card rarity-${item.tier}` }, [
        h('div', {}, itemLabel(item)),
        h('div', {}, [
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
        ]),
        renderEnhanceControls(item),
      ]);
    })),
    s.inventory.length === 0 ? h('div', { class: 'hint' }, '背包空空如也,去闖蕩累積裝備吧。') : null,
  ]);

  // 左欄:裝備欄+材料(較短、資訊型);右欄:背包裝備清單(項目多,並排能少滾很多)
  wrap.appendChild(h('div', { class: 'grid-2' }, [
    h('div', {}, [equipPanel, materialsPanel]),
    h('div', {}, [invPanel]),
  ]));
  if (S.error) wrap.appendChild(h('div', { class: 'error-msg' }, S.error));
  app.innerHTML = '';
  app.appendChild(wrap);
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
  try {
    S.shopData = await api.getShop(shopId);
  } catch (e) {
    S.error = e.message;
  }
  S.view = 'shop';
  render();
}

function renderShop() {
  const wrap = document.createElement('div');
  wrap.appendChild(topBar());
  const shopId = S.shopId;
  const data = S.shopData;

  const panel = h('div', { class: 'panel' }, [
    h('h3', {}, `${SHOP_NAMES[shopId]}`),
    h('p', { class: 'hint' }, data?.shop?.desc || ''),
  ]);

  if (shopId === 'general' && data) {
    panel.appendChild(h('h3', {}, '藥水'));
    panel.appendChild(h('div', { class: 'card-grid' }, data.market.potions.map((p) =>
      h('div', { class: 'item-card' }, [
        h('div', {}, `${p.id.includes('hp') ? '體力' : '真力'}藥水 — 售價 ${p.effectivePrice}${p.discounted ? `(特惠中,原價${p.fullPrice},特惠庫存${p.bonusStock})` : ''}`),
        h('button', {
          class: 'btn primary',
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
      ])
    )));

    panel.appendChild(h('h3', { style: 'margin-top:14px;' }, '強化卷軸 / 潛能方塊(用於背包/裝備欄畫面強化裝備)'));
    panel.appendChild(h('div', { class: 'card-grid' }, S.state.consumables.map((c) =>
      h('div', { class: 'item-card' }, [
        h('div', {}, `${c.name} — 售價 ${c.price} 金幣(持有 ${c.count})`),
        h('div', { class: 'hint' }, c.kind === 'scroll' ? `適用部位:${c.appliesTo === 'weapon' ? '武器' : c.appliesTo === 'armor' ? '防具' : '飾品'}` : '可用於任何裝備,洗鍊隨機百分比詞條'),
        h('button', {
          class: 'btn primary',
          onclick: async () => {
            try {
              const r = await api.buyEnhanceItem(c.id, 1);
              S.error = `購買成功,花費 ${r.cost} 金幣`;
              S.state = r.state;
              render();
            } catch (e) { S.error = e.message; render(); }
          },
        }, '購買 x1'),
      ])
    )));

    panel.appendChild(h('h3', { style: 'margin-top:14px;' }, '回收雜物/素材(依全服庫存量動態計價;製作素材要留著做裝備還是賣錢由你決定)'));
    const mySellables = S.state.materials.filter((m) => m.kind === 'junk' || m.kind === 'material' || m.kind === 'rare_material');
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
    panel.appendChild(h('div', { class: 'card-grid' }, mySellables.map((m) => {
      const marketInfo = data.market.sellables.find((j) => j.id === m.id);
      const qtyInputId = `sell-qty-${m.id}`;
      return h('div', { class: 'item-card' }, [
        h('div', {}, `${m.name}${m.kind !== 'junk' ? `(${m.kind === 'rare_material' ? '稀有素材' : '製作素材'})` : ''} x${m.count}(單價 ${marketInfo?.currentPrice ?? '?'})`),
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
  } else if (data) {
    const TIER_COLOR = { common: '#b0b0b0', rare: '#a855f7', epic: '#f59e0b' };
    panel.appendChild(h('h3', {}, '裝備製作(僅此商店可製作,無法透過打怪取得;不設等級門檻,材料+金幣足夠即可製作)'));
    ['common', 'rare', 'epic'].forEach((tier) => {
      const tierRecipes = (data.recipes || []).filter((r) => r.tier === tier);
      if (tierRecipes.length === 0) return;
      panel.appendChild(h('div', { style: `color:${TIER_COLOR[tier]};font-weight:bold;margin-top:10px;` }, `【${tierRecipes[0].tierLabel}】`));
      panel.appendChild(h('div', { class: 'card-grid' }, tierRecipes.map((r) => {
        const canAfford = r.materialsDetail.every((d) => d.have >= d.need);
        const matText = r.materialsDetail.map((d) => `${d.name} ${d.have}/${d.need}`).join('、');
        return h('div', { class: `item-card rarity-${tier}` }, [
          h('div', {}, `${r.name}(${r.gold} 金幣, `),
          h('span', { style: canAfford ? '' : 'color:#ef4444;' }, matText),
          h('span', {}, ')'),
          h('div', { class: 'hint' }, `屬性:${statsText(r.statBonus)}`),
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
        ]);
      })));
    });
  }

  wrap.appendChild(panel);
  if (S.error) wrap.appendChild(h('div', { class: 'error-msg' }, S.error));
  wrap.appendChild(h('button', { class: 'btn', onclick: () => { S.view = 'hub'; render(); } }, '返回城鎮'));
  app.innerHTML = '';
  app.appendChild(wrap);
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

function renderAuction() {
  const wrap = document.createElement('div');
  wrap.appendChild(topBar());

  const panel = h('div', { class: 'panel' }, [
    h('h3', {}, '交易所'),
    h('p', { class: 'hint' }, '玩家互相上架/購買裝備,上架收取開價 5% 手續費,24 小時後自動下架。'),
    h('div', { class: 'card-grid' }, S.auctionListings.map((l) =>
      h('div', { class: 'item-card' }, [
        h('div', {}, `${l.item.name}(${itemTierLabel(l.item.tier)}) Lv${l.item.itemLevel} — 賣家:${l.sellerName} — 開價 ${l.price} 金幣`),
        l.sellerName === S.username
          ? h('button', { class: 'btn danger', onclick: async () => { try { const r = await api.cancelListing(l.id); S.state = r.state; await openAuction(); } catch (e) { S.error = e.message; render(); } } }, '取消上架')
          : h('button', { class: 'btn primary', onclick: async () => { try { const r = await api.buyListing(l.id); S.state = r.state; S.error = '購買成功!'; await openAuction(); } catch (e) { S.error = e.message; render(); } } }, '購買'),
      ])
    )),
    S.auctionListings.length === 0 ? h('div', { class: 'hint' }, '目前沒有任何上架物品。') : null,
  ]);
  wrap.appendChild(panel);
  if (S.error) wrap.appendChild(h('div', { class: 'error-msg' }, S.error));
  app.innerHTML = '';
  app.appendChild(wrap);
}

// ---- 組隊懸賞畫面 ----
function renderParty() {
  const wrap = document.createElement('div');
  wrap.appendChild(topBar());
  const sock = connectSocket();
  bindPartySocket(sock);

  const panel = h('div', { class: 'panel' }, [
    h('h3', {}, '組隊懸賞'),
    h('p', { class: 'hint' }, '選定一張地圖的大王,邀請同伴即時共鬥吧。'),
    !S.party ? h('div', {}, [
      h('button', { class: 'btn primary', onclick: () => sock.emit('party:create') }, '建立隊伍'),
      h('input', { type: 'text', id: 'p-code', placeholder: '輸入隊伍代碼' }),
      h('button', { class: 'btn', onclick: () => sock.emit('party:join', { code: document.getElementById('p-code').value.trim().toUpperCase() }) }, '加入隊伍'),
    ]) : h('div', {}, [
      h('div', {}, `隊伍代碼:${S.party.code}`),
      h('div', {}, `成員:${S.party.members.map((m) => m.username).join('、')}`),
      !S.party.combat ? h('div', {}, (S.state.maps || []).map((m) =>
        h('button', { class: 'btn primary', onclick: () => sock.emit('party:start-bounty', { mapId: m.id }) }, `迎戰「${m.name}」大王`)
      )) : null,
      h('button', { class: 'btn', onclick: () => { sock.emit('party:leave'); S.party = null; render(); } }, '離隊'),
    ]),
    S.party?.combat ? renderPartyCombat(S.party.combat) : null,
  ]);
  wrap.appendChild(panel);
  app.innerHTML = '';
  app.appendChild(wrap);
}

function renderPartyCombat(combat) {
  const sock = getSocket();
  const enemyPct = Math.round((combat.enemyHp / combat.enemyMaxHp) * 100);
  return h('div', { style: 'margin-top:12px;' }, [
    h('div', { class: 'bar-bg' }, [h('div', { class: 'bar-fill enemy', style: `width:${enemyPct}%` }), h('div', { class: 'bar-label' }, `${combat.enemyName} ${combat.enemyHp}/${combat.enemyMaxHp}`)]),
    ...Object.entries(combat.members).map(([uid, m]) => {
      const pct = Math.round((m.hp / m.maxHp) * 100);
      return h('div', { class: 'bar-bg', style: 'margin-top:4px;' }, [h('div', { class: 'bar-fill hp', style: `width:${pct}%` }), h('div', { class: 'bar-label' }, `${m.username} ${m.hp}/${m.maxHp}`)]);
    }),
    h('div', { class: 'log-list', style: 'margin-top:10px;' }, combat.log.map((l) => h('div', {}, l))),
    !combat.ended ? h('button', { class: 'btn primary', onclick: () => sock.emit('party:attack') }, '出手攻擊') : h('div', { class: 'hint' }, combat.ended === 'win' ? '此戰告捷!' : '此戰落敗。'),
  ]);
}

function bindPartySocket(sock) {
  if (sock._partyBound) return;
  sock._partyBound = true;
  sock.on('party:joined', (data) => { S.party = { ...data, combat: S.party?.combat || null }; render(); });
  sock.on('party:combat-update', (data) => { if (S.party) { S.party.combat = data.combat; render(); } });
  sock.on('party:error', (data) => { S.error = data.error; render(); });
}

// ---- 決鬥畫面 ----
function renderDuel() {
  const wrap = document.createElement('div');
  wrap.appendChild(topBar());
  const sock = connectSocket();
  bindDuelSocket(sock);

  const panel = h('div', { class: 'panel' }, [
    h('h3', {}, '決鬥'),
    h('p', { class: 'hint' }, '論勝負:切磋較量,點到為止。決生死:立下生死戰約,敗者帳號永久刪除,唯有勝者能得大量經驗。'),
    !S.duel ? h('div', {}, [
      h('input', { type: 'text', id: 'd-target', placeholder: '對方帳號' }),
      h('button', { class: 'btn', onclick: () => sock.emit('duel:challenge', { targetUsername: document.getElementById('d-target').value.trim(), stakes: 'win' }) }, '下戰帖(論勝負)'),
      h('button', { class: 'btn danger', onclick: () => {
        if (confirm('此為生死決鬥,敗者帳號將被永久刪除,確定送出戰帖?')) {
          sock.emit('duel:challenge', { targetUsername: document.getElementById('d-target').value.trim(), stakes: 'death' });
        }
      } }, '下戰帖(決生死)'),
      S.duelPending ? h('div', { class: 'panel', style: 'margin-top:10px;' }, [
        h('div', {}, `${S.duelPending.challengerName} 向你下了${S.duelPending.stakes === 'death' ? '生死' : '較量'}戰帖!`),
        h('button', { class: 'btn primary', onclick: () => sock.emit('duel:accept') }, '應戰'),
        h('button', { class: 'btn', onclick: () => { sock.emit('duel:decline'); S.duelPending = null; render(); } }, '婉拒'),
      ]) : null,
    ]) : renderDuelCombat(),
    S.duelMsg ? h('div', { class: 'error-msg' }, S.duelMsg) : null,
  ]);
  wrap.appendChild(panel);
  app.innerHTML = '';
  app.appendChild(wrap);
}

function renderDuelCombat() {
  const sock = getSocket();
  const d = S.duel;
  const aPct = Math.round((d.a.hp / d.a.maxHp) * 100);
  const bPct = Math.round((d.b.hp / d.b.maxHp) * 100);
  return h('div', {}, [
    h('div', { class: 'bar-bg' }, [h('div', { class: 'bar-fill hp', style: `width:${aPct}%` }), h('div', { class: 'bar-label' }, `${d.a.username} ${d.a.hp}/${d.a.maxHp}`)]),
    h('div', { class: 'bar-bg', style: 'margin-top:4px;' }, [h('div', { class: 'bar-fill enemy', style: `width:${bPct}%` }), h('div', { class: 'bar-label' }, `${d.b.username} ${d.b.hp}/${d.b.maxHp}`)]),
    h('div', { class: 'log-list', style: 'margin-top:10px;' }, d.log.map((l) => h('div', {}, l))),
    !d.ended ? h('button', { class: 'btn primary', onclick: () => sock.emit('duel:attack') }, '出手') : h('div', { class: 'hint' }, '此戰已分勝負。'),
  ]);
}

function bindDuelSocket(sock) {
  if (sock._duelBound) return;
  sock._duelBound = true;
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
  const res = await api.getState();
  S.state = res.state;
  if (!S.state.classChosen) {
    const clsRes = await api.getClasses();
    S.classes = clsRes.classes;
    S.view = 'chooseClass';
  } else {
    S.view = 'hub';
  }
  render();
}

function render() {
  if (S.view === 'auth') return renderAuth();
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
  if (getToken()) {
    try {
      await enterGame();
      return;
    } catch {
      clearToken();
    }
  }
  render();
})();
