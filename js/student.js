/* 學生平板 */
const qs = new URLSearchParams(location.search);
let CODE = (qs.get("c") || "").replace(/\D/g, "");
let KEY = (qs.get("k") || "").trim();
if (KEY) LS.set("lesson-class", KEY); else KEY = qs.get("c") ? "" : LS.get("lesson-class", "");
if (!CODE && !KEY) CODE = (LS.get("lesson-code", "") || "").replace(/\D/g, "");
let DEVICE = LS.get("lesson-device", null);
if (!DEVICE) { DEVICE = uid(); LS.set("lesson-device", DEVICE); }

const S = {
  phase: CODE || KEY ? "loading" : "code",
  msg: "", seatInput: "", codeInput: "",
  seat: null, group: null, session: null, mine: [], grp: [], voices: [],
  local: {}, status: {}, linger: null, net: true, lastPage: null, flip: {}
};
const app = document.getElementById("app");

/* ---------- 固定的班級 QR code：找這個班目前正在上的課 ---------- */
let findTimer = null, lastFind = 0;
async function findClass() {
  clearTimeout(findTimer);
  lastFind = Date.now();
  const r = await rpc("lesson_find", { p_key: KEY });
  if (r && r.ok && r.code) {
    if (r.code !== CODE) { CODE = r.code; LS.set("lesson-code", CODE); S.phase = "loading"; S.msg = ""; render(true); }
    poll(); return;
  }
  if (r && r.ok && !r.code) { S.phase = "waitclass"; render(true); }
  findTimer = setTimeout(findClass, 3000);
}

/* ---------- 輪詢 ---------- */
let pollTimer = null;
async function poll() {
  clearTimeout(pollTimer);
  if (!CODE) return;
  const r = await rpc("lesson_poll", { p_code: CODE, p_device: DEVICE });
  if (!r || r.ok === false) {
    if (r && r.error === "NO_SESSION") {
      if (KEY) { CODE = ""; findClass(); return; }
      S.phase = "code"; S.msg = "找不到課堂代碼 " + CODE + "，請確認投影上的代碼。"; CODE = ""; LS.del("lesson-code"); render(true); return;
    }
    S.net = false; renderLive(); schedule(3000); return;
  }
  S.net = true;
  Clock.sync(r.now);
  const prevPhase = S.phase;
  if (r.status === "active") {
    S.phase = "active"; S.seat = r.seat; S.group = r.group; S.session = r.session;
    S.mine = r.mine || []; S.grp = r.grp || []; S.voices = r.voices || [];
  } else if (r.status === "pending") { S.phase = "pending"; S.seat = r.seat; S.session = r.session; }
  else {
    if (prevPhase === "active" || prevPhase === "pending") S.msg = r.status === "revoked" ? "這台平板已經被登出，請重新輸入座號。" : "";
    S.phase = "seat"; S.session = r.session;
  }
  const pg = S.phase === "active" ? effPageId() : null;
  const force = prevPhase !== S.phase || pg !== S.lastPage;
  S.lastPage = pg;
  if (S.linger && !pstate(S.session.state, S.linger).open) S.linger = null;
  render(force);
  schedule(document.hidden ? 5000 : 1500);
  if (KEY && Date.now() - lastFind > 20000) { lastFind = Date.now(); rpc("lesson_find", { p_key: KEY }).then(f => { if (f && f.ok && f.code && f.code !== CODE) { CODE = f.code; LS.set("lesson-code", CODE); S.phase = "loading"; S.local = {}; render(true); poll(); } }); }
}
function schedule(ms) { clearTimeout(pollTimer); pollTimer = setTimeout(poll, ms); }
document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });

/* ---------- 目前頁面與身分 ---------- */
function lessonNo() { return S.session && S.session.lesson; }
function effPageId() {
  const st = S.session.state || {};
  if (S.linger) return S.linger;
  return (st.hold && st.hold[S.group]) || st.page || LESSONS[lessonNo()].pages[0].id;
}
function curPage() { return pageById(lessonNo(), effPageId()) || LESSONS[lessonNo()].pages[0]; }
function ps(p) { return pstate(S.session.state, p.id); }
function repSeat(slot) { return S.session.reps && S.session.reps[slot] && S.session.reps[slot][S.group]; }
function aiSeat() { return S.session.ai_ops && S.session.ai_ops[S.group]; }
function iAmRep(slot) { return repSeat(slot) === S.seat; }
function iAmAI() { return aiSeat() === S.seat; }
function product() { const pr = S.session.state && S.session.state.products; return (pr && pr[S.group]) || ""; }
function server(p) { const list = p.scope === "g" ? S.grp : S.mine; return list.find(r => r.page === p.id); }
function isOpen(p) { return !!ps(p).open; }

/* 老師重設後，舊草稿不能再跑回來：草稿的鑰匙帶上重設時間 */
function dkey(p, part) { const st = S.session.state || {}; return p.id + (part ? "." + part : "") + "@" + (st.resetAt || 0) + "." + (pstate(st, p.id).resetAt || 0); }
/* 本地草稿：編輯者用本地值，其他組員一律看伺服器的值 */
function isEditor(p, part) {
  if (!isOpen(p)) return false;
  if (p.scope !== "g") return true;
  if (p.type === "aicompare") {
    const ai = (server(p) || {}).data?.ai || {};
    if (part === "ai") return iAmAI() && !ai.handed;
    return iAmRep(p.slot) && !!ai.handed;
  }
  if (p.type === "cards") return part === "needs" ? iAmRep(p.slot2) && ps(p).seg === 2 : iAmRep(p.slot);
  return iAmRep(p.slot);
}
function val(p, part) {
  const key = dkey(p, part);
  const sd = (server(p) || {}).data || {};
  const sv = part ? sd[part] : sd;
  if (!isEditor(p, part) || !(key in S.local)) {
    const ls = LS.get(`draft:${CODE}:${S.seat}:${key}`, null);
    S.local[key] = isEditor(p, part) && ls && !hasContent(sv) ? ls : JSON.parse(JSON.stringify(sv ?? (part ? null : {})));
  }
  return S.local[key];
}
function hasContent(v) { return v !== null && v !== undefined && JSON.stringify(v) !== "{}" && JSON.stringify(v) !== "null"; }
function setVal(p, part, v) {
  const key = dkey(p, part);
  S.local[key] = v;
  LS.set(`draft:${CODE}:${S.seat}:${key}`, v);
}

function fillDefaults(p, v) {
  if (!v || typeof v !== "object") return;
  if (p.type === "sort") { if (!Array.isArray(v.order)) v.order = [null, null, null, null, null, null]; if (!Array.isArray(v.desc)) v.desc = ["", "", "", "", "", ""]; }
  if (p.type === "judge" && !Array.isArray(v.rows)) v.rows = p.rows.map(() => ({}));
}

