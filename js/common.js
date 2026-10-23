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

function activityGuide(kind) {
  const guides = {
    voice: ["每人寫一張自己的使用經驗", ["打開平板，確認你們組要改造的產品。", "各寫一句：什麼時候用？當時要做什麼、哪一步不方便？希望能做到什麼？", "按「送出心聲卡」。沒用過就勾選「我沒用過」，寫觀察或想問的問題。"], "例｜水壺：下午上課時 → 水喝完又不方便離座 → 希望座位上一直有水喝。"],
    cards1: ["先唸同組心聲卡，再自由選情境", ["唸卡代表依序唸出組員的心聲卡，大家找出共同困難。", "打開十二種情境，選與產品有關的幾種討論；不適用就換看別種，不限次數。", "老師切到第二段後，由整理代表寫至少三條需求，並勾選來源。"], "上方心聲卡來自同組同學在上一頁寫的內容；下方十二種角色情境是額外參考，不是實際訪談證據。"],
    cards2: ["把討論變成至少三條需求", ["全組討論：誰，在什麼情況下，需要什麼？", "整理代表在平板填寫至少三條，勾選心聲卡、角色卡或手套挑戰等來源。", "按「送出需求清單」。其他組員一起檢查：這是需要達成的事，還是直接指定功能？"], "例｜上課一整天的學生，在下午的座位上，需要隨時喝到足夠的水。"],
    ai: ["請 AI 補想法，再用你們的證據檢查它", ["AI 操作員：在平板按「複製問法」→ 開 Gemini 貼上 → 把回答貼回網站 →「交給全組判斷」。", "全組：拿上一頁的需求清單逐條比較，選「有想到／沒有想到」。", "判斷代表：每條選綠（有根據）、黃（要查證）或紅（刻板印象），全部完成後按「送出判斷」。"], "例｜AI 說「女生都喜歡粉紅水壺」：沒有資料，而且把所有女生說成一樣 → 紅。AI 多說一條，不代表它說對了。"]
  };
  const [title, steps, example] = guides[kind];
  return `<section class="activity-guide"><h2>${esc(title)}</h2><ol>${steps.map(t => `<li>${esc(t)}</li>`).join("")}</ol><div class="guide-example">${esc(example)}</div></section>`;
}
function needStory(p, state) {
  const n = Math.min(p.lines.length - 1, state.step || 0);
  const i = n;
  const labels = ["先聽使用者說", "追問情境", "聽到真正的困難", "確認理解", "整理成需求", "再想解決方法"];
  return `<section class="need-story"><div class="story-label">${esc(labels[i])} · ${i + 1}/${p.lines.length}</div><blockquote>${esc(p.lines[i])}</blockquote><p>${n === 0 ? "先想一想：更大，是需求本身，還是一種做法？老師按「下一行」開始追問。" : i < 4 ? "先別急著決定功能，繼續問：為什麼？什麼情況下？" : "需求說明要達成什麼；功能是解決它的一種方法。"}</p></section>`;
}

