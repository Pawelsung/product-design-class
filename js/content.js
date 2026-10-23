/* 課堂活動內容｜第 1、2 節（依〈第1-2節_課堂活動內容.md〉）
   這個檔案是公開的，只放學生和投影看得到的內容。
   答案、老師提問、備用回答放在資料庫（lesson_private），只有老師登入後看得到。 */

const STAGES = ["規劃", "概念發展", "系統整體設計", "細部設計", "測試修正", "試產量產"];
const DESC_CARDS = {
  B: "找出使用者需要什麼，評估市場，決定產品要做給誰",
  E: "確認功能需求，看市面上有沒有類似產品，畫出草圖",
  F: "把功能設計完整，規劃產品家族和搭配的周邊",
  A: "決定零件的尺寸、材料和公差，畫出工作圖",
  C: "做出原型試用，看有沒有達到需求，再修改設計",
  D: "先少量生產給客戶試用，找出問題後再大量生產"
};
const DESC_ORDER = ["B", "E", "F", "A", "C", "D"]; // 只用來顯示課本定義（1-4），不是排序答案提示
const PRODUCTS = ["手搖飲杯", "無線耳機（含充電盒）", "水壺", "書包", "小卡卡冊", "遊戲手把"];
const ROLE_CARDS = [
  null,
  { name: "① 公車上的通勤族", say: "「公車很擠，我一手要抓吊環，只剩一隻手可以拿東西、滑手機。」", think: "只能用一隻手時，我們的產品哪裡不方便？" },
  { name: "② 手指沒什麼力氣的阿嬤", say: "「太小的扣子、太緊的蓋子、太硬的開關，我常常要請孫子幫忙。」", think: "力氣小的人，用我們的產品哪一步最吃力？" },
  { name: "③ 剛打完球的人", say: "「流了一身汗，手很滑，東西要一拿出來就能用。」", think: "手濕、手滑、很急的時候，我們的產品好用嗎？" },
  { name: "④ 剛上國一的新生", say: "「我個子比較小，東西太重、太大，或放太高，我就不好拿。」", think: "手比較小、力氣比較小的人，拿得動、拿得好嗎？" },
  { name: "⑤ 慣用左手的同學", say: "「有些東西的按鈕、開口是照右手的習慣做的，我有時要換個方式用。」", think: "用左手操作我們的產品，有哪裡不一樣？", img: "meme11" },
  { name: "⑥ 在暗處的追星族", say: "「演唱會、電影院裡很暗，我看不清楚按鈕和上面的字。」", think: "光線很暗的時候，我們的產品還看得清楚、找得到嗎？" }
];
const ROLE_NOTE = "這是設想的情境，幫我們想出要再確認的需求，不代表這類人都這樣。";
const IMAGES = {
  meme1: "img/meme1.png", meme2: "img/meme2.png", meme3: "img/meme3.png", meme6: "img/meme6.png",
  meme7: "img/meme7.png", meme8: "img/usb3.svg", usbc: "img/usbc.svg", meme9: "img/meme9.png", meme10: "img/meme10.png",
  meme11: "img/meme11.png", meme12: "img/meme12.png"
};
const GLOVE_ACTIONS = [
  "轉開瓶蓋，倒水到刻度線，再把蓋子轉緊",
  "打開夾鏈袋拿出卡片，再把夾鏈壓緊",
  "撿起迴紋針，夾到卡片上"
];
const GLOVE_CHOICES = ["順利完成", "卡住了", "時間到沒做完"];
const COLORS = {
  green: { label: "綠", name: "有根據", desc: "能對到我們看到或聽到的資料，而且說的範圍沒有比資料更大。" },
  yellow: { label: "黃", name: "要查證", desc: "聽起來可能對，但我們還沒有資料，要再觀察或問人。" },
  red: { label: "紅", name: "刻板印象", desc: "把一群人說成都一樣，或直接把某些人排除在外。" }
};

/* 頁面類型
   login 登入｜vote 投票／單選（個人）｜wall 便利貼牆（個人、匿名）｜reveal 逐列揭曉｜info 講解
   sort 排序搶答（小組）｜judge 判斷 AI 計畫（小組）｜form 小組表單｜feedback 課堂回饋（個人、只有老師看）
   glove 手套挑戰觀察（個人）｜voice 心聲卡（個人、匿名）｜cards 唸卡抽卡整理需求（小組）
   aicompare AI 比對（小組）｜tricolor 三色牌（小組）｜pickone 最值得討論的一條（小組） */