/* ---------- 存檔 ---------- */
const draftTimers = {};
function slotFor(p, part) { if (p.type === "cards" && part === "needs") return p.slot2; return p.slot || null; }
function queueDraft(p, part) {
  const key = dkey(p, part);
  clearTimeout(draftTimers[key]);
  S.status[key] = "draft"; renderLive();
  draftTimers[key] = setTimeout(() => save(p, part, false), 900);
}
async function save(p, part, send) {
  const key = dkey(p, part);
  clearTimeout(draftTimers[key]);
  const value = S.local[key];
  const req = send ? uid() : null;
  S.status[key] = send ? "sending" : "saving"; render();
  let r;
  for (let i = 0; i < (send ? 4 : 1); i++) {
    r = await rpc("lesson_save", { p_code: CODE, p_device: DEVICE, p_page: p.id, p_kind: p.scope === "g" ? "g" : "p", p_part: part || null, p_value: value, p_send: !!send, p_req: req, p_slot: slotFor(p, part) });
    if (r && r.ok) break;
    if (!r || r.error !== "NETWORK") break;
    await new Promise(res => setTimeout(res, 1200));
  }
  if (r && r.ok) {
    S.status[key] = send ? "sent" : "saved";
    // 先把伺服器狀態更新成剛送出的內容，避免閃回舊資料
    const list = p.scope === "g" ? S.grp : S.mine;
    let row = list.find(x => x.page === p.id);
    if (!row) { row = { page: p.id, data: {} }; list.push(row); }
    row.data = part ? Object.assign({}, row.data, { [part]: value }) : value;
    if (send) { row.sent = JSON.parse(JSON.stringify(row.data)); row.sent_ms = r.sent_ms || Clock.now(); }
  } else {
    S.status[key] = "error:" + (r && r.error || "NETWORK");
  }
  render(true);
  poll();
}
function statusHTML(p, part) {
  const key = dkey(p, part);
  const st = S.status[key] || "";
  const row = server(p);
  const local = S.local[key];
  const sentVal = row && row.sent ? (part ? row.sent[part] : row.sent) : null;
  if (st === "sending") return `<span>送出中…</span>`;
  if (st.startsWith("error:")) {
    const e = st.slice(6);
    const msg = { CLOSED: "老師已經結束作答，這次沒有送出。", NOT_REP: "這一題不是由你送出。", NOT_AI: "只有 AI 操作員可以編輯這一區。", AI_LOCKED: "AI 回答已經交給全組判斷。", NETWORK: "網路不穩，還沒送出，請再按一次。" }[e] || "沒有送出成功，請再按一次。";
    return `<span class="dirty">${msg}</span>`;
  }
  if (row && row.sent_ms && sentVal !== null) {
    if (same(local, sentVal)) return `<span class="sent">已送出 ✓ ${fmtClock(row.sent_ms)}</span>`;
    return `<span class="dirty">有修改還沒送出</span><span>上次送出 ${fmtClock(row.sent_ms)}</span>`;
  }
  if (st === "saving") return `<span>儲存草稿…</span>`;
  if (hasContent(local)) return `<span>草稿（已自動儲存）</span>`;
  return "";
}

/* ---------- 畫面 ---------- */
function isTyping() {
  const a = document.activeElement;
  return a && app.contains(a) && (a.tagName === "TEXTAREA" || (a.tagName === "INPUT" && /text|search|number/.test(a.type)));
}
let composing = false, pendingRender = false, lastHTML = "";
document.addEventListener("compositionstart", () => composing = true);
document.addEventListener("compositionend", () => { composing = false; });
document.addEventListener("focusout", () => setTimeout(() => { if (pendingRender && !isTyping()) render(true); }, 50));

function render(force) {
  if (!force && (composing || isTyping())) { pendingRender = true; renderLive(); return; }
  pendingRender = false;
  const a = document.activeElement, id = a && a.id, sel = a && "selectionStart" in a ? [a.selectionStart, a.selectionEnd] : null;
  const y = window.scrollY;
  const html = view();
  if (html === lastHTML) { renderLive(); return; }
  lastHTML = html;
  app.innerHTML = html;
  const pageNow = S.phase === "active" ? effPageId() : S.phase;
  window.scrollTo(0, S.lastRenderedPage === pageNow ? y : 0);
  S.lastRenderedPage = pageNow;
  if (id) { const n = document.getElementById(id); if (n && !n.disabled) { n.focus({ preventScroll: true }); if (sel && n.setSelectionRange) try { n.setSelectionRange(sel[0], sel[1]); } catch (e) {} } }
  renderLive();
}
function renderLive() {
  const el = document.querySelector("[data-timer]");
  const t = S.session && S.session.state && S.session.state.timer;
  if (el && t && t.end) { const left = (t.end - Clock.now()) / 1000; el.textContent = fmtLeft(left); el.classList.toggle("low", left <= 30); el.hidden = left <= -2; }
  const nb = document.getElementById("netbar"); if (nb) nb.hidden = S.net;
  document.querySelectorAll("[data-status]").forEach(el => {
    const p = pageById(lessonNo(), el.dataset.page); if (p) el.innerHTML = statusHTML(p, el.dataset.part || null);
  });
}
setInterval(renderLive, 500);

function view() {
  if (S.phase === "code") return codeView();
  if (S.phase === "waitclass") return `<div class="st-main">${coverCard(null, "", `<div class="cv-ok">等老師開課<br><span>老師開始上課後會自動進入，不用重新掃描。班級代號 ${esc(KEY)}</span></div>`)}</div>`;
  if (S.phase === "loading") return `<div class="st-main"><p class="muted">連線中…</p></div>`;
  if (S.phase === "seat") return seatView();
  if (S.phase === "pending") return `<div class="st-main">${coverCard(S.session && S.session.lesson, S.session && S.session.label)}<div class="login-box" style="margin-top:0"><h1>等老師確認</h1><p>${S.seat} 號已經在另一台平板登入。老師按「允許」後，這台就能開始用，之前送出的作答都還在。</p><p class="muted small">如果你輸錯座號，請舉手請老師幫你登出這台。</p></div></div>`;
  const p = curPage();
  const st = S.session.state || {};
  const t = st.timer;
  let h = `<div class="st-top"><span class="who">第 ${S.group} 組・<b>${S.seat} 號</b></span>`;
  if (LESSONS[lessonNo()].usesAI && iAmAI()) h += `<span class="tag me">本節 AI 操作員</span>`;
  if (p.scope === "g") {
    const slot = p.type === "cards" && ps(p).seg === 2 ? p.slot2 : p.slot;
    const rs = repSeat(slot);
    h += rs === S.seat ? `<span class="tag me">這一題由你送出</span>` : rs ? `<span class="tag">這一題由 ${rs} 號送出</span>` : "";
  }
  h += t && t.end ? `<span class="timer" data-timer></span>` : "";
  h += `</div><div id="netbar" class="banner bad" style="border-radius:0" ${S.net ? "hidden" : ""}>網路中斷，正在重新連線…你寫的內容會先存在這台平板。</div>`;
  h += `<div class="st-main">`;
  h += lingerBanner(p);
  if (p.type !== "login") h += `<div class="st-head"><span class="pg"><b>${esc(p.id)}</b>${esc(p.time)}</span><h1>${esc(p.title)}</h1>${p.sub ? `<span class="muted">${esc(p.sub)}</span>` : ""}</div>`;
  h += gate(p);
  h += body(p);
  h += `</div>`;
  return h;
}
function lingerBanner(p) {
  if (S.linger) return `<button class="linger" data-act="unlinger">回到老師現在的頁面</button>`;
  const L = LESSONS[lessonNo()];
  const lp = L.pages.find(x => x.linger);
  if (!lp || lp.id === p.id || !pstate(S.session.state, lp.id).open) return "";
  const row = S.grp.find(r => r.page === lp.id);
  const done = row && row.data && row.data.ai && row.data.ai.handed && row.sent;
  if (done) return "";
  return `<button class="linger" data-act="linger" data-page="${lp.id}">還沒完成：${lp.id} ${esc(lp.title)}（點這裡回去）</button>`;
}
function gate(p) {
  if (!answerable(p)) return "";
  const s = ps(p);
  if (s.open) return "";
  if (s.ended || s.published) return `<div class="banner info">老師已結束作答，內容不能再修改。</div>`;
  return `<div class="banner wait"><b>等老師按「開始」</b>　現在只能看，還不能作答。</div>`;
}
function statusBox(p, part) { return `<div class="status-line" data-status data-page="${p.id}" ${part ? `data-part="${part}"` : ""}>${statusHTML(p, part)}</div>`; }
function memberNote(p, slot) {
  if (p.scope !== "g") return "";
  const rs = repSeat(slot || p.slot);
  if (rs === S.seat) return "";
  return `<div class="banner info">組員畫面：同步顯示 ${rs || "代表"} 號的作答，一起討論，由代表送出。</div>`;
}
const dis = ok => ok ? "" : "disabled";

