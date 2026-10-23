/* 老師手機（控制台）與投影畫面 */
const tq = new URLSearchParams(location.search);
const T = {
  token: LS.get("lesson-teacher-token", null),
  mode: tq.get("mode") === "screen" ? "screen" : "console",
  sid: tq.get("s") || null,
  phase: "login", tab: "class", msg: "",
  sessions: [], session: null, devices: [], responses: [], priv: null,
  net: true, pin: "", form: null, backupProduct: {}, busy: false
};
const app = document.getElementById("app");
if (T.mode === "screen") document.body.classList.add("screen");

const STUDENT_URL = () => new URL("index.html", location.href).href.split("?")[0];
const L = () => LESSONS[T.session.lesson];
const st = () => T.session.state || {};
const curP = () => pageById(T.session.lesson, st().page) || L().pages[0];
const PS = id => pstate(st(), id);
const groupsMap = () => T.session.groups || {};
const gids = () => groupIds(groupsMap());
const repOf = (slot, g) => T.session.reps && T.session.reps[slot] && T.session.reps[slot][g];
const aiOf = g => T.session.ai_ops && T.session.ai_ops[g];
const activeSeats = () => [...new Set(T.devices.filter(d => d.status === "active").map(d => d.seat))];
const studentLink = () => st().classKey ? STUDENT_URL() + "?k=" + encodeURIComponent(st().classKey) : STUDENT_URL() + "?c=" + T.session.code;
const productOf = g => (st().products && st().products[g]) || "";

/* ---------- 啟動 ---------- */
async function boot() {
  if (!T.token) { T.phase = "login"; render(); return; }
  if (T.sid) { T.phase = T.mode; await refresh(true); startPoll(); return; }
  await loadSessions();
}
async function loadSessions() {
  const r = await rpc("lesson_teacher_sessions", { p_token: T.token });
  if (r && r.error === "TEACHER_AUTH") { logout(); return; }
  T.sessions = Array.isArray(r) ? r : [];
  T.phase = "sessions"; render();
}
function logout() { LS.del("lesson-teacher-token"); T.token = null; T.phase = "login"; render(); }

let pollT = null;
function startPoll() { clearTimeout(pollT); pollT = setTimeout(async () => { await refresh(); startPoll(); }, document.hidden ? 4000 : 1000); }
async function refresh(withPrivate) {
  const r = await rpc("lesson_teacher_poll", { p_token: T.token, p_id: T.sid, p_with_private: !!withPrivate || !T.priv });
  if (!r || r.ok === false) {
    if (r && r.error === "TEACHER_AUTH") { logout(); return; }
    if (r && r.error === "NO_SESSION") { T.sid = null; await loadSessions(); return; }
    T.net = false; renderLive(); return;
  }
  T.net = true;
  Clock.sync(r.now);
  T.session = r.session; T.devices = r.devices || []; T.responses = r.responses || [];
  if (r.private) T.priv = r.private;
  render();
}

/* ---------- 寫入 ---------- */
async function patchState(fn) {
  if (T.busy) return false;
  T.busy = true;
  try {
    for (let i = 0; i < 3; i++) {
      const s = JSON.parse(JSON.stringify(T.session.state || {}));
      s.pages = s.pages || {};
      fn(s);
      const r = await rpc("lesson_teacher_update", { p_token: T.token, p_id: T.sid, p_rev: T.session.rev, p_state: s });
      if (r && r.ok) { T.session.state = s; T.session.rev = r.rev; render(true); return true; }
      if (r && r.error === "CONFLICT") { await refresh(); continue; }
      toast("沒有成功，請再按一次（" + (r && r.error || "網路") + "）"); return false;
    }
  } finally { T.busy = false; }
  return false;
}
function pg(s, id) { s.pages[id] = s.pages[id] || {}; return s.pages[id]; }
const act = {
  go: id => patchState(s => { s.page = id; }),
  open: id => patchState(s => { const x = pg(s, id); x.open = true; x.ended = false; x.openedAt = x.openedAt || Clock.now(); }),
  end: id => patchState(s => { const x = pg(s, id); x.open = false; x.ended = true; }),
  reopen: id => patchState(s => { const x = pg(s, id); x.open = true; x.ended = false; x.published = false; x.openedAt = x.openedAt || Clock.now(); }),
  publish: id => patchState(s => { const x = pg(s, id); if (id === "2-2" && !x.published && !gloveCanPublish(x)) return; x.published = !x.published; if (x.published) { x.open = false; x.ended = true; } }),
  step: (id, n) => patchState(s => { pg(s, id).step = n; }),
  timer: sec => patchState(s => { s.timer = sec ? { end: Clock.now() + sec * 1000, total: sec } : null; }),
  glove: phase => patchState(s => {
    const x = pg(s, "2-2"); x.published = false;
    if (phase === "r1") { x.open = true; x.ended = false; x.round = 1; x.phase = "r1"; s.timer = { end: Clock.now() + 45000, total: 45 }; }
    if (phase === "reset") { x.phase = "reset"; s.timer = { end: Clock.now() + 30000, total: 30 }; }
    if (phase === "r2") { x.open = true; x.ended = false; x.round = 2; x.phase = "r2"; s.timer = { end: Clock.now() + 45000, total: 45 }; }
  }),
  seg: n => patchState(s => { pg(s, "2-7").seg = n; }),
  hold: (g, id) => patchState(s => { s.hold = s.hold || {}; if (id) s.hold[g] = id; else delete s.hold[g]; }),
  focus: (id, g) => patchState(s => { const x = pg(s, id); x.focus = x.focus === g ? null : g; })
};
async function teacherWrite(page, owner, part, value, extra) {
  const r = await rpc("lesson_teacher_write", Object.assign({ p_token: T.token, p_id: T.sid, p_page: page, p_owner: owner, p_part: part, p_value: value, p_set_sent: false, p_hidden: null }, extra || {}));
  if (!r || !r.ok) toast("沒有成功，請再按一次"); await refresh();
}

/* ---------- 畫面 ---------- */
function isTyping() { const a = document.activeElement; return a && (a.tagName === "TEXTAREA" || (a.tagName === "INPUT" && /text|number|password/.test(a.type)) || a.tagName === "SELECT"); }
let lastHTML = "";
function render(force) {
  if (T.mode === "screen" && T.phase === "screen") {
    const html = screenView();
    if (html !== lastHTML) { app.innerHTML = html; lastHTML = html; }
    renderLive(); return;
  }
  if (!force && isTyping()) { renderLive(); return; }
  const html = T.phase === "login" ? loginView() : T.phase === "sessions" ? sessionsView() : consoleView();
  if (html === lastHTML && !force) { renderLive(); return; }
  const a = document.activeElement, id = a && a.id;
  const y = window.scrollY;
  app.innerHTML = html; lastHTML = html;
  window.scrollTo(0, y);
  if (id) { const n = document.getElementById(id); if (n) n.focus({ preventScroll: true }); }
  renderLive();
}
function renderLive() {
  const t = T.session && st().timer;
  document.querySelectorAll("[data-timer]").forEach(el => {
    if (!t || !t.end) { el.hidden = true; return; }
    const left = (t.end - Clock.now()) / 1000; el.hidden = left < -3; el.textContent = fmtLeft(left); el.classList.toggle("low", left <= 30);
  });
  const nb = document.getElementById("netbar"); if (nb) nb.hidden = T.net;
}
setInterval(renderLive, 500);
function toast(msg) { const d = document.createElement("div"); d.className = "toast"; d.textContent = msg; document.body.appendChild(d); setTimeout(() => d.remove(), 2600); }
const dis = ok => ok ? "" : "disabled";

