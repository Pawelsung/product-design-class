/* 共用：連線、工具函式、各頁的統計 */
const SB_URL = "https://zpvaccvsrjzoxaiehxiw.supabase.co";
const SB_KEY = "sb_publishable_SZQdb13HRuZPYzBvQTN1ow_YWJtfgUN";

async function rpc(fn, args) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: SB_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(args || {}),
      signal: ctrl.signal
    });
    const txt = await r.text();
    let body; try { body = JSON.parse(txt); } catch (e) { body = txt; }
    if (!r.ok) {
      const msg = (body && body.message) || String(body);
      return { ok: false, error: /TEACHER_AUTH/.test(msg) ? "TEACHER_AUTH" : /NOT_ACTIVE/.test(msg) ? "NOT_ACTIVE" : /NO_SESSION/.test(msg) ? "NO_SESSION" : "SERVER", detail: msg };
    }
    return body;
  } catch (e) {
    return { ok: false, error: "NETWORK" };
  } finally { clearTimeout(t); }
}

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};
function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "x" + Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}
function todayZh(d) {
  d = d || new Date(Clock.now());
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日（${"日一二三四五六"[d.getDay()]}）`;
}
function titleBreak(t) { return esc(t).replace(/，/g, "，<br>"); }
/* 每一節的首頁插圖卡（學生平板用） */
function coverCard(lesson, label, extra) {
  const L = LESSONS[lesson];
  const first = L ? L.pages[0] : null;
  return `<section class="cover-card">
    <div class="cv-row"><span class="cv-chip">${esc(L ? L.chip : "產品設計的流程")}</span><span class="cv-date">${todayZh()}</span></div>
    <h1 class="cv-title">${first ? titleBreak(first.title) : "產品設計的流程"}</h1>
    <div class="cv-meta">${esc(label || "")}${label && L ? "｜" : ""}${L ? esc(L.book) : ""}</div>
    ${L && ART[lesson] ? `<div class="cv-art">${ART[lesson]}</div>` : ""}
    ${extra || ""}
  </section>`;
}
function fmtClock(ms) { if (!ms) return ""; const d = new Date(ms); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); }
function fmtLeft(sec) { sec = Math.max(0, Math.ceil(sec)); return String(Math.floor(sec / 60)).padStart(2, "0") + ":" + String(sec % 60).padStart(2, "0"); }
function fmtSec(ms) { return (Math.round(ms / 100) / 10).toFixed(1) + " 秒"; }
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/* 伺服器時間：用輪詢回來的 now 校正 */
const Clock = {
  offset: 0,
  sync(serverNow) { if (serverNow) this.offset = serverNow - Date.now(); },
  now() { return Date.now() + this.offset; }
};

/* 可重現的亂數順序（同一組每台平板看到的順序一樣） */
function seededShuffle(arr, seedStr) {
  let h = 2166136261;
  for (const ch of seedStr) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
    const j = Math.abs(h) % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* 分組 */
function groupSeats(groupsMap) {
  const G = {};
  Object.entries(groupsMap || {}).forEach(([seat, g]) => { (G[g] = G[g] || []).push(+seat); });
  Object.values(G).forEach(a => a.sort((x, y) => x - y));
  return G;
}
function groupIds(groupsMap) { return Object.keys(groupSeats(groupsMap)).map(Number).sort((a, b) => a - b); }
function defaultGroups(seats, sizes) {
  const m = {}; let s = 1;
  sizes.forEach((n, i) => { for (let k = 0; k < n && s <= seats; k++) m[s++] = i + 1; });
  while (s <= seats) m[s++] = sizes.length;
  return m;
}
/* 依組內座號輪流：AI 操作員一節一人；送出代表依活動順序輪流，跳過本節 AI 操作員 */
function buildRoles(groupsMap, lesson) {
  const L = LESSONS[lesson], G = groupSeats(groupsMap), reps = {}, ai = {};
  Object.entries(G).forEach(([g, S]) => {
    const n = S.length; let aiSeat = null, ptr = 0;
    if (L.usesAI && n) { const k = (lesson - 1) % n; aiSeat = S[k]; ai[g] = aiSeat; ptr = k + 1; }
    L.slots.forEach(slot => {
      let s, guard = 0;
      do { s = S[ptr % n]; ptr++; guard++; } while (s === aiSeat && n > 1 && guard < 20);
      (reps[slot] = reps[slot] || {})[g] = s;
    });
  });
  return { reps, ai };
}

function pstate(state, id) { return (state && state.pages && state.pages[id]) || {}; }

/* 回應整理 */
function resp(list, page, owner) { return (list || []).find(r => r.page === page && r.owner === owner); }
function personResponses(list, page) { return (list || []).filter(r => r.page === page && r.owner[0] === "p"); }
function groupResponse(list, page, g) { return resp(list, page, "g" + g); }

/* 1-5 排名規則：第一次就答對 → 依用時；第二次才答對 → 依用時；兩次都沒對不排名 */
function sortSummary(list, groupsMap) {
  const out = groupIds(groupsMap).map(g => {
    const r = groupResponse(list, "1-5", g);
    const att = (r && r.attempts) || [];
    const okIdx = att.findIndex(a => a.orderOk && a.descOk);
    return { g, att, okTry: okIdx >= 0 ? okIdx + 1 : 0, ms: okIdx >= 0 ? att[okIdx].ms : null, last: att[att.length - 1] || null };
  });
  const ranked = out.filter(x => x.okTry).sort((a, b) => a.okTry - b.okTry || a.ms - b.ms);
  ranked.forEach((x, i) => x.rank = i + 1);
  return out;
}

function voteTally(list, page, options) {
  const c = options.map(() => 0); let n = 0;
  personResponses(list, page).forEach(r => { const v = r.sent && r.sent.choice; const i = options.indexOf(v); if (i >= 0) { c[i]++; n++; } });
  return { counts: c, n };
}

/* 2-2 手套挑戰：以組為單位，組內有一人選「卡住了」或「時間到沒做完」就算卡住 */
function gloveStats(list, groupsMap) {
  const stats = { 1: [0, 0, 0], 2: [0, 0, 0] }, groupsStuck = { 1: {}, 2: {} };
  const G = groupSeats(groupsMap);
  Object.entries(G).forEach(([g, seats]) => {
    [1, 2].forEach(round => {
      GLOVE_ACTIONS.forEach((_, ai) => {
        const stuck = seats.some(s => {
          const r = resp(list, "2-2", "p" + s); const v = r && r.sent && r.sent["r" + round] && r.sent["r" + round]["a" + ai];
          return v === "卡住了" || v === "時間到沒做完";
        });
        if (stuck) { stats[round][ai]++; (groupsStuck[round][ai] = groupsStuck[round][ai] || []).push(+g); }
      });
    });
  });
  return { stats, groupsStuck, total: Object.keys(G).length };
}

function voiceTexts(list) {
  return personResponses(list, "2-6").filter(r => !r.hidden && r.sent).map(r => (r.sent.a || []).filter(Boolean));
}

function parseAILines(raw) {
  return String(raw || "").split(/\r?\n/).map(s => s
    .replace(/\*\*|__|`/g, "")
    .replace(/^\s*#+\s*/, "")
    .replace(/^\s*(?:[-*•·・●○◦▪]+|\(?\d+[.)、．]|\d+\s*[.)、．]|[（(]\d+[）)])\s*/, "")
    .trim()).filter(s => s.length > 0);
}

function fillProduct(text, product) { return String(text).replace(/〔產品〕/g, product || "你們的產品"); }

function csvEscape(v) { const s = v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }

// 只在視窗內呈現迷因的其中一欄，同時提供該欄的替代文字。
function panelImage(p, state) {
  const side = state.panel === 1 ? 1 : 0;
  return `<figure class="meme-panel"><div class="meme-crop side-${side}"><img src="${IMAGES[p.img]}" alt="${esc(p.panels[side])}"></div><figcaption>${esc(p.panels[side])}（${side + 1}/2）</figcaption></figure>`;
}
function gloveCanPublish(x) { return x.round === 2 && x.phase === "r2" && x.ended && !x.open; }