function body(p) {
  switch (p.type) {
    case "login": return coverCard(lessonNo(), S.session.label, `<div class="cv-ok">登入成功：你是第 ${S.group} 組 ${S.seat} 號<br><span>畫面會自動跟著老師換頁</span></div>`);
    case "vote": return voteView(p);
    case "wall": return wallView(p);
    case "reveal": return revealView(p);
    case "info": return infoView(p);
    case "sort": return sortView(p);
    case "judge": return judgeView(p);
    case "form": return formView(p);
    case "feedback": return feedbackView(p);
    case "glove": return gloveView(p);
    case "voice": return voiceView(p);
    case "cards": return cardsView(p);
    case "aicompare": return aiView(p);
    case "tricolor": return triView(p);
    case "pickone": return pickView(p);
  }
  return "";
}
function img(name) { return name ? `<img class="st-img" src="${IMAGES[name]}" alt="">` : ""; }

function voteView(p) {
  const v = val(p), ed = isEditor(p);
  let h = p.panels ? panelImage(p, ps(p)) : img(ps(p).reveal2 && p.revealImg ? p.revealImg : p.img);
  if (p.caption) h += `<p class="muted">${esc(p.caption)}</p>`;
  if (p.intro) h += `<div class="soft small">${esc(p.intro)}</div>`;
  if (p.intro3) h += `<div class="stack">${p.intro3.slice(0, ps(p).step || 0).map(([a, b]) => `<div class="soft"><b>${esc(a)}</b>　${esc(b)}</div>`).join("")}</div>`;
  if (p.question) h += `<h2 style="font-size:1.15rem">${esc(p.question)}</h2>`;
  h += `<div class="big-choices">${p.options.map(o => `<button data-act="vote" data-v="${esc(o)}" aria-pressed="${v.choice === o}" ${dis(ed)}>${esc(o)}</button>`).join("")}</div>`;
  h += statusBox(p);
  const s = ps(p);
  if (p.lines && s.step) h += `<div class="stack">${p.lines.slice(0, p.intro3 ? Math.max(0, s.step - p.intro3.length) : s.step).map(l => `<div class="banner ok">${esc(l)}</div>`).join("")}</div>`;

  return h;
}
function wallView(p) {
  const v = val(p), ed = isEditor(p);
  let h = img(p.img);
  if (p.source) h += `<p class="small muted">出處：${esc(p.source)}</p>`;
  h += `<label class="lab" for="w-${p.id}">${esc(p.prompt)}</label><textarea id="w-${p.id}" data-bind="wall" maxlength="${p.max || 100}" placeholder="${esc(p.placeholder || "")}" ${dis(ed)}>${esc(v.text || "")}</textarea>`;
  h += `<div class="row"><button class="btn primary" data-act="send" ${dis(ed && (v.text || "").trim())}>貼到投影</button>${statusBox(p)}</div>`;
  h += `<p class="small muted">投影上不會顯示你的座號。</p>`;
  const s = ps(p);
  if (p.lines && s.step) h += `<div class="stack"><b>${esc(p.revealTitle || "")}</b>${p.lines.slice(0, s.step).map((l, i) => `<div class="soft">${i + 1}. ${esc(l)}</div>`).join("")}</div>`;
  return h;
}
function revealView(p) {
  const n = ps(p).step || 0;
  return `<div class="stack">${p.rows.map(([a, b], i) => `<div class="soft row"><span style="flex:1">${esc(a)}</span><b style="color:var(--green)">${i < n ? esc(b) : "？"}</b></div>`).join("")}</div>`;
}
function defsHTML() { return `<div class="stack">${STAGES.map((s, i) => `<div class="soft"><b style="color:var(--green)">${i + 1}　${s}</b><br>${esc(DESC_CARDS[DESC_ORDER[i]])}</div>`).join("")}</div>`; }
function infoView(p) {
  if (p.story) return needStory(p, ps(p));
  let h = "";
  if (p.defs) h += defsHTML();
  h += p.panels ? panelImage(p, ps(p)) : img(p.img);
  if (p.pair) h += `<div class="stack">${p.pair.map(([a, b]) => `<div class="soft"><b style="color:var(--green)">${esc(a)}</b><br>${esc(b)}</div>`).join("")}</div>`;
  const n = ps(p).step || 0;
  if (p.lines && n) h += `<div class="stack">${p.lines.slice(0, n).map(l => `<div class="soft">${esc(l)}</div>`).join("")}</div>`;
  if (p.foot) h += `<p class="small muted">${esc(p.foot)}</p>`;
  return h;
}

/* 1-5 排序 */
function sortView(p) {
  const row = server(p) || {}, att = row.attempts || [];
  const last = att[att.length - 1];
  const won = att.some(a => a.orderOk && a.descOk);
  const left = 2 - att.length;
  const ed = isEditor(p) && !won && left > 0;
  const v = val(p);
  if (!v.order) v.order = [null, null, null, null, null, null];
  if (!v.desc) v.desc = ["", "", "", "", "", ""];
  const seed = CODE + ":g" + S.group;
  const pool = seededShuffle(STAGES, seed + ":n").filter(n => !v.order.includes(n));
  const codes = seededShuffle(Object.keys(DESC_CARDS), seed + ":d");
  let h = `<p>${esc(p.help)}</p>` + memberNote(p);
  if (won) h += `<div class="banner ok">全部答對！看投影等老師公布排名。</div>`;
  else if (last) h += `<div class="banner ${last.orderOk && last.descOk ? "ok" : "bad"}">順序：${last.orderOk ? "對" : "錯"}｜說明：${last.descOk ? "對" : "錯"}${left > 0 ? `，還剩 ${left} 次機會` : "，兩次機會用完了，等老師公布答案"}</div>`;
  h += `<div class="small muted">點名稱卡放進下一格；點已放好的卡可以拿回來。</div>`;
  h += `<div class="sort-pool">${pool.length ? pool.map(n => `<button class="namecard" data-act="pick" data-n="${n}" ${dis(ed)}>${n}</button>`).join("") : `<span class="muted small">名稱卡都放好了</span>`}</div>`;
  h += `<div class="sort-slots">${v.order.map((n, i) => `<div class="sort-slot"><span class="n">${i + 1}</span><div class="box">
    <button class="nm ${n ? "filled" : ""}" data-act="unpick" data-i="${i}" ${dis(ed && n)}>${n || `第 ${i + 1} 個階段`}</button>
    <select id="sd-${i}" data-bind="sortdesc" data-i="${i}" ${dis(ed)} aria-label="第 ${i + 1} 格的說明"><option value="">選說明…</option>${codes.map(c => `<option value="${c}" ${v.desc[i] === c ? "selected" : ""}>${c}　${esc(DESC_CARDS[c])}</option>`).join("")}</select>
  </div></div>`).join("")}</div>`;
  if (!won && left > 0) h += `<button class="btn go block" data-act="sortsend" ${dis(ed && v.order.every(Boolean) && v.desc.every(Boolean))}>送出（第 ${att.length + 1} 次，共 2 次）</button>`;
  return h;
}