/* 登入與課堂清單 */
function loginView() {
  return `<div class="t-wrap" style="padding-top:40px"><h1>老師登入</h1><p class="muted">產品設計的流程｜課堂網站</p>
    <input type="password" inputmode="numeric" id="pin" data-bind="pin" placeholder="老師 PIN" autocomplete="current-password">
    ${T.msg ? `<div class="banner bad">${esc(T.msg)}</div>` : ""}
    <button class="btn primary block" data-act="login">登入</button></div>`;
}
function sessionsView() {
  const f = T.form;
  let h = `<div class="t-head"><b>課堂網站</b><span class="spacer"></span><button class="btn ghost sm" style="color:#fff;border-color:rgba(255,255,255,.4)" data-act="logout">登出</button></div><div class="t-wrap">`;
  if (!f) {
    h += `<button class="btn primary block" data-act="newform">開新的一堂課</button>`;
    h += `<div class="t-sec"><h3>最近的課堂</h3><div class="t-list">${T.sessions.length ? T.sessions.map(s => `<div class="it"><span><b class="mono">${s.code}</b>　第 ${s.lesson} 節　${esc(s.label)}<br><span class="small muted">${new Date(s.created_at).toLocaleString("zh-TW")}${s.active ? "" : "・已結束"}</span></span>
      <span class="row"><a class="btn sm" href="?s=${s.id}">控制台</a><a class="btn sm ghost" href="?s=${s.id}&mode=screen" target="_blank" rel="noopener">投影</a><button class="btn sm ghost" data-act="archive" data-id="${s.id}">移除</button></span></div>`).join("") : `<p class="muted small">還沒有課堂。</p>`}</div></div>`;
  } else {
    const roster = f.groupsText;
    h += `<h2>開新的一堂課</h2>
      <div><label class="lab">節次</label><div class="pillset">${[1, 2].map(n => `<button data-act="flesson" data-v="${n}" aria-pressed="${f.lesson === n}">${esc(LESSONS[n].title)}</button>`).join("")}</div></div>
      <div><label class="lab" for="f-label">班級</label><input type="text" id="f-label" data-bind="form" data-k="label" value="${esc(f.label)}"></div>
      <div><label class="lab" for="f-key">班級代號（印在桌上的 QR code 會用到，同一班每節都用一樣的）</label><input type="text" id="f-key" data-bind="form" data-k="classKey" value="${esc(f.classKey)}"></div>
      <div><label class="lab" for="f-seats">全班人數（座號 1 到）</label><input type="number" id="f-seats" data-bind="form" data-k="seats" value="${f.seats}"></div>
      <div><label class="lab">分組（每組一行，寫座號，用逗號分開）</label><textarea id="f-groups" data-bind="form" data-k="groupsText" style="min-height:160px;font-family:var(--mono)">${esc(roster)}</textarea><p class="small muted">預設：第 1～4 組各 5 人，第 5、6 組各 4 人。改好會記在這支手機，下次開課直接沿用。</p></div>`;
    if (f.lesson === 2) {
      const l1 = T.sessions.filter(s => s.lesson === 1);
      h += `<div><label class="lab" for="f-from">各組的產品：從第 1 節帶入</label><select id="f-from" data-bind="form" data-k="from"><option value="">不帶入（之後在「分組」手動填）</option>${l1.map(s => `<option value="${s.id}" ${f.from === s.id ? "selected" : ""}>${s.code}・${esc(s.label)}・${new Date(s.created_at).toLocaleDateString("zh-TW")}</option>`).join("")}</select></div>`;
    }
    const parsed = parseRoster(f.groupsText, +f.seats);
    h += parsed.error ? `<div class="banner bad">${esc(parsed.error)}</div>` : `<div class="banner info">${Object.keys(groupSeats(parsed.map)).length} 組、${Object.keys(parsed.map).length} 人</div>`;
    h += `<div class="row"><button class="btn primary" data-act="create" ${dis(!parsed.error)}>建立課堂</button><button class="btn ghost" data-act="cancelform">取消</button></div>`;
  }
  return h + `</div>`;
}
function parseRoster(text, seats) {
  const map = {}; const lines = String(text || "").split(/\n/).map(s => s.trim()).filter(Boolean);
  if (!lines.length) return { error: "請填分組" };
  for (let i = 0; i < lines.length; i++) {
    const nums = lines[i].split(/[,，、\s]+/).filter(Boolean).map(Number);
    for (const n of nums) {
      if (!Number.isInteger(n) || n < 1 || n > seats) return { error: `第 ${i + 1} 組有不在 1～${seats} 的座號：${n}` };
      if (map[n]) return { error: `座號 ${n} 重複出現` };
      map[n] = i + 1;
    }
  }
  const missing = []; for (let s = 1; s <= seats; s++) if (!map[s]) missing.push(s);
  if (missing.length) return { error: `這些座號沒有分組：${missing.join("、")}` };
  return { map };
}
function rosterText(map) { return Object.values(groupSeats(map)).map(a => a.join(", ")).join("\n"); }