function kinTask(state = {}) {
  const slides = [
    { tag: "① 認識產品｜2010 年的美國", title: "微軟想做一支「專門分享生活」的手機", cards: [
      ["想賣給誰？", "重視社交、常傳訊息和分享照片的年輕使用者。當時 iPhone 與 Android 手機已出現，手機能做什麼也成為購買時的比較重點。"],
      ["KIN ONE／KIN TWO 能做什麼？", "有實體鍵盤、相機和瀏覽器；把社群動態集中在一起，方便拍照、傳訊息與分享。"],
      ["它的特色", "Loop 整理朋友的動態；Spot 把照片等內容拖到一起分享；Studio 把照片、影片等資料備份到網路上。"]
    ], task: "先口頭回答：這些設計，想幫使用者把哪件事做得更方便？", note: "背景說明：這是當年的產品，不是把今天的手機規格直接套回 2010 年。" },
    { tag: "② 看完整條件｜特色之外，還有限制", title: "愛分享照片，就一定願意買嗎？", cards: [
      ["功能限制", "上市初期不能像一般智慧型手機那樣，自行下載第三方 App 或遊戲。它有內建社群功能，不代表能安裝想用的各種服務。"],
      ["買手機之外，還要付月租", "美國上市時 KIN ONE／TWO 的優惠機價約 50／100 美元，須符合退費及兩年合約條件；當時報導指出最低月費約 70 美元，其中約 30 美元是數據費。"],
      ["需要確認的購買條件", "使用者是否還需要其他 App？願意每月付多少？若由家長付款，家長在意的條件是否一樣？這些都不能只靠「年輕人愛社交」推定。"]
    ], task: "全組討論：如果你是目標使用者，哪一項條件最可能讓你放棄？請從上面選一項說理由。", note: "金額是 2010 年美國方案，用來理解總使用成本，不是現在的台灣售價。" },
    { tag: "③ 換你當設計師｜討論 60 秒", title: "上市以前，你最想先確認哪件事？", cards: [
      ["挑一個關鍵疑問", "例如：對這群人來說，方便分享照片，能不能取代使用其他 App 的需要？"],
      ["決定問誰、怎麼問", "找可能使用手機的人，也找實際付款的人。不要只問「你喜歡這支手機嗎？」要問最近怎麼用手機、哪些功能不能少、每月能負擔多少。"],
      ["各組完成一句話", "「我們要找＿＿，用＿＿方法，確認＿＿。」例：找會替孩子付月租的家長訪談，確認可接受的月費與原因。"]
    ], task: "每組口頭準備一句，老師邀請兩組分享。不需在平板送出；先討論再揭曉市場結果。", note: "這裡沒有唯一答案；要能說明你的調查如何影響產品決策。" },
    { tag: "④ 揭曉結果｜再檢查剛才的判斷", title: "推出不久，微軟就縮減了 Kin 計畫", cards: [
      ["發生什麼事？", "2010 年 5 月在美國開賣；6 月 30 日微軟宣布取消原定的歐洲上市，並將 Kin 團隊整併到 Windows Phone 7。美國當時仍繼續銷售現有手機。"],
      ["我們能從資料說什麼？", "當時評論指出功能限制與月費是疑慮。這些是值得驗證的產品條件；不能只憑這些資訊，認定所有人都因同一個原因不買。"],
      ["回看你們的問題", "你們剛才想查的事，能幫忙決定保留哪些功能、是否開放 App，或調整價格嗎？說出一個可能改變的決定。"]
    ], task: "請完成：有社群功能，不等於已滿足需求；我們還要確認＿＿。", note: "不能把結果簡化成「不能下載 App，所以一定失敗」，也不能把原計畫縮減說成當天所有商店立即停售。" },
    { tag: "⑤ 帶回你們的產品｜從案例變成方法", title: "調查不是補流程，是用來做決定", cards: [
      ["觀察實際使用", "看人怎麼操作、在哪一步卡住。Kin：看手機一天被拿來做什麼；你們的產品：看真實使用動作。"],
      ["訪談使用者與付款者", "問具體經驗、不可缺少的事、費用限制與原因；別只問喜不喜歡你預先想好的功能。"],
      ["整理資料再選方向", "把多人的紀錄放在一起，找出常見需求與差異。先說清楚要幫誰做到什麼，再比較功能、成本和使用限制。"]
    ], task: "每組說出：我們的產品是＿＿，還要找＿＿，確認＿＿。接著用心聲卡蒐集具體使用經驗。", note: "教學重點：產品特色是做法；使用者想達成的事與限制，才是需要確認的需求。" }
  ];
  const index = Math.max(0, Math.min(slides.length - 1, Number(state.step) || 0));
  const slide = slides[index];
  return `<section class="kin-case"><div class="kin-progress">${esc(slide.tag)}　${index + 1}/${slides.length}</div><h2>${esc(slide.title)}</h2><div class="kin-cards">${slide.cards.map(([title, text]) => `<article><h3>${esc(title)}</h3><p>${esc(text)}</p></article>`).join("")}</div><div class="kin-task"><b>現在要做：</b>${esc(slide.task)}</div><p class="kin-note">${esc(slide.note)}</p><details class="kin-sources"><summary>案例資料來源（內容已整理在本頁）</summary><a href="https://news.microsoft.com/source/2010/04/12/microsoft-ushers-in-the-next-generation-of-the-social-phone-with-kin-a-new-windows-phone/" target="_blank" rel="noopener">Microsoft：產品發表與功能</a> · <a href="https://blogs.windows.com/windowsexperience/2010/05/05/kin-availability-and-pricing-announced/" target="_blank" rel="noopener">Microsoft：美國上市與機價</a> · <a href="https://www.computerworld.com/article/1588692/microsoft-verizon-defend-kin-s-monthly-pricing-noting-cloud-backup.html" target="_blank" rel="noopener">Computerworld：月費與 App 限制</a> · <a href="https://www.cbsnews.com/news/two-months-after-debut-microsoft-kills-kin/" target="_blank" rel="noopener">CBS：6 月 30 日計畫調整及微軟聲明</a></details></section>`;
}