/* 1-7 判斷 AI 計畫 */
function judgeView(p) {
  const v = val(p), ed = isEditor(p);
  if (!v.rows) v.rows = p.rows.map(() => ({}));
  let h = memberNote(p) + `<p class="small muted">每一列選「放對／放錯／太籠統」，依據從課本定義（1-5 的說明）選一條。選放錯要再選應該在哪個階段；選太籠統要寫一句改寫。</p>`;
  h += p.rows.map(([stage, text], i) => {
    const r = v.rows[i] || {};
    return `<div class="jrow"><div><span class="stage">${i + 1}．${stage}</span>　${esc(text)}</div>
      <div class="seg3">${[["對", "放對", "v-ok"], ["錯", "放錯", "v-bad"], ["籠統", "太籠統", "v-vague"]].map(([k, l, c]) => `<button class="${c}" data-act="jv" data-i="${i}" data-v="${k}" aria-pressed="${r.v === k}" ${dis(ed)}>${l}</button>`).join("")}</div>
      <select id="jb-${i}" data-bind="jbasis" data-i="${i}" ${dis(ed)} aria-label="依據"><option value="">依據：選一條課本定義…</option>${DESC_ORDER.map(c => `<option value="${c}" ${r.basis === c ? "selected" : ""}>${c}　${esc(DESC_CARDS[c])}</option>`).join("")}</select>
      ${r.v === "錯" ? `<select id="jt-${i}" data-bind="jto" data-i="${i}" ${dis(ed)} aria-label="應該在哪個階段"><option value="">應該放在哪個階段？</option>${STAGES.map(s => `<option ${r.to === s ? "selected" : ""}>${s}</option>`).join("")}</select>` : ""}
      ${r.v === "籠統" ? `<input type="text" id="jr-${i}" data-bind="jrew" data-i="${i}" placeholder="改寫成具體的一句，例如寫出尺寸、材料" value="${esc(r.rewrite || "")}" ${dis(ed)}>` : ""}
    </div>`;
  }).join("");
  const complete = v.rows.length === p.rows.length && v.rows.every(r => r.v && r.basis && (r.v !== "錯" || r.to) && (r.v !== "籠統" || (r.rewrite || "").trim()));
  h += `<div class="row"><button class="btn go" data-act="send" ${dis(ed && complete)}>送出六列判斷</button>${statusBox(p)}</div>`;
  if (ed && !complete) h += `<p class="small muted">六列都要選完才能送出。</p>`;
  return h;
}

/* 小組表單：1-8、2-12 */
function formView(p) {
  const v = val(p), ed = isEditor(p);
  let h = memberNote(p);
  p.fields.forEach(f => {
    if (f.kind === "product") {
      const pr = v.product || {};
      h += `<div><label class="lab">${esc(f.label)}</label><div class="pillset">${[...PRODUCTS, "其他"].map(x => `<button data-act="prod" data-v="${esc(x)}" aria-pressed="${pr.choice === x}" ${dis(ed)}>${esc(x)}</button>`).join("")}</div>
        ${pr.choice === "其他" ? `<input type="text" id="f-other" data-bind="f" data-k="product.other" placeholder="自己輸入產品" value="${esc(pr.other || "")}" ${dis(ed)} style="margin-top:8px">` : ""}</div>`;
    } else if (f.kind === "text") {
      h += `<div><label class="lab" for="f-${f.key}">${esc(f.label)}</label><input type="text" id="f-${f.key}" data-bind="f" data-k="${f.key}" placeholder="${esc(f.placeholder || "")}" value="${esc(v[f.key] || "")}" ${dis(ed)}></div>`;
    } else if (f.kind === "stages") {
      const a = v[f.key] || [];
      h += `<div><label class="lab">${esc(f.label)}</label><p class="small muted" style="margin:0 0 6px">還不確定的階段，可以先寫「還不確定，要再查」。後面幾節還會再修改。</p><div class="stack">${STAGES.map((s, i) => { const hint = f.hints && f.hints[i]; return `<div class="stagebox"><label for="f-st${i}"><b>${i + 1}　${s}</b>${hint ? `<span>${esc(hint[0])}</span>` : ""}</label><input type="text" id="f-st${i}" data-bind="f" data-k="${f.key}.${i}" placeholder="${esc(hint ? hint[1] : "")}" value="${esc(a[i] || "")}" ${dis(ed)}></div>`; }).join("")}</div></div>`;
    } else if (f.kind === "list3") {
      const a = v[f.key] || [];
      h += `<div><label class="lab">${esc(f.label)}</label><div class="stack">${[0, 1, 2].map(i => `<input type="text" id="f-l${i}" data-bind="f" data-k="${f.key}.${i}" placeholder="需求 ${i + 1}" value="${esc(a[i] || "")}" ${dis(ed)}>`).join("")}</div></div>`;
    }
  });
  const ok = p.id === "1-8" ? v.product && v.product.choice && (v.product.choice !== "其他" || (v.product.other || "").trim()) && (v.pain || "").trim()
    : (v.target || "").trim();
  h += `<div class="row"><button class="btn go" data-act="send" ${dis(ed && ok)}>送出</button>${statusBox(p)}</div>`;
  return h;
}
function feedbackView(p) {
  const v = val(p), ed = isEditor(p);
  const a = v.a || [];
  let h = `<div class="banner info">每人自己寫，只有老師看得到。你的想法可以跟小組不一樣，說得出理由就好。</div>`;
  h += p.questions.map((q, i) => `<div><label class="lab" for="fb-${i}">${i + 1}. ${esc(q)}</label><textarea id="fb-${i}" data-bind="fb" data-i="${i}" ${dis(ed)}>${esc(a[i] || "")}</textarea></div>`).join("");
  h += `<div class="row"><button class="btn go" data-act="send" ${dis(ed && p.questions.every((_, i) => (a[i] || "").trim()))}>送出回饋</button>${statusBox(p)}</div>`;
  return h;
}