/* ---------- 控制台 ---------- */
function consoleView() {
  if (!T.session) return `<div class="t-wrap"><p class="muted">連線中…</p></div>`;
  const p = curP(), s = T.session;
  let h = `<div class="t-head"><span class="code">${s.code}</span><b>第 ${s.lesson} 節</b><span class="small">${esc(s.class_label)}</span><span class="spacer"></span><span class="mono" data-timer></span></div>
  <div id="netbar" class="banner bad" style="border-radius:0" ${T.net ? "hidden" : ""}>網路中斷，重新連線中…</div><div class="t-wrap">`;
  h += pendingAlerts();
  h += `<div class="t-tabs">${[["class", "上課"], ["groups", "分組"], ["login", "登入"], ["data", "資料"]].map(([k, l]) => `<button data-act="tab" data-v="${k}" aria-pressed="${T.tab === k}">${l}</button>`).join("")}</div>`;
  if (T.tab === "class") h += classTab(p);
  if (T.tab === "groups") h += groupsTab();
  if (T.tab === "login") h += loginTab();
  if (T.tab === "data") h += dataTab();
  return h + `</div>`;
}
function pendingAlerts() {
  const pend = T.devices.filter(d => d.status === "pending");
  if (!pend.length) return "";
  return pend.map(d => `<div class="t-alert"><b>${d.seat} 號要在新平板登入</b><span class="small">允許後，舊平板會自動登出，已送出的作答和草稿都還在。</span>
    <div class="row"><button class="btn go sm" data-act="dev" data-d="${d.device}" data-v="allow">允許</button><button class="btn ghost sm" data-act="dev" data-d="${d.device}" data-v="deny">不允許</button></div></div>`).join("");
}
function classTab(p) {
  const pages = L().pages, i = pages.findIndex(x => x.id === p.id), x = PS(p.id);
  let h = `<div class="t-now"><span class="small muted mono">${p.id}・${esc(p.time)}　第 ${i + 1} / ${pages.length} 頁</span><span class="t">${esc(p.title)}</span><span class="small muted">投影和全班平板都在這一頁</span></div>`;
  h += `<div class="t-nav"><button class="btn" data-act="go" data-v="${pages[i - 1] ? pages[i - 1].id : ""}" ${dis(i > 0)}>上一頁</button><button class="btn primary" data-act="go" data-v="${pages[i + 1] ? pages[i + 1].id : ""}" ${dis(i < pages.length - 1)}>下一頁</button></div>`;
  h += controls(p, x);
  if (answerable(p)) h += `<details class="box"><summary>重設這一頁</summary><div class="stack" style="margin-top:8px"><p class="small">清空這一頁所有作答${p.type === "sort" ? "和搶答次數" : ""}，頁面回到「還沒開始」。學生不用重新登入。</p><button class="btn stop" data-act="resetpage">重設 ${esc(p.id)}</button></div></details>`;
  const notes = notesFor(p);
  if (notes) h += `<div class="t-notes"><b>老師限定</b>${notes}</div>`;
  h += `<div class="t-sec"><h3>計時</h3><div class="pillset">${[[30, "30 秒"], [45, "45 秒"], [60, "1 分"], [120, "2 分"], [180, "3 分"], [300, "5 分"], [360, "6 分"], [480, "8 分"]].map(([v, l]) => `<button data-act="timer" data-v="${v}">${l}</button>`).join("")}<button data-act="timer" data-v="0">清除</button></div></div>`;
  h += `<div class="t-sec"><h3>${p.scope === "g" ? "各組進度" : "作答進度"}</h3>${progress(p)}</div>`;
  if (p.scope === "g") h += repsBox(p);
  h += `<div class="t-sec"><h3>跳到其他頁</h3><div class="plist">${pages.map(q => `<button data-act="go" data-v="${q.id}" aria-current="${q.id === p.id}"><span class="n">${q.id}</span>${esc(q.title)}${PS(q.id).open ? ` <span class="chip ok">作答中</span>` : ""}</button>`).join("")}</div></div>`;
  return h;
}
function controls(p, x) {
  let h = "";
  const pub = ["vote", "sort", "judge", "glove", "tricolor"].includes(p.type);
  if (p.type === "glove") {
    h += `<div class="t-sec"><h3>手套挑戰</h3><div class="row">
      <button class="btn ${x.phase === "r1" ? "primary" : ""}" data-act="glove" data-v="r1">第一輪（45 秒）</button>
      <button class="btn ${x.phase === "reset" ? "primary" : ""}" data-act="glove" data-v="reset">道具復位・準備第二輪（30 秒）</button>
      <button class="btn ${x.phase === "r2" ? "primary" : ""}" data-act="glove" data-v="r2">第二輪（45 秒）</button></div>
      <div class="row"><button class="btn ${x.published ? "" : "gold"}" data-act="publish" ${dis(x.published || gloveCanPublish(x))}>${x.published ? "收起長條圖" : "公布長條圖"}</button>${x.open ? `<button class="btn stop" data-act="end">結束作答</button>` : ""}</div></div>`;
    h += `<p class="small muted">第二輪結束後，先按「結束作答」，再公布統計。保留填寫與討論時間。</p>`;
    return h;
  }
  if (p.panels) h += `<div class="row">${p.panels.map((label, i) => `<button class="btn" data-act="panel" data-v="${i}" aria-pressed="${(x.panel || 0) === i}">${esc(label)}</button>`).join("")}</div>`;
  if (answerable(p)) {
    h += `<div class="row">`;
    if (x.open) h += `<button class="btn stop" data-act="end">結束作答</button>`;
    else if (x.ended || x.published) h += `<button class="btn" data-act="reopen">重新開放</button>`;
    else h += `<button class="btn go" data-act="open">${p.type === "vote" ? "開始投票" : "開始作答"}</button>`;
    if (pub) h += `<button class="btn ${x.published ? "" : "gold"}" data-act="publish">${x.published ? "收起結果" : p.type === "sort" ? "公布答案" : "公布"}</button>`;
    h += `</div>`;
  }
  if (p.revealImg) h += `<div class="row"><button class="btn ${x.reveal2 ? "" : "primary"}" data-act="reveal2">${x.reveal2 ? "換回原本的圖" : "解釋時：顯示 " + esc(p.revealCaption)}</button></div>`;
  const lines = p.type === "reveal" ? p.rows : p.intro3 ? [...p.intro3, ...p.lines] : p.story ? p.lines.slice(1) : p.lines;
  if (lines && lines.length) {
    const n = x.step || 0;
    const label = p.type === "reveal" ? "揭曉下一列" : p.id === "2-1" ? (n ? "下一行" : "揭曉") : p.id === "2-4" ? "揭曉下一個調查線索" : "下一行";
    h += `<div class="row"><button class="btn primary" data-act="step" data-v="${Math.min(lines.length, n + 1)}" ${dis(n < lines.length)}>${label}（${n}/${lines.length}）</button><button class="btn" data-act="step" data-v="${lines.length}">全部揭曉</button>${n ? `<button class="btn ghost sm" data-act="step" data-v="0">收回</button>` : ""}</div>`;
  }
  if (p.type === "cards") h += `<div class="row"><button class="btn ${(x.seg || 1) === 1 ? "primary" : ""}" data-act="seg" data-v="1">第一段：唸卡、抽卡</button><button class="btn ${x.seg === 2 ? "primary" : ""}" data-act="seg" data-v="2">第二段：整理需求</button></div>`;
  if (p.type === "aicompare") h += aiControls();
  if (p.type === "pickone" || p.type === "form") h += `<div class="t-sec"><h3>放大某一組到投影（再按一次收回）</h3><div class="pillset">${gids().map(g => `<button data-act="focus" data-v="${g}" aria-pressed="${x.focus === g}">第 ${g} 組</button>`).join("")}</div></div>`;
  if (p.type === "wall" || p.type === "voice") h += moderation(p);
  return h;
}
function notesFor(p) {
  if (!T.priv) return "";
  const n = (T.priv.notes && T.priv.notes[p.id]) || [];
  let h = n.map(t => `<div>${esc(t)}</div>`).join("");
  if (p.id === "1-7" && T.priv["1-7"]) h += `<div class="t-list">${T.priv["1-7"].answers.map((a, i) => `<div class="it"><span>${i + 1}．${p.rows[i][0]}</span><span class="small">${a.v === "對" ? "放對" : a.v === "錯" ? "放錯 → " + a.to : "太籠統"}</span></div>`).join("")}</div>`;
  if (p.sample) h += `<div class="small">※ 這是範例內容，上課前換成自己用 Gemini 問到的版本。</div>`;
  return h;
}
function moderation(p) {
  const rows = personResponses(T.responses, p.id).filter(r => r.sent);
  if (!rows.length) return "";
  return `<details class="box"><summary>看座號、隱藏不當內容（${rows.length}）</summary><div class="t-list">${rows.map(r => {
    const txt = p.type === "voice" ? (r.sent.a || []).join("／") : r.sent.text;
    return `<div class="it"><span class="small"><b>${r.owner.slice(1)} 號</b>　${esc(txt)}</span><button class="btn sm ${r.hidden ? "" : "ghost"}" data-act="hide" data-o="${r.owner}" data-v="${r.hidden ? "0" : "1"}">${r.hidden ? "恢復顯示" : "隱藏"}</button></div>`;
  }).join("")}</div></details>`;
}
function aiControls() {
  const bk = (T.priv && T.priv["2-8"] && T.priv["2-8"].backup) || {};
  return `<div class="t-sec"><h3>各組 AI 狀況</h3><div class="t-list">${gids().map(g => {
    const r = groupResponse(T.responses, "2-8", g); const ai = (r && r.data && r.data.ai) || {};
    const prod = T.backupProduct[g] || productOf(g) || PRODUCTS[0];
    const held = st().hold && st().hold[g];
    return `<div class="it" style="flex-direction:column;align-items:stretch">
      <div class="row"><b>第 ${g} 組</b><span class="small muted">AI 操作員 ${aiOf(g) || "—"} 號</span><span class="spacer"></span>${ai.handed ? `<span class="chip ok">已交給全組</span>` : ai.raw || (ai.lines || []).length ? `<span class="chip warn">貼上中</span>` : `<span class="chip">還沒貼</span>`}${r && r.sent ? `<span class="chip ok">已送出判斷</span>` : ""}</div>
      <div class="row"><select data-bind="bkprod" data-g="${g}" style="flex:1;min-width:0">${Object.keys(bk).map(k => `<option ${k === prod ? "selected" : ""}>${esc(k)}</option>`).join("")}</select><button class="btn sm" data-act="backup" data-g="${g}">貼上備用回答</button></div>
      <div class="row"><button class="btn sm ghost" data-act="aireopen" data-g="${g}" ${dis(ai.handed)}>重新開放 AI 回答區</button><button class="btn sm ${held ? "gold" : "ghost"}" data-act="hold" data-g="${g}">${held ? "取消暫留" : "讓這組暫留在這一頁"}</button></div></div>`;
  }).join("")}</div></div>`;
}
function repsBox(p) {
  const slots = p.type === "cards" ? [p.slot, p.slot2] : [p.slot];
  return `<details class="box"><summary>送出代表（可以改）</summary>${slots.map(slot => `<div class="t-list">${slots.length > 1 ? `<div class="small muted" style="padding-top:6px">${slot === p.slot ? "第一段（唸卡、抽卡）" : "第二段（整理需求）"}</div>` : ""}${gids().map(g => {
    const S = groupSeats(groupsMap())[g];
    return `<div class="it"><span>第 ${g} 組</span><select data-bind="rep" data-slot="${slot}" data-g="${g}" style="width:auto">${S.map(s => `<option value="${s}" ${repOf(slot, g) === s ? "selected" : ""}>${s} 號${aiOf(g) === s ? "（AI 操作員）" : ""}</option>`).join("")}</select></div>`;
  }).join("")}</div>`).join("")}</details>`;
}
function progress(p) {
  const G = gids();
  if (p.type === "login") { const a = activeSeats(); return `<div class="banner info">已登入 ${a.length} / ${T.session.seats}</div>${missingList(a)}`; }
  if (!answerable(p)) return `<p class="small muted">這一頁學生只能看。</p>`;
  if (p.scope === "g") {
    return `<div class="t-list">${G.map(g => {
      const r = groupResponse(T.responses, p.id, g);
      let tag = `<span class="chip">還沒送出</span>`;
      if (p.type === "sort") {
        const sm = sortSummary(T.responses, groupsMap()).find(x => x.g === g);
        if (sm.okTry) tag = `<span class="chip ok">第 ${sm.rank} 名・${fmtSec(sm.ms)}</span>`;
        else if (sm.att.length >= 2) tag = `<span class="chip bad">兩次都沒對</span>`;
        else if (sm.att.length) tag = `<span class="chip bad">錯 1 次</span>`;
        else if (r && r.data && r.data.order && r.data.order.some(Boolean)) tag = `<span class="chip warn">作答中</span>`;
      } else if (p.type === "cards") {
        const d = (r && r.data) || {}; const needs = d.needs || [];
        const onlyGuess = needs.some(n => n.src && n.src.guess && !(n.src.voice || []).length && !(n.src.role || []).length && !n.src.glove);
        tag = `${d.cards ? `<span class="chip">已抽卡</span>` : ""}${d.swap ? `<span class="chip">換過卡</span>` : ""}${r && r.sent ? `<span class="chip ok">需求 ${needs.length} 條</span>` : needs.length ? `<span class="chip warn">整理中</span>` : ""}${onlyGuess ? `<span class="chip warn">有只靠猜的</span>` : ""}`;
        if (!tag) tag = `<span class="chip">唸卡中</span>`;
      } else if (r && r.sent) tag = `<span class="chip ok">已送出 ${fmtClock(r.sent_ms)}</span>`;
      else if (r && hasData(r.data)) tag = `<span class="chip warn">作答中</span>`;
      return `<div class="it"><span>第 ${g} 組 <span class="small muted">代表 ${repOf(p.type === "cards" && PS(p.id).seg === 2 ? p.slot2 : p.slot, g) || "—"} 號</span></span><span class="row">${tag}</span></div>`;
    }).join("")}</div>`;
  }
  const rows = personResponses(T.responses, p.id);
  const done = rows.filter(r => r.sent).map(r => +r.owner.slice(1));
  if (p.type === "glove") {
    const round = PS(p.id).round || 1;
    const d2 = rows.filter(r => r.sent && r.sent["r" + round] && [0, 1, 2].every(i => r.sent["r" + round]["a" + i])).map(r => +r.owner.slice(1));
    return `<div class="banner info">第${round === 1 ? "一" : "二"}輪已送出 ${d2.length} 人</div>`;
  }
  const all = []; for (let i = 1; i <= T.session.seats; i++) all.push(i);
  const miss = all.filter(s => !done.includes(s));
  return `<div class="banner info">已送出 ${done.length} / ${T.session.seats}</div>${miss.length && miss.length <= 12 ? `<div class="small">還沒送出：${miss.map(s => s + " 號").join("、")}</div>` : ""}`;
}
function hasData(d) { return d && JSON.stringify(d) !== "{}"; }
function missingList(a) {
  const miss = []; for (let i = 1; i <= T.session.seats; i++) if (!a.includes(i)) miss.push(i);
  return miss.length ? `<div class="small">還沒登入：${miss.map(s => s + " 號").join("、")}</div>` : "";
}