const LESSONS = {
  1: {
    title: "第 1 節｜挑戰一 產品設計流程",
    chip: "第 1 節・挑戰一｜產品設計流程",
    book: "課本 p.32–36",
    agenda: ["梗圖投票：這是誰的問題？", "排序搶答賽", "找出 AI 計畫的錯", "選定要改造的產品"],
    usesAI: false,
    slots: ["1-5", "1-7", "1-8"],
    pages: [
      { id: "1-0", type: "login", time: "上課前", title: "你每天用的東西，是怎麼被設計出來的？", sub: "九年級生活科技｜第二章 產品設計的流程・第 1 節 挑戰一（課本 p.32–36）" },
      { id: "1-1a", type: "vote", time: "0–4 分", title: "這是誰的問題？", caption: "珍珠卡在吸管裡", img: "meme7", options: ["使用者的問題", "設計的問題"] },
      { id: "1-1b", type: "vote", time: "0–4 分", title: "這是誰的問題？", caption: "手搖飲：期望 vs 現實", img: "meme1", options: ["使用者的問題", "設計的問題"] },
      { id: "1-1c", type: "vote", time: "0–4 分", title: "這是誰的問題？", caption: "無線耳機又掉一隻", img: "meme2", options: ["使用者的問題", "設計的問題"] },
      { id: "1-1d", type: "vote", time: "0–4 分", title: "這是誰的問題？", caption: "USB 為什麼要轉三次？", img: "meme8", revealImg: "usbc", revealCaption: "後來的 USB-C：正反都能插", options: ["使用者的問題", "設計的問題"] },
      { id: "1-1e", type: "vote", time: "0–4 分", title: "這是誰的問題？", caption: "這扇門到底要推還是拉？", img: "meme3", options: ["使用者的問題", "設計的問題"] },
      { id: "1-2", type: "wall", time: "4–6 分", title: "你最崩潰的一次使用經驗", sub: "課本 p.32：如果可以改造它，你會怎麼設計？",
        prompt: "寫一句你用東西最崩潰的一次", placeholder: "例如：什麼東西、發生什麼事", max: 80 },
      { id: "1-3", type: "reveal", time: "6–14 分", title: "做一款遊戲 ≈ 設計一個產品", sub: "只是比喻，最後要回到課本定義",
        left: "做遊戲", right: "課本階段",
        rows: [
          ["遊戲企劃：要做給誰玩？玩家想要什麼？", "規劃"],
          ["畫角色、畫面的概念圖", "概念發展"],
          ["規劃遊戲系統：關卡、商城、連線", "系統整體設計"],
          ["調每一關的難度、數值", "細部設計"],
          ["封測：找人試玩、抓 bug、修改", "測試修正"],
          ["先小規模開放試玩，修好問題，再正式上線給所有人", "試產量產"]
        ] },
      { id: "1-4", type: "info", time: "6–14 分", title: "課本怎麼說：以手機為例", foot: "課本 p.34–36", defs: true },
      { id: "1-5", type: "sort", time: "14–20 分", title: "排序搶答賽", scope: "g", slot: "1-5", publish: true,
        help: "把六個階段排好，再把說明配到對的階段。每組有兩次機會。" },
      { id: "1-6", type: "vote", time: "20–24 分", title: "改良案例：御飯糰的切線", img: "meme9", publish: true,
        intro: "先看課本 p.35 改造畚箕：發現畚箕不貼地、灰塵掃不起來的問題 → 畫草圖、查有沒有類似產品 → 想能不能搭配掃把 → 確認尺寸與材料 → 做原型試用再修改 → 小量生產找缺點。",
        question: "設計新包裝時，發現「包裝很難撕」，是哪個階段要做的事？", options: STAGES },
      { id: "1-7", type: "judge", time: "24–32 分", title: "AI 寫的應援棒設計計畫", sub: "應援棒：演唱會時粉絲手上的發光棒",
        scope: "g", slot: "1-7", publish: true, sample: true,
        rows: [
          ["規劃", "先決定應援棒的燈要用哪一種 LED 零件。"],
          ["概念發展", "畫出造型草圖，看看市面上的應援棒長什麼樣子。"],
          ["系統整體設計", "調查粉絲在演唱會上，拿應援棒最常遇到什麼困擾。"],
          ["細部設計", "讓應援棒變得很好用。"],
          ["測試修正", "請粉絲試用，看握感和亮度，有問題就修改。"],
          ["試產量產", "設計手機 App，讓應援棒跟著音樂一起變色。"]
        ] },
      { id: "1-8", type: "form", time: "32–40 分", title: "選一個你們要改造的產品", scope: "g", slot: "1-8",
        fields: [
          { key: "product", kind: "product", label: "1. 我們要改造的產品" },
          { key: "pain", kind: "text", label: "2. 這個產品最不方便的情況是（一句）", placeholder: "哪個情況、哪個動作" },
          { key: "stages", kind: "stages", label: "3. 六個階段，我們各打算做什麼（每格一句）" }
        ], card: ["product", "pain"] },
      { id: "1-9", type: "feedback", time: "40–45 分", title: "課堂回饋一", private: true,
        questions: [
          "如果把設計產品比喻成做遊戲，哪一個階段最常被跳過？會發生什麼事？",
          "AI 的計畫裡，哪一步放對、哪一步放錯？我怎麼判斷的？"
        ] }
    ]
  },
  2: {
    title: "第 2 節｜挑戰二 重視同理心的需求分析",
    chip: "第 2 節・挑戰二｜重視同理心的需求分析",
    book: "課本 p.37–41",
    agenda: ["手套挑戰", "匿名心聲卡與角色卡", "AI 也列一份，比比看", "三色牌：這句有根據嗎？", "決定目標客群"],
    usesAI: true,
    slots: ["2-7a", "2-7b", "2-8", "2-9", "2-10", "2-12"],
    pages: [
      { id: "2-0", type: "login", time: "上課前", title: "為什麼會有人買這個？", sub: "九年級生活科技｜第二章 產品設計的流程・第 2 節 挑戰二（課本 p.37–41）" },
      { id: "2-1", type: "wall", time: "0–2 分", title: "迷你保溫瓶「喝２口就沒了」到底誰會買？",
        source: "食尚玩家（TVBS），〈迷你保溫瓶「喝２口就沒了」到底誰會買？過來人曝超強用途：在台灣用很適合〉，2025 年 10 月 27 日",
        sub: "只能裝 120 毫升", prompt: "你覺得誰會買？寫一句", placeholder: "例如：要出門吃藥的人", max: 60,
        revealTitle: "揭曉：網友說的用途",
        lines: [
          "出國帶著用，旅館的杯子不知道乾不乾淨",
          "冬天裝熱水，小口小口喝剛剛好",
          "洗腎的長輩要限制喝水，口乾時喝一點潤喉",
          "有人的媽媽上班用它帶冰塊，因為公司沒有冰箱",
          "台灣飲水機很多，隨時可以補水，不用扛一、兩公升"
        ] },
      { id: "2-2", type: "glove", time: "2–8 分", title: "手套挑戰", publish: true },
      { id: "2-3", type: "info", time: "2–8 分", title: "設計師看到的 vs 使用者看到的", img: "meme10" },
      { id: "2-4", type: "vote", time: "8–11 分", title: "設計者怎麼知道使用者要什麼？", publish: true,
        intro3: [["實地觀察", "看使用者實際怎麼用"], ["訪談", "直接問使用者的感受"], ["資料分析", "整理大家的紀錄和意見"]],
        foot: "課本 p.38–39",
        question: "2010 年推出的手機：不能下載 App、不能玩遊戲。你會買嗎？", options: ["會買", "不會買"],
        lines: ["揭曉：上市 48 天就停賣"] },
      { id: "2-5", type: "info", time: "11–12 分", title: "想要的功能 ≠ 需求", img: "meme12",
        lines: [
          "使用者說：「我要更大的水壺。」",
          "追問：「為什麼要更大？什麼時候會不夠？」",
          "他說：「下午常常沒水喝，又不想一直離開座位去裝水。」",
          "確認：「所以你是希望一整天在座位上都有水喝，對嗎？」「對！」",
          "需求：上課一整天的學生，在座位上也能隨時喝到足夠的水。",
          "加大容量只是其中一種做法；更好裝水的瓶口，也可能是答案。"
        ] },
      { id: "2-6", type: "voice", time: "12–15 分", title: "匿名心聲卡", sub: "投影只顯示內容，不顯示座號",
        used: ["我什麼時候會用〔產品〕？", "用〔產品〕最煩的一次是什麼情況？", "我希望它怎麼改？"],
        unused: ["我看過別人用〔產品〕的時候，遇到什麼麻煩？", "如果可以問使用者，我最想問什麼？", "我猜他們會在意什麼？"] },
      { id: "2-7", type: "cards", time: "15–19 分", title: "唸卡、抽卡、整理需求", scope: "g", slot: "2-7a", slot2: "2-7b" },
      { id: "2-8", type: "aicompare", time: "19–25 分", title: "AI 也列一份，比比看", scope: "g", slot: "2-8", linger: true,
        prompt: "我們想改良〔產品〕。不同的人使用〔產品〕時，各會有什麼需求？只列 6 條，每條格式是「誰：需要什麼」，不要開頭和結尾的說明。" },
      { id: "2-9a", type: "tricolor", time: "25–31 分", title: "三色牌・第 1 句", scope: "g", slot: "2-9", publish: true, sample: true,
        quote: "戴著手套或只能用單手的人，需要不用轉很多圈就能打開的蓋子。", evidence: { kind: "glove", text: "本班手套挑戰的長條圖：「轉開瓶蓋」第一輪、第二輪各有幾組卡住" } },
      { id: "2-9b", type: "tricolor", time: "25–31 分", title: "三色牌・第 2 句", scope: "g", slot: "2-9", publish: true, sample: true,
        quote: "女生都喜歡粉紅色、有可愛圖案的水壺。", evidence: { kind: "wall", text: "本班心聲牆：有沒有人提到顏色、圖案？", words: ["顏色", "圖案", "粉", "可愛", "外觀", "樣式", "好看"] } },
      { id: "2-9c", type: "tricolor", time: "25–31 分", title: "三色牌・第 3 句", scope: "g", slot: "2-9", publish: true, sample: true,
        quote: "上班族比較喜歡大容量的水壺。", evidence: { kind: "text", text: "2-1 的新聞：有人的媽媽上班用 120 毫升的小保溫瓶帶冰塊；我們班沒有上班族的心聲卡。" } },
      { id: "2-9d", type: "tricolor", time: "備用句", title: "三色牌・備用句", scope: "g", slot: "2-9", publish: true, sample: true, optional: true,
        quote: "長輩不太會用新東西，所以不用考慮他們。", evidence: { kind: "text", text: "2-1 的新聞：洗腎的長輩也在用小保溫瓶。" } },
      { id: "2-10", type: "pickone", time: "25–31 分（彈性）", title: "最值得討論的一條", scope: "g", slot: "2-10", optional: true },
      { id: "2-11", type: "info", time: "31–40 分", title: "使用者和目標客群", img: "meme6",
        pair: [["使用者", "範圍很廣，所有可能用到這個產品的人"], ["目標客群", "依年齡、使用情境、習慣等特性分類後，你最想服務的那一群"]], foot: "課本 p.41" },
      { id: "2-12", type: "form", time: "31–40 分", title: "我們的目標客群", scope: "g", slot: "2-12",
        fields: [
          { key: "target", kind: "text", label: "1. 我們的產品主要做給", placeholder: "例如：每天騎腳踏車上學的國中生" },
          { key: "basis", kind: "text", label: "2. 我們是依什麼特性分的", placeholder: "例如使用情境、年齡、習慣" },
          { key: "needs", kind: "list3", label: "3. 下節問卷想確認的 3 個需求" }
        ], card: ["target", "basis", "needs"] },
      { id: "2-13", type: "feedback", time: "40–45 分", title: "課堂回饋二", private: true,
        questions: [
          "我發現的一個使用者需求，以及我怎麼知道的（哪一張卡、手套挑戰，還是其他？）",
          "AI 列的需求裡，選一條你覺得有根據的，再選一條要再查證、你不同意或不確定的，各說理由。如果你覺得每一條都有根據，說說你是怎麼檢查的。",
          "這節我用 AI 做了什麼？"
        ] }
    ]
  }
};

function pageById(lesson, id) { return (LESSONS[lesson]?.pages || []).find(p => p.id === id); }
function answerable(p) { return ["vote", "wall", "sort", "judge", "form", "feedback", "glove", "voice", "cards", "aicompare", "tricolor", "pickone"].includes(p.type); }
function productText(prod) { return prod ? (prod.choice === "其他" ? (prod.other || "其他") : prod.choice) : ""; }