/* 2-2 手套挑戰 */
function gloveView(p) {
  const v = val(p), ed = isEditor(p), s = ps(p), round = s.round || 1;
  let h = `<div class="soft"><b>三個動作</b><ol style="margin:6px 0 0 1.2em;padding:0">${GLOVE_ACTIONS.map(a => `<li>${esc(a)}</li>`).join("")}</ol></div>`;
  h += `<div class="banner info">${s.phase === "reset" ? "道具復位・準備第二輪（30 秒）：先把水倒回瓶子，再轉緊瓶蓋。其餘：瓶蓋轉緊、水倒回瓶子、卡片放回夾鏈袋並壓緊、迴紋針放回桌上" : round === 1 ? "第一輪：戴手套，45 秒" : "第二輪：換人，一樣戴手套，一隻手抓著椅背，只能用單手，45 秒"}</div>`;
  h += `<p class="small muted">你是觀察員：每個動作都要選。卡住的寫一句怎麼卡住的。這一頁每個人都可以送出。</p>`;
  [1, 2].forEach(r => {
    if (r === 2 && round < 2) return;
    const rv = v["r" + r] || {};
    h += `<div class="card stack"><h2 style="font-size:1.1rem">第${r === 1 ? "一" : "二"}輪觀察</h2>`;
    GLOVE_ACTIONS.forEach((a, i) => {
      h += `<div><div class="small" style="font-weight:700">${i + 1}. ${esc(a)}</div><div class="pillset" style="margin-top:4px">${GLOVE_CHOICES.map(c => `<button data-act="glove" data-r="${r}" data-i="${i}" data-v="${c}" aria-pressed="${rv["a" + i] === c}" ${dis(ed)}>${c}</button>`).join("")}</div>
        ${rv["a" + i] === "卡住了" ? `<input type="text" id="gw-${r}-${i}" style="margin-top:6px" data-bind="glovew" data-r="${r}" data-i="${i}" placeholder="怎麼卡住的？" value="${esc(rv["w" + i] || "")}" ${dis(ed)}>` : ""}</div>`;
    });
    h += `</div>`;
  });
  const rv = v["r" + round] || {};
  h += `<div class="row"><button class="btn go" data-act="send" ${dis(ed && [0, 1, 2].every(i => rv["a" + i]))}>送出第${round === 1 ? "一" : "二"}輪觀察</button>${statusBox(p)}</div>`;
  return h;
}

/* 2-6 心聲卡 */
function voiceView(p) {
  const v = val(p), ed = isEditor(p), prod = product();
  const qs2 = v.unused ? p.unused : p.used;
  const a = v.a || [];
  let h = activityGuide("voice") + `<p class="small muted">每題一句就好，可以用語音輸入。投影上只顯示內容，不顯示座號。</p>`;
  h += `<label class="row"><input type="checkbox" id="v-unused" data-act="unused" ${v.unused ? "checked" : ""} ${dis(ed)}> 我沒用過${esc(prod || "這個產品")}</label>`;
  h += qs2.map((q, i) => `<div><label class="lab" for="v-${i}">${i + 1}. ${esc(fillProduct(q, prod))}${v.unused && i === 2 ? `<span class="chip warn" style="margin-left:6px">這一題會標成「猜的」</span>` : ""}</label><textarea id="v-${i}" data-bind="voice" data-i="${i}" ${dis(ed)}>${esc(a[i] || "")}</textarea></div>`).join("");
  h += `<div class="row"><button class="btn go" data-act="send" ${dis(ed && [0, 1, 2].every(i => (a[i] || "").trim()))}>送出心聲卡</button>${statusBox(p)}</div>`;
  return h;
}

/* 2-7 唸卡、抽卡、整理需求 */
function cardsView(p) {
  const s = ps(p), seg = s.seg || 1, row = server(p) || {}, d = row.data || {};
  const cards = d.cards || [];
  let h = activityGuide(seg === 1 ? "cards1" : "cards2");
  if (seg === 2) h += `<details><summary>查看心聲卡與兩張角色卡（參考資料）</summary>`;
  h += `<div class="card stack"><h2 style="font-size:1.1rem">我們組的心聲卡（${S.voices.length} 張）</h2>`;
  h += S.voices.length ? S.voices.map((vc, i) => `<div class="voicecard"><b>卡 ${i + 1}</b>${vc.unused ? `<span class="chip warn" style="margin-left:6px">沒用過</span>` : ""}<br>${(vc.a || []).map((x, k) => `${esc(x)}${vc.unused && k === 2 ? `<span class="chip warn">猜的</span>` : ""}`).join("<br>")}</div>`).join("")
    : `<p class="muted small">還沒有心聲卡。</p>`;
  h += `</div>`;
  const repA = repSeat(p.slot), canA = isOpen(p) && iAmRep(p.slot) && seg === 1;
  h += `<div class="card stack"><h2 style="font-size:1.1rem">角色卡</h2><p class="small muted">由 ${repA} 號唸卡，唸完按「抽卡」，抽兩張角色卡。</p>`;
  if (!cards.length) h += `<button class="btn gold" data-act="draw" ${dis(canA)}>抽卡</button>`;
  else {
    h += `<div class="rolecards">${cards.map(c => { const rc = ROLE_CARDS[c]; return `<div class="rolecard"><h3>${esc(rc.name)}</h3><div>${esc(rc.say)}</div><div class="small"><b>想一想：</b>${esc(rc.think)}</div>${rc.img ? img(rc.img) : ""}<div class="note">${ROLE_NOTE}</div></div>`; }).join("")}</div>`;
    if (d.swap) h += `<p class="small muted">已換過一次卡（${esc(ROLE_CARDS[d.swap.from].name)} → ${esc(ROLE_CARDS[d.swap.to].name)}）</p>`;
    else if (canA) {
      const sw = S.local["2-7.swap"] || { card: "", reason: "", other: "" };
      h += `<details class="box"><summary>真的用不上？換一張（每組限一次）</summary><div class="stack" style="margin-top:8px">
        <select id="sw-card" data-bind="swap" data-k="card"><option value="">要換掉哪一張？</option>${cards.map(c => `<option value="${c}" ${String(sw.card) === String(c) ? "selected" : ""}>${esc(ROLE_CARDS[c].name)}</option>`).join("")}</select>
        <select id="sw-reason" data-bind="swap" data-k="reason"><option value="">換卡原因</option>${["這個情境不會用到這個產品", "其他"].map(r => `<option ${sw.reason === r ? "selected" : ""}>${r}</option>`).join("")}</select>
        ${sw.reason === "其他" ? `<input type="text" id="sw-other" data-bind="swap" data-k="other" placeholder="其他原因" value="${esc(sw.other)}">` : ""}
        <button class="btn" data-act="swap" ${dis(sw.card && sw.reason && (sw.reason !== "其他" || sw.other.trim()))}>換一張</button></div></details>`;
    }
  }
  h += `</div>`;
  if (seg === 2) h += `</details>`;
  // 第二段：整理需求
  const repB = repSeat(p.slot2);
  h += `<div class="card stack"><h2 style="font-size:1.1rem">需求清單（至少 3 條）</h2>`;
  if (seg < 2) { h += `<p class="muted small">等老師進到第二段，由 ${repB} 號整理需求。</p></div>`; return h; }
  const ed = isEditor(p, "needs");
  if (!ed && repB !== S.seat) h += `<div class="banner info">同步顯示 ${repB} 號整理的需求清單。</div>`;
  const needs = val(p, "needs") || [];
  const list = needs.length ? needs : [{}, {}, {}];
  if (!needs.length && ed) setVal(p, "needs", list);
  h += list.map((n, i) => {
    const src = n.src || {};
    return `<div class="needrow"><b>第 ${i + 1} 條</b>
      <input type="text" id="n-${i}-who" data-bind="need" data-i="${i}" data-k="who" placeholder="誰：例如 上課一整天的學生" value="${esc(n.who || "")}" ${dis(ed)}>
      <input type="text" id="n-${i}-when" data-bind="need" data-i="${i}" data-k="when" placeholder="在什麼情況下：例如 下午在座位上" value="${esc(n.when || "")}" ${dis(ed)}>
      <input type="text" id="n-${i}-need" data-bind="need" data-i="${i}" data-k="need" placeholder="需要什麼：寫需要，不要只寫功能名稱" value="${esc(n.need || "")}" ${dis(ed)}>
      <div class="small muted">來源（可複選）</div>
      <div class="srcset">
        ${S.voices.map((_, k) => `<label><input type="checkbox" data-act="src" data-i="${i}" data-t="voice" data-v="${k + 1}" ${(src.voice || []).includes(k + 1) ? "checked" : ""} ${dis(ed)}>心聲卡 ${k + 1}</label>`).join("")}
        ${cards.map(c => `<label><input type="checkbox" data-act="src" data-i="${i}" data-t="role" data-v="${c}" ${(src.role || []).includes(c) ? "checked" : ""} ${dis(ed)}>${esc(ROLE_CARDS[c].name)}</label>`).join("")}
        <label><input type="checkbox" data-act="src" data-i="${i}" data-t="glove" ${src.glove ? "checked" : ""} ${dis(ed)}>手套挑戰</label>
        <label><input type="checkbox" data-act="src" data-i="${i}" data-t="guess" ${src.guess ? "checked" : ""} ${dis(ed)}>自己猜的</label>
      </div></div>`;
  }).join("");
  if (ed) h += `<button class="btn ghost" data-act="addneed">＋ 再加一條</button>`;
  const filled = list.filter(n => (n.who || "").trim() && (n.need || "").trim());
  h += `<div class="row"><button class="btn go" data-act="sendpart" data-part="needs" ${dis(ed && filled.length >= 3)}>送出需求清單</button>${statusBox(p, "needs")}</div></div>`;
  return h;
}