function groupsTab() {
  const G = groupSeats(groupsMap());
  let h = `<div class="t-sec"><h3>目前分組</h3><div class="t-list">${Object.entries(G).map(([g, S]) => `<div class="it"><span><b>第 ${g} 組</b>　${S.join("、")} 號</span>${L().usesAI ? `<span class="small">AI 操作員 ${aiOf(g) || "—"} 號</span>` : ""}</div>`).join("")}</div></div>`;
  if (T.session.lesson === 2) {
    h += `<div class="t-sec"><h3>各組產品（心聲卡、AI 問法會自動帶入）</h3>${Object.keys(G).map(g => `<div class="row"><span style="width:4.5em">第 ${g} 組</span><input type="text" id="prod-${g}" data-bind="prod" data-g="${g}" value="${esc(productOf(g))}" style="flex:1;min-width:0"></div>`).join("")}<button class="btn primary" data-act="saveprod">儲存產品</button></div>`;
  }
  h += `<details class="box"><summary>修改分組</summary><div class="stack" style="margin-top:8px"><textarea id="regroup" style="min-height:150px;font-family:var(--mono)">${esc(rosterText(groupsMap()))}</textarea>
    <p class="small muted">每組一行。改分組後會重新排送出代表和 AI 操作員。</p><button class="btn" data-act="regroup">儲存分組並重新排代表</button></div></details>`;
  h += `<button class="btn ghost" data-act="rerole">只重新排送出代表和 AI 操作員</button>`;
  return h;
}
function loginTab() {
  const a = activeSeats();
  let h = `<div class="t-sec"><h3>已登入 ${a.length} / ${T.session.seats}</h3><div class="seatgrid-t">${Array.from({ length: T.session.seats }, (_, i) => i + 1).map(s => `<span class="${a.includes(s) ? "on" : T.devices.some(d => d.seat === s && d.status === "pending") ? "warn" : ""}">${s}</span>`).join("")}</div></div>`;
  const devs = T.devices.filter(d => d.status !== "revoked").sort((x, y) => x.seat - y.seat);
  h += `<div class="t-sec"><h3>平板（輸錯座號時，按「登出這台」讓學生重新輸入）</h3><div class="t-list">${devs.map(d => `<div class="it"><span><b>${d.seat} 號</b>　<span class="small muted">${d.status === "pending" ? "等待允許" : "最後連線 " + fmtClock(d.seen_ms)}</span></span>
    <span class="row">${d.status === "pending" ? `<button class="btn go sm" data-act="dev" data-d="${d.device}" data-v="allow">允許</button>` : ""}<button class="btn ghost sm" data-act="dev" data-d="${d.device}" data-v="logout">登出這台</button></span></div>`).join("") || `<p class="small muted">還沒有平板登入。</p>`}</div></div>`;
  h += `<div class="soft small">學生網址：<span class="mono">${esc(studentLink())}</span><br>也可以打開學生網址，輸入課堂代碼 <b class="mono">${T.session.code}</b>。</div>`;
  return h;
}
function dataTab() {
  const p = curP();
  return `<div class="t-sec"><h3>投影</h3><a class="btn primary block" href="?s=${T.sid}&mode=screen" target="_blank" rel="noopener" style="text-align:center;text-decoration:none">在這台開投影畫面</a>
    <p class="small muted">在教室電腦打開老師網址、登入後點這裡，按 F11 全螢幕。</p></div>
    <div class="t-sec"><h3>桌上的 QR code</h3>${st().classKey ? `<a class="btn block" href="qr.html?k=${encodeURIComponent(st().classKey)}&l=${encodeURIComponent(T.session.class_label)}" target="_blank" rel="noopener" style="text-align:center;text-decoration:none">打開列印頁（班級代號 ${esc(st().classKey)}）</a><p class="small muted">同一個班每節都用同一張，印一次就好。</p>` : `<p class="small muted">這堂課開課時沒有填班級代號，所以沒有固定的 QR code。下次開課時填上就有了。</p>`}</div>
    <div class="t-sec"><h3>下載作答資料（CSV，可用 Excel 開）</h3><button class="btn" data-act="csv" data-v="${p.id}">下載這一頁（${p.id}）</button><button class="btn" data-act="csv" data-v="">下載這一節全部</button></div>
    <div class="t-sec"><h3>整堂課重來</h3><p class="small muted">清空這堂課所有作答，學生要重新輸入座號，頁面回到第一頁。分組、產品和課堂代碼保留。</p><button class="btn stop" data-act="resetall">整堂課重來</button></div>
    <div class="t-sec"><h3>課堂</h3><button class="btn ghost" data-act="sessions">回課堂清單</button><button class="btn stop" data-act="close">結束這堂課（學生不能再登入）</button></div>
    <div class="t-sec"><h3>老師 PIN</h3><div class="row"><input type="password" id="newpin" inputmode="numeric" placeholder="新 PIN（至少 6 碼）" style="flex:1;min-width:0"><button class="btn" data-act="setpin">更改</button></div></div>`;
}