/* 2-8 AI 比對 */
function aiView(p) {
  const row = server(p) || {}, d = row.data || {}, prod = product();
  const sai = d.ai || {};
  let h = "";
  h += activityGuide("ai");
  const own = S.grp.find(r => r.page === "2-7");
  const ownNeeds = own && own.data && own.data.needs || [];
  if (ownNeeds.length) h += `<details open><summary>我們上一頁整理的需求（拿來比對）</summary>${ownNeeds.map(n => `<div class="soft">${esc(n.who)}・${esc(n.when)}：${esc(n.need)}</div>`).join("")}</details>`;
  const aiS = aiSeat();
  if (iAmAI() && !sai.handed) {
    const ai = val(p, "ai") || {};
    const prompt = fillProduct(p.prompt, prod);
    const lines = ai.lines || parseAILines(ai.raw);
    h += `<div class="card stack"><h2 style="font-size:1.1rem">AI 操作員（你）</h2>
      <div class="soft" id="ai-prompt">${esc(prompt)}</div>
      <div class="row"><button class="btn" data-act="copy" data-text="${esc(prompt)}">複製問法</button><a class="btn primary" href="https://gemini.google.com/app" target="_blank" rel="noopener" style="text-decoration:none">開啟 Gemini（新分頁）</a></div>
      <p class="small muted">在 Gemini 貼上問法 → 複製回答 → 按上方分頁切回這裡，貼進下面。不要在 Gemini 輸入姓名、座號、照片。</p>
      <label class="lab" for="ai-raw">AI 回答區</label><textarea id="ai-raw" data-bind="airaw" style="min-height:140px" placeholder="把 Gemini 的回答貼在這裡" ${dis(isEditor(p, "ai"))}>${esc(ai.raw || "")}</textarea>
      ${lines.length ? `<div class="small muted">網站拆成 ${lines.length} 條。刪掉不是需求的行（例如開頭說明、總結句）：</div>${lines.map((l, i) => `<div class="ailine"><span>${esc(l)}</span><button class="btn ghost sm" data-act="aidel" data-i="${i}" ${dis(isEditor(p, "ai"))}>刪掉</button></div>`).join("")}` : ""}
      <button class="btn go" data-act="hand" ${dis(isEditor(p, "ai") && lines.length)}>交給全組判斷</button>
      ${statusBox(p, "ai")}</div>`;
  } else if (!sai.handed) {
    const lines = sai.lines || parseAILines(sai.raw);
    h += `<div class="banner wait">等 AI 操作員（${aiS} 號）問 Gemini，再把回答貼回來。</div>`;
    if (lines.length) h += `<div class="stack">${lines.map(l => `<div class="soft small">${esc(l)}</div>`).join("")}</div>`;
    if (sai.backup) h += `<p class="small muted">老師已貼上備用回答。</p>`;
  }
  if (sai.handed) {
    const lines = sai.lines || [];
    const ed = isEditor(p, "judge");
    const j = val(p, "judge") || {};
    h += memberNote(p);
    if (sai.backup) h += `<p class="small muted">這是老師貼上的備用回答${prod ? "" : "，請先把產品名稱換成你們的產品再判斷"}。</p>`;
    h += lines.map((l, i) => {
      const r = j[l] || {};
      return `<div class="jrow"><div>${i + 1}．${esc(l)}</div>
        <div class="row small"><span style="min-width:8em">我們有想到嗎</span><div class="pillset">${["有", "沒有"].map(x => `<button data-act="aij" data-l="${esc(l)}" data-k="t" data-v="${x}" aria-pressed="${r.t === x}" ${dis(ed)}>${x}</button>`).join("")}</div></div>
        <div class="row small"><span style="min-width:8em">有根據嗎</span></div>
        <div class="color3">${Object.entries(COLORS).map(([k, c]) => `<button class="c-${k}" data-act="aij" data-l="${esc(l)}" data-k="c" data-v="${k}" aria-pressed="${r.c === k}" ${dis(ed)}>${c.label}　${c.name}</button>`).join("")}</div></div>`;
    }).join("");
    const complete = lines.length && lines.every(l => j[l] && j[l].t && j[l].c);
    h += `<div class="row"><button class="btn go" data-act="sendpart" data-part="judge" ${dis(ed && complete)}>送出判斷</button>${statusBox(p, "judge")}</div>`;
  }
  return h;
}

/* 2-9 三色牌 */
function colorsLegend() { return `<div class="stack small">${Object.entries(COLORS).map(([k, c]) => `<div><span class="dot ${k}"></span> <b>${c.label}（${c.name}）</b>：${esc(c.desc)}</div>`).join("")}<div class="muted">兩種顏色都說得通時，選一個並寫出理由。顏色不是重點，說得出依據才是。</div></div>`; }
function triView(p) {
  const v = val(p), ed = isEditor(p);
  let h = memberNote(p);
  h += `<div class="soft" style="font-size:1.1rem"><b>AI 說：</b>「${esc(p.quote)}」</div>`;
  h += `<div class="banner wait small"><b>證據：</b>${esc(p.evidence.text)}（看投影）</div>`;
  h += colorsLegend();
  h += `<div class="color3">${Object.entries(COLORS).map(([k, c]) => `<button class="c-${k}" data-act="tri" data-v="${k}" aria-pressed="${v.c === k}" ${dis(ed)}>${c.label}　${c.name}</button>`).join("")}</div>`;
  h += `<label class="lab" for="tri-why">依據（一句）</label><textarea id="tri-why" data-bind="triwhy" ${dis(ed)}>${esc(v.why || "")}</textarea>`;
  h += `<div class="row"><button class="btn go" data-act="send" ${dis(ed && v.c && (v.why || "").trim())}>送出</button>${statusBox(p)}</div>`;
  return h;
}
/* 2-10 最值得討論的一條 */
function pickView(p) {
  const v = val(p), ed = isEditor(p);
  const ai = ((S.grp.find(r => r.page === "2-8") || {}).data || {}).ai || {};
  const lines = ai.lines || [];
  let h = memberNote(p);
  if (!lines.length) return h + `<div class="banner wait">你們組在 2-8 還沒有 AI 的條列。</div>`;
  h += `<div class="stack">${lines.map((l, i) => `<label class="soft row" style="cursor:pointer"><input type="radio" name="pick" data-act="pickl" data-v="${esc(l)}" ${v.line === l ? "checked" : ""} ${dis(ed)}> <span style="flex:1">${esc(l)}</span></label>`).join("")}</div>`;
  h += `<div class="color3">${Object.entries(COLORS).map(([k, c]) => `<button class="c-${k}" data-act="pickc" data-v="${k}" aria-pressed="${v.c === k}" ${dis(ed)}>${c.label}　${c.name}</button>`).join("")}</div>`;
  h += `<label class="lab" for="pick-why">依據</label><textarea id="pick-why" data-bind="pickwhy" ${dis(ed)}>${esc(v.why || "")}</textarea>`;
  h += `<div class="row"><button class="btn go" data-act="send" ${dis(ed && v.line && v.c && (v.why || "").trim())}>送到投影</button>${statusBox(p)}</div>`;
  return h;
}

/* ---------- 登入畫面 ---------- */
function codeView() {
  return `<div class="st-main"><div class="login-box"><h1>課堂登入</h1>
    <label class="lab" for="code-in">輸入投影上的課堂代碼（4 位數）</label>
    <input type="text" inputmode="numeric" id="code-in" data-bind="code" maxlength="4" value="${esc(S.codeInput)}" autocomplete="off">
    ${S.msg ? `<div class="banner bad">${esc(S.msg)}</div>` : ""}
    <button class="btn primary block" data-act="code" ${dis(S.codeInput.length === 4)}>下一步</button></div></div>`;
}
function seatView() {
  const seats = S.session && S.session.seats || 28;
  return `<div class="st-main">${coverCard(S.session && S.session.lesson, S.session && S.session.label)}<div class="login-box" style="margin-top:0"><h1>輸入你的座號</h1>
    <p class="muted small">課堂代碼 ${esc(CODE)}</p>
    <input type="text" inputmode="numeric" id="seat-in" data-bind="seat" maxlength="2" value="${esc(S.seatInput)}" autocomplete="off" placeholder="座號">
    ${S.msg ? `<div class="banner bad">${esc(S.msg)}</div>` : ""}
    <button class="btn primary block" data-act="join" ${dis(+S.seatInput >= 1 && +S.seatInput <= seats)}>登入</button>
    <button class="btn ghost sm" data-act="changecode">換一個課堂代碼</button></div></div>`;
}