/* ---------- CSV ---------- */
function summarize(p, d) {
  if (!d) return "";
  switch (p.type) {
    case "vote": return d.choice || "";
    case "wall": return d.text || "";
    case "sort": return `順序：${(d.order || []).join("→")}｜說明：${(d.desc || []).join("")}`;
    case "judge": return (d.rows || []).map((r, i) => `${i + 1}.${r.v === "對" ? "放對" : r.v === "錯" ? "放錯→" + (r.to || "") : r.v === "籠統" ? "太籠統" : ""}（依據 ${r.basis || ""}）${r.rewrite ? "改寫：" + r.rewrite : ""}`).join("；");
    case "form": return p.fields.map(f => f.kind === "product" ? productText(d.product) : Array.isArray(d[f.key]) ? d[f.key].join("／") : (d[f.key] || "")).join("｜");
    case "feedback": return (d.a || []).map((x, i) => `${i + 1}. ${x}`).join("｜");
    case "glove": return [1, 2].map(r => d["r" + r] ? `第${r}輪：` + [0, 1, 2].map(i => `${d["r" + r]["a" + i] || "未填"}${d["r" + r]["w" + i] ? "（" + d["r" + r]["w" + i] + "）" : ""}`).join("、") : "").filter(Boolean).join("｜");
    case "voice": return (d.unused ? "［沒用過］" : "") + (d.a || []).join("｜");
    case "cards": return `角色卡：${(d.cards || []).map(c => ROLE_CARDS[c].name).join("、")}${d.swap ? "（換卡：" + d.swap.reason + "）" : ""}｜需求：${(d.needs || []).map(n => `${n.who || ""}／${n.when || ""}／${n.need || ""}`).join("；")}`;
    case "aicompare": return `AI：${((d.ai || {}).lines || []).join("；")}｜判斷：${Object.entries(d.judge || {}).map(([k, v]) => `${k}=${v.t || ""}${v.c ? COLORS[v.c].label : ""}`).join("；")}`;
    case "tricolor": return `${d.c ? COLORS[d.c].label : ""}｜${d.why || ""}`;
    case "pickone": return `${d.line || ""}｜${d.c ? COLORS[d.c].label : ""}｜${d.why || ""}`;
  }
  return JSON.stringify(d);
}
function downloadCSV(pageId) {
  const pages = L().pages.filter(p => answerable(p) && (!pageId || p.id === pageId));
  const rows = [["頁", "標題", "座號或組別", "狀態", "送出時間", "內容摘要", "原始資料"]];
  pages.forEach(p => {
    T.responses.filter(r => r.page === p.id).sort((a, b) => a.owner.localeCompare(b.owner, "en", { numeric: true })).forEach(r => {
      const d = r.sent || r.data;
      rows.push([p.id, p.title, r.owner[0] === "g" ? `第 ${r.owner.slice(1)} 組` : `${r.owner.slice(1)} 號`, r.sent ? "已送出" : "草稿", r.sent_ms ? new Date(r.sent_ms).toLocaleString("zh-TW") : "", summarize(p, d), JSON.stringify(d)]);
      if (p.type === "sort" && r.attempts && r.attempts.length) r.attempts.forEach(a => rows.push([p.id, "排序第 " + a.n + " 次", `第 ${r.owner.slice(1)} 組`, a.orderOk && a.descOk ? "答對" : "有錯", fmtSec(a.ms), `順序${a.orderOk ? "對" : "錯"}、說明${a.descOk ? "對" : "錯"}`, JSON.stringify(a)]));
    });
  });
  const csv = "﻿" + rows.map(r => r.map(csvEscape).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `第${T.session.lesson}節_${T.session.code}${pageId ? "_" + pageId : ""}.csv`;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

/* ---------- 投影 ---------- */
function screenView() {
  if (!T.session) return `<div class="sc"><p>連線中…</p></div>`;
  const p = curP(), x = PS(p.id);
  if (p.type === "login") return loginScreen(p);
  let h = `<div class="sc"><div class="sc-top"><span class="sc-pid">${esc(p.id)}</span><h1>${esc(p.title)}</h1>`;
  if (answerable(p)) h += `<span class="sc-state ${x.open ? "live" : ""}">${x.open ? "作答中" : x.published ? "已公布" : x.ended ? "已結束" : "尚未開始"}</span>`;
  h += `<span class="sc-count" data-timer hidden></span><span class="sc-time">${esc(p.time)}</span></div>`;
  if (p.sub && p.type !== "wall") h += `<div class="sc-sub">${esc(p.sub)}</div>`;
  h += `<div class="sc-body">${screenBody(p, x)}</div>`;
  h += `<div class="sc-foot"><span>${esc(L().title)}　${esc(L().book)}</span><span>${esc(T.session.class_label)}　${todayZh()}</span></div></div>`;
  h += `<div class="sc-overlay err" id="netbar" ${T.net ? "hidden" : ""}>網路中斷，重新連線中…</div>`;
  return h;
}
function loginScreen(p) {
  const url = studentLink();
  const a = activeSeats();
  let qr = "";
  try { const q = qrcode(0, "M"); q.addData(url); q.make(); qr = q.createSvgTag({ cellSize: 6, margin: 0, scalable: true }); } catch (e) { qr = ""; }
  const Lx = L();
  return `<div class="sc sc-cover">
    <div class="cv-row"><span class="cv-chip">${esc(Lx.chip)}</span><span class="cv-date">${todayZh()}</span></div>
    <div class="cv-main">
      <div class="cv-left">
        <h1 class="cv-title">${titleBreak(p.title)}</h1>
        <div class="cv-meta">${esc(T.session.class_label)}｜${esc(Lx.book)}</div>
        <div class="cv-art">${ART[T.session.lesson] || ""}</div>
      </div>
      <div class="cv-right">
        <div class="cv-qr"><div class="qr">${qr}</div><div class="qr-txt"><b>掃描 QR code</b><span>用 Chromebook 掃描，再輸入自己的座號</span><span class="code">課堂代碼 <i>${T.session.code}</i></span></div></div>
        <div class="cv-agenda"><b>今天要做的事</b><ol>${Lx.agenda.map(x => `<li>${esc(x)}</li>`).join("")}</ol></div>
      </div>
    </div>
    <div class="cv-seats"><span>已登入 <b>${a.length}</b> / ${T.session.seats}</span><div class="sc-seats">${Array.from({ length: T.session.seats }, (_, i) => i + 1).map(s => `<span class="${a.includes(s) ? "on" : ""}">${s}</span>`).join("")}</div></div>
  </div>
  <div class="sc-overlay err" id="netbar" ${T.net ? "hidden" : ""}>網路中斷，重新連線中…</div>`;
}
function bars(options, counts, n) {
  const max = Math.max(1, ...counts);
  return `<div class="sc-bars">${options.map((o, i) => `<div class="sc-bar"><span>${esc(o)}</span><div class="track"><div class="fill" style="width:${counts[i] / max * 100}%"></div></div><b>${counts[i]}</b></div>`).join("")}<div class="muted" style="font-size:1.2vw">共 ${n} 人投票</div></div>`;
}
function screenBody(p, x) {
  const G = gids();
  switch (p.type) {
    case "vote": {
      const t = voteTally(T.responses, p.id, p.options);
      const result = x.published ? bars(p.options, t.counts, t.n)
        : `<div class="sc-opts">${p.options.length <= 2 ? p.options.map(o => `<span>${esc(o)}</span>`).join("") : ""}</div><div class="sc-vcount"><b>${t.n}</b> / ${T.session.seats} 人已投票<span>${x.open ? "投票中，結果等老師公布" : "等老師開始投票"}</span></div>`;
      if (p.intro3) {
        return `<div class="sc-defs">${p.intro3.slice(0, x.step || 0).map(([a, b]) => `<div class="sc-def"><b>${esc(a)}</b><span>${esc(b)}</span></div>`).join("")}</div><div class="sc-hint">${esc(p.question)}</div>${result}${x.step ? `<ul class="sc-lines">${p.lines.slice(0, Math.max(0, x.step - p.intro3.length)).map(l => `<li>${esc(l)}</li>`).join("")}</ul>` : ""}`;
      }
      const showReveal = p.revealImg && x.reveal2;
      const mainImg = showReveal ? p.revealImg : p.img;
      return `<div class="sc-imgwrap">${p.panels ? panelImage(p, x) : mainImg ? `<img src="${IMAGES[mainImg]}" alt="">` : ""}<div class="side">${p.caption ? `<div class="sc-big">${esc(showReveal ? p.revealCaption : p.caption)}</div>` : ""}${p.intro ? `<div class="sc-hint" style="font-size:1.25vw">${esc(p.intro)}</div>` : ""}${p.question ? `<div class="sc-big" style="font-size:1.7vw">${esc(p.question)}</div>` : ""}${result}</div></div>`;
    }
    case "wall": {
      const notes = personResponses(T.responses, p.id).filter(r => r.sent && !r.hidden && (r.sent.text || "").trim()).sort((a, b) => a.sent_ms - b.sent_ms);
      let h = "";
      if (p.img) h += `<img src="${IMAGES[p.img]}" alt="120 毫升迷你保溫瓶示意圖，非新聞商品照片" style="height:20vh;object-fit:contain">`;
      if (p.source) h += `<div class="sc-sub" style="margin-top:0">${esc(p.source)}</div>`;
      if (p.sub) h += `<div class="sc-hint"><b>${esc(p.sub)}</b>　已貼上 ${notes.length} 張</div>`;
      if (p.lines && x.step) return h + `<div style="display:grid;grid-template-columns:1fr 1fr;gap:2vw;flex:1;min-height:0"><div class="sc-notes">${notes.slice(-12).map(r => `<div class="sc-note">${esc(r.sent.text)}</div>`).join("")}</div><div><div class="sc-big">${esc(p.revealTitle)}</div><ul class="sc-lines" style="padding:0">${p.lines.slice(0, x.step).map((l, i) => `<li>${i + 1}. ${esc(l)}</li>`).join("")}</ul></div></div>`;
      return h + `<div class="sc-notes">${notes.length ? notes.slice(-30).map(r => `<div class="sc-note">${esc(r.sent.text)}</div>`).join("") : `<div class="muted">老師按「開始作答」後，大家寫的會貼在這裡（不顯示座號）。</div>`}</div>`;
    }
    case "reveal": return `<div class="sc-map"><b class="muted">${esc(p.left)}</b><span></span><b class="muted">${esc(p.right)}</b>${p.rows.map(([a, b], i) => `<span class="l">${esc(a)}</span><span class="arr">→</span><span class="r ${i < (x.step || 0) ? "" : "hid"}">${i < (x.step || 0) ? `${i + 1}　${esc(b)}` : "？"}</span>`).join("")}</div>`;
    case "info": {
      let h = "";
      if (p.story) return needStory(p, x);
      if (p.panels) return `<div class="sc-imgwrap">${panelImage(p, x)}</div>`;
      if (p.lines && !p.img) h += `<ul class="sc-lines">${p.lines.slice(0, x.step || 0).map(l => `<li>${esc(l)}</li>`).join("")}</ul>`;
      if (p.defs) h += `<div class="sc-defs">${STAGES.map((s, i) => `<div class="sc-def"><b><i>${i + 1}</i>${s}</b><span>${esc(DESC_CARDS[DESC_ORDER[i]])}</span></div>`).join("")}</div>`;
      if (p.img && p.lines) return `<div class="sc-imgwrap"><img src="${IMAGES[p.img]}" alt="" style="max-width:45%"><ul class="sc-lines" style="flex:1;padding:0">${p.lines.slice(0, x.step || 0).map(l => `<li>${esc(l)}</li>`).join("")}</ul></div>`;
      if (p.img && p.pair) return `<div class="sc-imgwrap"><img src="${IMAGES[p.img]}" alt="" style="max-width:50%"><div class="side" style="flex:1"><div class="sc-pair" style="grid-template-columns:1fr">${p.pair.map(([a, b]) => `<div><b>${esc(a)}</b>${esc(b)}</div>`).join("")}</div></div></div>`;
      if (p.img) h += `<div class="sc-imgwrap" style="justify-content:center"><img src="${IMAGES[p.img]}" alt=""></div>`;
      return h;
    }
    case "sort": return sortScreen(x);
    case "judge": return judgeScreen(p, x);
    case "form": {
      if (x.focus) return formFocus(p, x.focus);
      return `<div class="sc-groups">${G.map(g => { const r = groupResponse(T.responses, p.id, g); const d = r && r.sent;
        if (!d) return `<div class="sc-g wait"><h3>第 ${g} 組</h3><span>${PS(p.id).open ? "討論中…" : "等待開始"}</span></div>`;
        if (p.id === "1-8") return `<div class="sc-g"><h3>第 ${g} 組</h3><b style="font-size:2vw">${esc(productText(d.product))}</b><span>${esc(d.pain || "")}</span><span class="muted" style="font-size:1.15vw">六個階段已寫 ${(d.stages || []).filter(x => (x || "").trim()).length} / 6 格</span></div>`;
        return `<div class="sc-g"><h3>第 ${g} 組</h3><b style="font-size:1.7vw">${esc(d.target || "")}</b><span class="muted">依 ${esc(d.basis || "")}</span><span>${(d.needs || []).filter(Boolean).map((n, i) => `${i + 1}. ${esc(n)}`).join("<br>")}</span></div>`; }).join("")}</div>`;
    }
    case "feedback": {
      const n = personResponses(T.responses, p.id).filter(r => r.sent).length;
      return `<ol style="font-size:1.8vw;display:flex;flex-direction:column;gap:1vw">${p.questions.map(q => `<li>${esc(q)}</li>`).join("")}</ol><div class="sc-big" style="margin-top:auto">已交 ${n} / ${T.session.seats}　<span class="muted" style="font-weight:400">內容只有老師看得到</span></div>`;
    }
    case "glove": return gloveScreen(x);
    case "voice": {
      const v = personResponses(T.responses, p.id).filter(r => r.sent && !r.hidden).sort((a, b) => a.sent_ms - b.sent_ms);
      return activityGuide("voice") + `<div class="sc-hint">心聲牆・已交 ${v.length} 張・不顯示座號</div><div class="sc-notes">${v.slice(-15).map(r => `<div class="sc-note v">${(r.sent.a || []).map(t => `<div>${esc(t)}</div>`).join("")}</div>`).join("")}</div>`;
    }
    case "cards": {
      const seg = x.seg || 1;
      return activityGuide(seg === 1 ? "cards1" : "cards2") + `<div class="sc-hint">${seg === 1 ? "第一段：一張一張唸心聲卡，再抽兩張角色卡" : "第二段：整理需求清單，每條都要寫來源"}</div><div class="sc-groups">${G.map(g => { const r = groupResponse(T.responses, p.id, g); const d = (r && r.data) || {}; const needs = d.needs || [];
        const onlyGuess = needs.filter(n => n.src && n.src.guess && !(n.src.voice || []).length && !(n.src.role || []).length && !n.src.glove).length;
        return `<div class="sc-g"><h3>第 ${g} 組 ${onlyGuess ? `<span class="sc-tag y">${onlyGuess} 條只靠猜</span>` : r && r.sent ? `<span class="sc-tag ok">需求 ${needs.length} 條</span>` : ""}</h3>${seg === 1 ? ((d.cards || []).map(c => `<span>${esc(ROLE_CARDS[c].name)}</span>`).join("") || `<span class="muted">還沒抽卡</span>`) : (needs.length ? needs.map(n => `<span><b>${esc(n.who || "誰？")}</b>・${esc(n.when || "情境待補")}：${esc(n.need || "需求待補")}</span>`).join("") : `<span class="muted">等待整理代表填寫至少三條需求</span>`)}</div>`; }).join("")}</div>`;
    }
    case "aicompare": return activityGuide("ai") + `<div class="sc-hint">各組進度｜回到平板依上方三步驟完成</div><div class="sc-groups">${G.map(g => { const r = groupResponse(T.responses, p.id, g); const ai = (r && r.data && r.data.ai) || {}; const j = (r && r.data && r.data.judge) || {}; const lines = ai.lines || [];
        const done = lines.filter(l => j[l] && j[l].t && j[l].c).length;
        const cs = { green: 0, yellow: 0, red: 0 }; lines.forEach(l => { if (j[l] && cs[j[l].c] !== undefined) cs[j[l].c]++; });
        return `<div class="sc-g ${r && r.sent ? "ok" : ""}"><h3>第 ${g} 組 <span class="sc-tag ${r && r.sent ? "ok" : ai.handed ? "y" : ""}">${r && r.sent ? "已送出" : ai.handed ? `判斷中 ${done}/${lines.length}` : lines.length ? "貼上中" : "問 AI 中"}</span></h3>${ai.handed ? `<span><span class="dot green"></span> ${cs.green}　<span class="dot yellow"></span> ${cs.yellow}　<span class="dot red"></span> ${cs.red}</span>` : ""}</div>`; }).join("")}</div>`;
    case "tricolor": return triScreen(p, x);
    case "pickone": {
      const list = G.map(g => ({ g, r: groupResponse(T.responses, p.id, g) })).filter(o => o.r && o.r.sent);
      if (!list.length) return `<div class="sc-big muted">各組從 2-8 的條列挑一條最值得討論的，送到這裡。</div>`;
      return `<div class="sc-groups">${list.map(({ g, r }) => { const d = r.sent; return `<div class="sc-g ${x.focus === g ? "focus" : ""}"><h3>第 ${g} 組 <span class="dot ${d.c}" style="width:1.6vw;height:1.6vw"></span></h3><b>「${esc(d.line)}」</b><span>${COLORS[d.c] ? COLORS[d.c].label + "（" + COLORS[d.c].name + "）" : ""}：${esc(d.why)}</span></div>`; }).join("")}</div>`;
    }
  }
  return "";
}
function formFocus(p, g) {
  const r = groupResponse(T.responses, p.id, g); const d = (r && (r.sent || r.data)) || {};
  if (p.id === "1-8") {
    return `<div class="sc-focus"><div class="sc-focus-head"><span class="sc-tag gold">第 ${g} 組</span><b>${esc(productText(d.product) || "還沒選產品")}</b></div>
      <div class="sc-hint"><b>最不方便的情況　</b>${esc(d.pain || "（還沒寫）")}</div>
      <div class="sc-stages">${STAGES.map((s, i) => `<div><b><i>${i + 1}</i>${s}</b><span>${esc((d.stages || [])[i] || "（還沒寫）")}</span></div>`).join("")}</div></div>`;
  }
  return `<div class="sc-focus"><div class="sc-focus-head"><span class="sc-tag gold">第 ${g} 組</span><b>${esc(d.target || "（還沒寫）")}</b></div>
    <div class="sc-hint"><b>依什麼特性分　</b>${esc(d.basis || "")}</div>
    <ul class="sc-lines" style="padding:0">${(d.needs || []).filter(Boolean).map((n, i) => `<li>下節想確認的需求 ${i + 1}：${esc(n)}</li>`).join("")}</ul></div>`;
}
function sortScreen(x) {
  const sm = sortSummary(T.responses, groupsMap());
  const key = T.priv && T.priv["1-5"] && T.priv["1-5"].key;
  if (!x.published) {
    return `<div class="sc-hint">把六個階段排好，再把說明配到對的階段。每組兩次機會，送出後只會知道對或錯。</div><div class="sc-groups">${sm.map(s => {
      const r = groupResponse(T.responses, "1-5", s.g); const working = r && r.data && r.data.order && r.data.order.some(Boolean);
      let tag = s.okTry ? `<span class="sc-tag ok">答對</span>` : s.att.length >= 2 ? `<span class="sc-tag bad">兩次都沒對</span>` : s.att.length ? `<span class="sc-tag bad">錯，還有 1 次</span>` : working ? `<span class="sc-tag y">作答中</span>` : `<span class="sc-tag">${x.open ? "作答中" : "等待開始"}</span>`;
      return `<div class="sc-g ${s.okTry ? "ok" : s.att.length >= 2 ? "bad" : ""}"><h3>第 ${s.g} 組 ${tag}</h3><span>送出 ${s.att.length} 次</span></div>`; }).join("")}</div>`;
  }
  const ranked = sm.filter(s => s.okTry).sort((a, b) => a.rank - b.rank), others = sm.filter(s => !s.okTry);
  return `<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);gap:2vw;flex:1;min-height:0">
    <div class="stack" style="gap:.8vw">${ranked.map(s => `<div class="sc-g ${s.rank <= 2 ? "first" : "ok"}" style="min-height:0"><h3>第 ${s.rank} 名・第 ${s.g} 組 <span class="sc-tag">${s.okTry === 1 ? "一次就對" : "第二次答對"}・${fmtSec(s.ms)}</span></h3>${s.okTry === 2 ? `<span>第一次：${errText(s.att[0], key)}</span>` : ""}</div>`).join("")}
      ${others.map(s => `<div class="sc-g bad" style="min-height:0"><h3>第 ${s.g} 組 <span class="sc-tag bad">${s.att.length ? "再看一次正確答案" : "沒有送出"}</span></h3>${s.att.map((a, i) => `<span>第 ${i + 1} 次：${errText(a, key)}</span>`).join("")}</div>`).join("")}</div>
    <div class="sc-defs" style="grid-template-columns:1fr 1fr;align-content:start">${STAGES.map((s, i) => `<div class="sc-def"><b><i>${i + 1}</i>${s}</b><span>${key ? key.desc[i] + "　" : ""}${esc(DESC_CARDS[key ? key.desc[i] : DESC_ORDER[i]])}</span></div>`).join("")}</div></div>`;
}
function errText(a, key) {
  if (!a || !key) return "";
  const pos = []; const dpos = [];
  a.order.forEach((n, i) => { if (n !== key.order[i]) pos.push(i + 1); });
  a.desc.forEach((d, i) => { if (d !== key.desc[i]) dpos.push(i + 1); });
  return `順序${pos.length ? "錯在第 " + pos.join("、") + " 格" : "對"}；說明${dpos.length ? "錯在第 " + dpos.join("、") + " 格" : "對"}`;
}
function judgeScreen(p, x) {
  const sent = gids().map(g => ({ g, r: groupResponse(T.responses, p.id, g) })).filter(o => o.r && o.r.sent);
  const ans = T.priv && T.priv["1-7"] && T.priv["1-7"].answers;
  let h = `<table class="sc-table"><thead><tr><th>階段</th><th>AI 寫的</th>${x.published ? "<th>各組判斷</th><th>答案</th>" : ""}</tr></thead><tbody>`;
  p.rows.forEach(([stage, text], i) => {
    h += `<tr><td class="stage">${stage}</td><td>${esc(text)}</td>`;
    if (x.published) {
      const c = { 對: [], 錯: [], 籠統: [] };
      sent.forEach(({ g, r }) => { const v = r.sent.rows && r.sent.rows[i] && r.sent.rows[i].v; if (c[v]) c[v].push(g); });
      h += `<td><div class="sc-mini"><span class="ok">放對 ${c.對.length}</span><span class="bad">放錯 ${c.錯.length}</span><span class="vague">太籠統 ${c.籠統.length}</span></div></td>`;
      const a = ans && ans[i];
      h += `<td>${a ? `<span class="${a.v === "對" ? "v-ok" : a.v === "錯" ? "v-bad" : "v-vague"}">${a.v === "對" ? "放對" : a.v === "錯" ? "放錯 → " + a.to : "太籠統"}</span><br><span style="font-size:1.15vw">${esc(a.why)}</span>` : ""}</td>`;
    }
    h += `</tr>`;
  });
  h += `</tbody></table>`;
  if (!x.published) h += `<div class="sc-big" style="margin-top:auto">${sent.length} / ${gids().length} 組已送出　<span class="muted" style="font-weight:400">每個判斷都要說出依據的課本定義</span></div>`;
  return h;
}
function gloveScreen(x) {
  const round = x.round || 1;
  let h = `<div style="display:grid;grid-template-columns:${x.published ? "minmax(0,.8fr) minmax(0,1.2fr)" : "1fr"};gap:2vw;flex:1;min-height:0"><div class="stack" style="gap:1vw">`;
  h += `<div class="sc-hint"><b>${x.phase === "reset" ? "道具復位・準備第二輪（30 秒）" : round === 1 ? "第一輪：戴手套，45 秒" : "第二輪：換人，一樣戴手套，一隻手抓著椅背，只能用單手，45 秒"}</b></div>`;
  h += `<ul class="sc-lines" style="padding:0">${GLOVE_ACTIONS.map((a, i) => `<li>${i + 1}. ${esc(a)}</li>`).join("")}</ul>`;
  if (x.phase === "reset") h += `<div class="sc-hint" style="font-size:1.3vw">先把水倒回瓶子，再轉緊瓶蓋；卡片放回夾鏈袋並壓緊、迴紋針放回桌上。讓兩輪從相同狀態開始。</div>`;
  h += `</div>`;
  if (x.published) {
    const g = gloveStats(T.responses, groupsMap()); const max = Math.max(1, g.total);
    h += `<div class="stack"><div class="sc-hint" style="font-size:1.1vw">同組任一觀察員回報卡住或未完成，就計 1 組；未回報不代表順利。兩輪換人，結果只作討論線索，不能證明單手是唯一原因。</div><div class="sc-big">哪些操作讓使用者卡住？（組數，最多 ${g.total} 組）</div><div class="sc-legend"><span><i style="background:var(--green-2)"></i>第一輪：戴手套</span><span><i style="background:var(--gold)"></i>第二輪：戴手套＋單手</span></div>
      <div class="sc-chart">${GLOVE_ACTIONS.map((a, i) => `<div class="col"><div class="bars2"><div class="b r1" style="height:${g.stats[1][i] / max * 100}%"><span>${g.stats[1][i]}</span></div><div class="b r2" style="height:${g.stats[2][i] / max * 100}%"><span>${g.stats[2][i]}</span></div></div><div class="cap">${["轉瓶蓋、倒水", "夾鏈袋拿卡片", "迴紋針夾卡片"][i]}</div></div>`).join("")}</div></div>`;
  }
  return h + `</div>`;
}
function triScreen(p, x) {
  const ev = p.evidence;
  let evh = esc(ev.text);
  if (ev.kind === "glove") { const g = gloveStats(T.responses, groupsMap()); evh += `<div class="sc-big" style="margin-top:.6vw">轉開瓶蓋：第一輪 ${g.stats[1][0]} 組卡住、第二輪 ${g.stats[2][0]} 組卡住（共 ${g.total} 組）</div>`; }
  if (ev.kind === "wall") {
    const texts = voiceTexts(T.responses).flat();
    const hits = texts.filter(t => ev.words.some(w => t.includes(w)));
    evh += `<div class="sc-big" style="margin-top:.6vw">心聲卡共 ${texts.length} 句，提到顏色、圖案、外觀的有 ${hits.length} 句</div>${hits.slice(0, 3).map(t => `<div>「${esc(t)}」</div>`).join("")}`;
  }
  let h = `<div class="sc-quote">AI 說：「${esc(p.quote)}」</div><div class="sc-evid"><b>證據　</b>${evh}</div>`;
  h += `<div class="sc-colors">${Object.entries(COLORS).map(([k, c]) => `<div style="background:var(--c-${k})"><b>${c.label}（${c.name}）</b>　${esc(c.desc)}</div>`).join("")}</div>`;
  const sent = gids().map(g => ({ g, r: groupResponse(T.responses, p.id, g) })).filter(o => o.r && o.r.sent);
  if (!x.published) h += `<div class="sc-big">${sent.length} / ${gids().length} 組已送出　<span class="muted" style="font-weight:400">顏色不是重點，說得出依據才是</span></div>`;
  else h += `<div class="sc-groups" style="grid-template-columns:repeat(3,minmax(0,1fr))">${Object.keys(COLORS).map(k => `<div class="sc-g" style="border-top:.5vw solid var(--c-${k})"><h3>${COLORS[k].label}・${sent.filter(o => o.r.sent.c === k).length} 組</h3>${sent.filter(o => o.r.sent.c === k).map(o => `<span><b>第 ${o.g} 組</b>　${esc(o.r.sent.why || "")}</span>`).join("")}</div>`).join("")}</div>`;
  return h;
}

/* ---------- 事件 ---------- */
document.addEventListener("click", async e => {
  const t = e.target.closest("[data-act]");
  if (!t || t.disabled) return;
  const a = t.dataset.act, p = T.session ? curP() : null;
  switch (a) {
    case "login": {
      const r = await rpc("lesson_teacher_login", { p_pin: T.pin });
      if (r && r.ok) { T.token = r.token; LS.set("lesson-teacher-token", r.token); T.msg = ""; boot(); }
      else { T.msg = r && r.error === "LOCKED" ? "錯太多次，請 5 分鐘後再試。" : "PIN 不對。"; render(true); }
      break;
    }
    case "logout": logout(); break;
    case "newform": {
      const saved = LS.get("lesson-roster", null);
      T.form = { lesson: 1, label: LS.get("lesson-label", "九年 16 班"), seats: saved ? saved.seats : 28, groupsText: saved ? saved.text : rosterText(defaultGroups(28, [5, 5, 5, 5, 4, 4])), from: "", classKey: LS.get("lesson-classkey", "916") };
      render(true); break;
    }
    case "cancelform": T.form = null; render(true); break;
    case "flesson": T.form.lesson = +t.dataset.v; render(true); break;
    case "create": {
      const f = T.form, parsed = parseRoster(f.groupsText, +f.seats);
      if (parsed.error) return;
      t.disabled = true;
      const roles = buildRoles(parsed.map, f.lesson);
      const state = { page: LESSONS[f.lesson].pages[0].id, pages: {}, classKey: (f.classKey || "").trim() };
      if (f.lesson === 2 && f.from) {
        const r = await rpc("lesson_teacher_poll", { p_token: T.token, p_id: f.from, p_with_private: false });
        if (r && r.ok) { state.products = {}; (r.responses || []).filter(x => x.page === "1-8" && x.owner[0] === "g").forEach(x => { const d = x.sent || x.data; if (d && d.product) state.products[x.owner.slice(1)] = productText(d.product); }); }
      }
      const r = await rpc("lesson_create", { p_token: T.token, p_lesson: f.lesson, p_label: f.label, p_seats: +f.seats, p_groups: parsed.map, p_reps: roles.reps, p_ai: roles.ai, p_state: state });
      if (r && r.ok) { LS.set("lesson-roster", { seats: +f.seats, text: f.groupsText }); LS.set("lesson-label", f.label); LS.set("lesson-classkey", (f.classKey || "").trim()); location.href = "?s=" + r.id; }
      else { toast("建立失敗，請再試一次"); t.disabled = false; }
      break;
    }
    case "sessions": location.href = location.pathname; break;
    case "tab": T.tab = t.dataset.v; render(true); break;
    case "go": if (t.dataset.v) act.go(t.dataset.v); break;
    case "open": act.open(p.id); break;
    case "end": act.end(p.id); break;
    case "reopen": act.reopen(p.id); break;
    case "publish": act.publish(p.id); break;
    case "step": act.step(p.id, +t.dataset.v); break;
    case "panel": patchState(s => { pg(s, p.id).panel = Number(t.dataset.v); }); break;
    case "reveal2": patchState(s => { pg(s, p.id).reveal2 = !pg(s, p.id).reveal2; }); break;
    case "timer": act.timer(+t.dataset.v); break;
    case "glove": act.glove(t.dataset.v); break;
    case "seg": act.seg(+t.dataset.v); break;
    case "focus": act.focus(p.id, +t.dataset.v); break;
    case "hold": { const g = +t.dataset.g; act.hold(g, st().hold && st().hold[g] ? null : "2-8"); break; }
    case "dev": {
      const r = await rpc("lesson_teacher_device", { p_token: T.token, p_id: T.sid, p_device: t.dataset.d, p_action: t.dataset.v });
      if (!r || !r.ok) toast("沒有成功，請再按一次"); await refresh(); break;
    }
    case "hide": await teacherWrite(p.id, t.dataset.o, null, null, { p_hidden: t.dataset.v === "1" }); break;
    case "backup": {
      const g = +t.dataset.g; const prod = T.backupProduct[g] || productOf(g) || PRODUCTS[0];
      const list = T.priv && T.priv["2-8"] && T.priv["2-8"].backup[prod]; if (!list) { toast("找不到這個產品的備用回答"); break; }
      const lines = list.map(x => x[0]);
      await teacherWrite("2-8", "g" + g, "ai", { raw: lines.join("\n"), lines, handed: false, backup: prod });
      toast(`已把「${prod}」的備用回答貼到第 ${g} 組`); break;
    }
    case "aireopen": {
      const g = +t.dataset.g; const r = groupResponse(T.responses, "2-8", g); const ai = Object.assign({}, (r && r.data && r.data.ai) || {}, { handed: false });
      await teacherWrite("2-8", "g" + g, "ai", ai); toast(`第 ${g} 組的 AI 回答區已重新開放`); break;
    }
    case "saveprod": {
      const pr = Object.assign({}, st().products);
      document.querySelectorAll('[data-bind="prod"]').forEach(el => { pr[el.dataset.g] = el.value.trim(); });
      if (await patchState(s => { s.products = pr; })) toast("已儲存產品"); break;
    }
    case "regroup": {
      const parsed = parseRoster(document.getElementById("regroup").value, T.session.seats);
      if (parsed.error) { toast(parsed.error); break; }
      const roles = buildRoles(parsed.map, T.session.lesson);
      const r = await rpc("lesson_teacher_update", { p_token: T.token, p_id: T.sid, p_rev: null, p_state: null, p_reps: roles.reps, p_ai: roles.ai, p_groups: parsed.map });
      if (r && r.ok) { toast("已更新分組"); LS.set("lesson-roster", { seats: T.session.seats, text: document.getElementById("regroup").value }); } else toast("沒有成功");
      await refresh(); break;
    }
    case "rerole": {
      const roles = buildRoles(groupsMap(), T.session.lesson);
      const r = await rpc("lesson_teacher_update", { p_token: T.token, p_id: T.sid, p_rev: null, p_state: null, p_reps: roles.reps, p_ai: roles.ai });
      toast(r && r.ok ? "已重新排代表" : "沒有成功"); await refresh(); break;
    }
    case "csv": downloadCSV(t.dataset.v); break;
    case "resetpage": case "resetall": case "archive": {
      if (t.dataset.confirm !== "1") { const old = t.textContent; t.dataset.confirm = "1"; t.textContent = "再按一次確定"; setTimeout(() => { t.dataset.confirm = ""; t.textContent = old; }, 4000); break; }
      t.disabled = true;
      let r;
      if (a === "archive") { r = await rpc("lesson_teacher_archive", { p_token: T.token, p_id: t.dataset.id }); toast(r && r.ok ? "已從清單移除" : "沒有成功"); await loadSessions(); break; }
      const s2 = JSON.parse(JSON.stringify(T.session.state || {})); s2.pages = s2.pages || {};
      if (a === "resetpage") { s2.pages[p.id] = { resetAt: Clock.now() }; if (p.id === "2-2" || p.type === "glove") s2.timer = null; }
      else { const keep = { products: s2.products, classKey: s2.classKey }; Object.keys(s2).forEach(k => delete s2[k]); Object.assign(s2, keep, { page: L().pages[0].id, pages: {}, resetAt: Clock.now() }); }
      r = await rpc("lesson_teacher_reset", { p_token: T.token, p_id: T.sid, p_page: a === "resetpage" ? p.id : null, p_state: s2, p_logout: a === "resetall" });
      toast(r && r.ok ? (a === "resetpage" ? `${p.id} 已重設` : "整堂課已重設，請學生重新輸入座號") : "沒有成功，請再按一次");
      await refresh(); break;
    }
    case "close": {
      if (t.dataset.confirm !== "1") { t.dataset.confirm = "1"; t.textContent = "再按一次確定結束"; setTimeout(() => { t.dataset.confirm = ""; t.textContent = "結束這堂課（學生不能再登入）"; }, 4000); break; }
      const r = await rpc("lesson_teacher_close", { p_token: T.token, p_id: T.sid, p_active: false });
      toast(r && r.ok ? "這堂課已結束" : "沒有成功"); break;
    }
    case "setpin": {
      const v = document.getElementById("newpin").value;
      const r = await rpc("lesson_teacher_set_pin", { p_token: T.token, p_new: v });
      toast(r && r.ok ? "已更改 PIN" : r && r.error === "SHORT" ? "PIN 至少 6 碼" : "沒有成功"); break;
    }
  }
});
document.addEventListener("input", e => {
  const t = e.target, b = t.dataset.bind;
  if (b === "pin") T.pin = t.value;
  if (b === "form") { T.form[t.dataset.k] = t.value; if (t.tagName === "SELECT") render(true); else { const el = document.querySelector('[data-act="create"]'); const ok = !parseRoster(T.form.groupsText, +T.form.seats).error; if (el) el.disabled = !ok; } }
  if (b === "bkprod") T.backupProduct[t.dataset.g] = t.value;
});
document.addEventListener("change", async e => {
  const t = e.target;
  if (t.dataset.bind === "rep") {
    const reps = JSON.parse(JSON.stringify(T.session.reps || {})); reps[t.dataset.slot] = reps[t.dataset.slot] || {}; reps[t.dataset.slot][t.dataset.g] = +t.value;
    const r = await rpc("lesson_teacher_update", { p_token: T.token, p_id: T.sid, p_rev: null, p_state: null, p_reps: reps });
    toast(r && r.ok ? `第 ${t.dataset.g} 組改由 ${t.value} 號送出` : "沒有成功"); await refresh();
  }
  if (t.dataset.bind === "form" && t.tagName === "SELECT") render(true);
});
document.addEventListener("keydown", e => {
  if (e.key === "Enter" && e.target.id === "pin") document.querySelector('[data-act="login"]')?.click();
});
document.addEventListener("visibilitychange", () => { if (!document.hidden && T.sid) refresh(); });
boot();