/* ---------- 事件 ---------- */
document.addEventListener("click", async e => {
  const t = e.target.closest("[data-act]");
  if (!t || t.disabled) return;
  const a = t.dataset.act;
  if (a === "code") { CODE = S.codeInput; LS.set("lesson-code", CODE); S.msg = ""; S.phase = "loading"; render(true); poll(); return; }
  if (a === "changecode") { CODE = ""; KEY = ""; LS.del("lesson-code"); LS.del("lesson-class"); S.phase = "code"; S.msg = ""; render(true); return; }
  if (a === "join") {
    t.disabled = true;
    const r = await rpc("lesson_join", { p_code: CODE, p_seat: +S.seatInput, p_device: DEVICE });
    if (r && r.ok) { S.msg = ""; poll(); }
    else { S.msg = r && r.error === "BAD_SEAT" ? "沒有這個座號，請再確認。" : "登入失敗，請再試一次。"; render(true); }
    return;
  }
  if (S.phase !== "active") return;
  const p = curPage();
  if (a === "linger") { S.linger = t.dataset.page; S.lastPage = S.linger; render(true); window.scrollTo(0, 0); return; }
  if (a === "unlinger") { S.linger = null; S.lastPage = effPageId(); render(true); window.scrollTo(0, 0); return; }
  if (a === "copy") {
    const txt = t.dataset.text;
    try { await navigator.clipboard.writeText(txt); toast("已複製問法"); }
    catch (err) { const el = document.getElementById("ai-prompt"); const rg = document.createRange(); rg.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(rg); toast("請按 Ctrl＋C 複製"); }
    return;
  }
  const v = val(p);
  fillDefaults(p, v);
  switch (a) {
    case "vote": setVal(p, null, { choice: t.dataset.v }); save(p, null, true); break;
    case "send": save(p, null, true); break;
    case "sendpart": save(p, t.dataset.part, true); break;
    case "pick": { const i = v.order.indexOf(null); if (i >= 0) { v.order[i] = t.dataset.n; setVal(p, null, v); queueDraft(p); render(true); } break; }
    case "unpick": v.order[+t.dataset.i] = null; setVal(p, null, v); queueDraft(p); render(true); break;
    case "sortsend": {
      t.disabled = true;
      const r = await rpc("lesson_sort_submit", { p_code: CODE, p_device: DEVICE, p_order: v.order, p_desc: v.desc, p_req: uid() });
      if (!r || !r.ok) toast(r && r.error === "CLOSED" ? "老師已經結束作答。" : r && r.error === "NO_TRIES" ? "兩次機會已經用完。" : "沒有送出成功，請再按一次。");
      poll(); break;
    }
    case "jv": { v.rows = v.rows || []; v.rows[+t.dataset.i] = Object.assign({}, v.rows[+t.dataset.i], { v: t.dataset.v }); setVal(p, null, v); queueDraft(p); render(true); break; }
    case "prod": v.product = Object.assign({}, v.product, { choice: t.dataset.v }); setVal(p, null, v); queueDraft(p); render(true); break;
    case "glove": { const k = "r" + t.dataset.r; v[k] = Object.assign({}, v[k], { ["a" + t.dataset.i]: t.dataset.v }); setVal(p, null, v); queueDraft(p); render(true); break; }
    case "unused": v.unused = t.checked; setVal(p, null, v); queueDraft(p); render(true); break;
    case "draw": {
      t.disabled = true;
      const r = await rpc("lesson_draw_cards", { p_code: CODE, p_device: DEVICE, p_swap: null, p_reason: null, p_req: uid() });
      if (!r || !r.ok) toast("抽卡失敗，請再按一次。"); poll(); break;
    }
    case "swap": {
      const sw = S.local["2-7.swap"] || {};
      t.disabled = true;
      const r = await rpc("lesson_draw_cards", { p_code: CODE, p_device: DEVICE, p_swap: +sw.card, p_reason: sw.reason === "其他" ? "其他：" + sw.other : sw.reason, p_req: uid() });
      if (!r || !r.ok) toast(r && r.error === "NO_SWAP" ? "已經換過一次了。" : "換卡失敗，請再按一次。"); poll(); break;
    }
    case "addneed": { const n = (val(p, "needs") || []).slice(); n.push({}); setVal(p, "needs", n); queueDraft(p, "needs"); render(true); break; }
    case "src": {
      const n = (val(p, "needs") || []).slice(); const i = +t.dataset.i; const row = Object.assign({}, n[i]); const src = Object.assign({}, row.src);
      if (t.dataset.t === "voice" || t.dataset.t === "role") {
        const arr = (src[t.dataset.t] || []).slice(); const x = +t.dataset.v; const k = arr.indexOf(x);
        if (t.checked && k < 0) arr.push(x); if (!t.checked && k >= 0) arr.splice(k, 1); src[t.dataset.t] = arr.sort((a, b) => a - b);
      } else src[t.dataset.t] = t.checked;
      row.src = src; n[i] = row; setVal(p, "needs", n); queueDraft(p, "needs"); break;
    }
    case "aidel": { const ai = Object.assign({}, val(p, "ai")); const lines = (ai.lines || parseAILines(ai.raw)).slice(); lines.splice(+t.dataset.i, 1); ai.lines = lines; setVal(p, "ai", ai); queueDraft(p, "ai"); render(true); break; }
    case "hand": { const ai = Object.assign({}, val(p, "ai")); ai.lines = ai.lines || parseAILines(ai.raw); ai.handed = true; setVal(p, "ai", ai); save(p, "ai", false); break; }
    case "aij": { const j = Object.assign({}, val(p, "judge")); const l = t.dataset.l; j[l] = Object.assign({}, j[l], { [t.dataset.k]: t.dataset.v }); setVal(p, "judge", j); queueDraft(p, "judge"); render(true); break; }
    case "tri": v.c = t.dataset.v; setVal(p, null, v); queueDraft(p); render(true); break;
    case "pickl": v.line = t.dataset.v; setVal(p, null, v); queueDraft(p); render(true); break;
    case "pickc": v.c = t.dataset.v; setVal(p, null, v); queueDraft(p); render(true); break;
  }
});
document.addEventListener("input", e => {
  const t = e.target, b = t.dataset.bind;
  if (!b) return;
  if (b === "code") { S.codeInput = t.value.replace(/\D/g, "").slice(0, 4); if (t.value !== S.codeInput) t.value = S.codeInput; const btn = document.querySelector('[data-act="code"]'); if (btn) btn.disabled = S.codeInput.length !== 4; return; }
  if (b === "seat") { S.seatInput = t.value.replace(/\D/g, "").slice(0, 2); if (t.value !== S.seatInput) t.value = S.seatInput; const btn = document.querySelector('[data-act="join"]'); const n = +S.seatInput; if (btn) btn.disabled = !(n >= 1 && n <= (S.session && S.session.seats || 28)); return; }
  if (S.phase !== "active") return;
  const p = curPage();
  if (b === "swap") { const sw = Object.assign({ card: "", reason: "", other: "" }, S.local["2-7.swap"]); sw[t.dataset.k] = t.value; S.local["2-7.swap"] = sw; if (t.tagName === "SELECT") render(true); else refreshButtons(); return; }
  let part = null;
  const v = val(p);
  fillDefaults(p, v);
  switch (b) {
    case "wall": v.text = t.value; break;
    case "sortdesc": v.desc[+t.dataset.i] = t.value; break;
    case "jbasis": v.rows[+t.dataset.i] = Object.assign({}, v.rows[+t.dataset.i], { basis: t.value }); break;
    case "jto": v.rows[+t.dataset.i] = Object.assign({}, v.rows[+t.dataset.i], { to: t.value }); break;
    case "jrew": v.rows[+t.dataset.i] = Object.assign({}, v.rows[+t.dataset.i], { rewrite: t.value }); break;
    case "f": {
      const [k, sub] = t.dataset.k.split(".");
      if (k === "product") v.product = Object.assign({}, v.product, { other: t.value });
      else if (sub !== undefined) { const arr = (v[k] || []).slice(); arr[+sub] = t.value; v[k] = arr; }
      else v[k] = t.value;
      break;
    }
    case "fb": { const a = (v.a || []).slice(); a[+t.dataset.i] = t.value; v.a = a; break; }
    case "glovew": { const k = "r" + t.dataset.r; v[k] = Object.assign({}, v[k], { ["w" + t.dataset.i]: t.value }); break; }
    case "voice": { const a = (v.a || []).slice(); a[+t.dataset.i] = t.value; v.a = a; break; }
    case "need": { part = "needs"; const n = (val(p, "needs") || []).slice(); n[+t.dataset.i] = Object.assign({}, n[+t.dataset.i], { [t.dataset.k]: t.value }); setVal(p, "needs", n); queueDraft(p, "needs"); refreshButtons(); return; }
    case "airaw": { part = "ai"; const ai = Object.assign({}, val(p, "ai")); ai.raw = t.value; ai.lines = parseAILines(t.value); setVal(p, "ai", ai); queueDraft(p, "ai"); if (!composing) render(true); else pendingRender = true; return; }
    case "triwhy": v.why = t.value; break;
    case "pickwhy": v.why = t.value; break;
  }
  setVal(p, part, v);
  queueDraft(p, part);
  if (t.tagName === "SELECT") render(true); else refreshButtons();
});
document.addEventListener("change", e => { if (e.target.tagName === "SELECT" && e.target.dataset.bind) { /* input 已處理 */ } });
/* 打字時不重畫整頁，只更新送出按鈕能不能按 */
function refreshButtons() {
  if (composing) return;
  const p = curPage();
  const html = document.createElement("div"); html.innerHTML = body(p);
  html.querySelectorAll("button[data-act]").forEach(nb => {
    const sel = `button[data-act="${nb.dataset.act}"]${nb.dataset.part ? `[data-part="${nb.dataset.part}"]` : ""}`;
    const cur = document.querySelector(".st-main " + sel);
    if (cur && ["send", "sendpart", "sortsend", "hand", "swap"].includes(nb.dataset.act)) cur.disabled = nb.disabled;
  });
}
function toast(msg) { const d = document.createElement("div"); d.className = "toast"; d.textContent = msg; document.body.appendChild(d); setTimeout(() => d.remove(), 2600); }

render(true);
if (KEY) findClass(); else if (CODE) poll();
Object.values(IMAGES).forEach(src => { const i = new Image(); i.src = src; });
