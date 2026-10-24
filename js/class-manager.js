/* Saved class setup, actual rosters, attendance and visual grouping. */
const CM = {
  classes: [], error: '', saving: false, launching:false, sessionEdit: null,
  async load() {
    const r = await rpc('lesson_classes', { p_token:T.token });
    if (Array.isArray(r)) { this.classes=r; this.error=''; }
    else this.error='班級名單暫時無法讀取，請重新整理後再試。';
  },
  form(profile) {
    const roster=profile ? [...profile.roster] : Array.from({length:30},(_,i)=>i+1);
    const map=profile ? {...profile.groups} : CM.allocate(roster,6,false);
    return { id:profile?.id || null, rev:profile?.rev || null, classKey:profile?.class_key || '',
      grade:profile?.grade || ({'七':7,'八':8,'九':9}[(profile?.label||'')[0]] || 9), classNo:profile?.class_no || Number((profile?.label||'').match(/年\s*(\d+)\s*班/)?.[1]) || 1, label:profile?.label || '九年 1 班',
      roster, maxSeat:profile?.max_seat || Math.max(...roster,1), absent:[], map, groupCount:Math.max(...Object.values(map),1),
      groupMode:'count', groupValue:6, selected:null, lesson:1, from:'', importText:'', error:'' };
  },
  present(f) { return f.roster.filter(n=>!f.absent.includes(n)).sort((a,b)=>a-b); },
  activeMap(f) { return Object.fromEntries(CM.present(f).map(n=>[n,+f.map[n]])); },
  allocate(seats,count,shuffle) {
    const list=[...seats].sort((a,b)=>a-b), map={};
    if(shuffle) for(let i=list.length-1;i>0;i--) { const j=Math.floor(Math.random()*(i+1)); [list[i],list[j]]=[list[j],list[i]]; }
    count=Math.max(1,Math.min(list.length,count));
    list.forEach((n,i)=>map[n]=i%count+1); return map;
  },
  auto(f,shuffle=false) {
    const seats=CM.present(f), value=Math.max(1,Math.min(120,Number(f.groupValue)||1));
    const count=f.groupMode==='size' ? Math.ceil(seats.length/value) : value;
    f.map=CM.allocate(seats,count,shuffle); f.groupCount=Math.max(...Object.values(f.map),1);
    f.absent.forEach((n,i)=>{if(f.roster.includes(n)) f.map[n]=i%f.groupCount+1;}); f.selected=null;
  },
  validate(f) {
    if(!f.label.trim()) return '請設定班級名稱。';
    if(!Number.isInteger(+f.maxSeat) || +f.maxSeat<1 || +f.maxSeat>120 || f.roster.some(n=>n>+f.maxSeat)) return '請確認最大座號，並按「調整座號範圍」。';
    if(!f.roster.length) return '名單至少需要一個座號。';
    if(!CM.present(f).length) return '今天至少要有一位學生出席。';
    if(f.roster.some(n=>!Number.isInteger(n)||n<1||n>120)||new Set(f.roster).size!==f.roster.length) return '座號必須是 1～120 的整數，而且不能重複。';
    if(f.roster.some(n=>!Number.isInteger(+f.map[n])||+f.map[n]<1||+f.map[n]>120)) return '有座號還沒分組，請先按自動分組。';
    return '';
  },
  parseSeats(text) {
    const tokens=String(text).trim().split(/[\s,，、;；]+/).filter(Boolean);
    if(!tokens.length || tokens.some(t=>!/^\d{1,3}$/.test(t))) throw Error('請只貼上座號欄，可用換行、逗號或空格分隔。');
    const nums=tokens.map(Number);
    if(nums.some(n=>n<1||n>120)||new Set(nums).size!==nums.length) throw Error('座號須為 1～120，且不能重複。');
    return nums.sort((a,b)=>a-b);
  },
  open(id) {
    const c=CM.classes.find(c=>c.id===id); T.form=CM.form(c);
    if(c) T.form.from=T.sessions.find(s=>s.lesson===1 && (s.profileId===c.id || s.classKey===c.class_key))?.id || '';
    render(true);
  },
  async save(f) {
    const err=CM.validate(f); if(err) { f.error=err;render(true);return null; }
    if(CM.saving) return null; CM.saving=true; render(true);
    try {
      const r=await rpc('lesson_class_save',{p_token:T.token,p_profile:{id:f.id,label:f.label,grade:+f.grade,class_no:+f.classNo,max_seat:+f.maxSeat,roster:f.roster,groups:f.map},p_rev:f.rev});
      if(!r?.ok) { f.error=r?.error==='CONFLICT'?'這個班級已在其他裝置修改。請取消後重新開啟班級，避免覆蓋別人的修改。':'儲存班級失敗，請稍後再試。';return null; }
      Object.assign(f,{id:r.profile.id,rev:r.profile.rev,classKey:r.profile.class_key,error:''});
      CM.classes=CM.classes.filter(c=>c.id!==r.profile.id);CM.classes.unshift(r.profile); return r.profile;
    } finally { CM.saving=false;render(true); }
  },
  qrLink(c) { return 'qr.html?k='+encodeURIComponent(c.class_key || c.classKey)+'&l='+encodeURIComponent(c.label)+'&g='+encodeURIComponent(Object.keys(groupSeats(c.groups || c.map)).join(',')); },
  tiles() {
    return `<section class="t-sec"><h2>我的班級</h2><p class="muted small">名單與固定分組會儲存在雲端。選班級就能開課，不必每次重打。</p>${CM.error?`<div class="banner bad">${esc(CM.error)}</div>`:''}<div class="class-tiles">${CM.classes.map(c=>`<article class="class-tile"><h3>${esc(c.label)}</h3><p>${c.roster.length} 人 · 最大座號 ${c.max_seat || Math.max(...c.roster)} · ${groupIds(c.groups).length} 組</p><div class="row"><button class="btn primary" data-cm="open" data-id="${c.id}">設定／開課</button><button class="btn" data-cm="qr" data-id="${c.id}">班級 QR Code／桌卡 PDF</button></div></article>`).join('')}</div><button class="btn primary block" data-cm="new">＋ 建立新班級</button></section>`;
  },
  board(f,ctx='form') {
    const seats=CM.present(f), groups=groupSeats(CM.activeMap(f));
    return `<div class="group-board">${Array.from({length:f.groupCount},(_,i)=>i+1).map(g=>`<section class="group-bin" data-drop-group="${g}" data-ctx="${ctx}"><button class="btn ghost block" data-cm="move" data-g="${g}" data-ctx="${ctx}">第 ${g} 組 · ${(groups[g]||[]).length} 人${f.selected?' · 移入 '+f.selected+' 號':''}</button><div class="seat-pills">${(groups[g]||[]).map(n=>`<button draggable="true" class="seat-pill ${f.selected===n?'selected':''}" data-cm="select" data-seat="${n}" data-ctx="${ctx}" aria-pressed="${f.selected===n}">${n} 號</button>`).join('')||'<span class="small muted">可拖曳或點選移入</span>'}</div></section>`).join('')}</div><p class="small muted">${seats.length} 位出席學生已分組。電腦可拖曳；手機先點座號，再點目標組標題。</p>`;
  },
  grouping(f,ctx='form') {
    return `<div class="row"><label>分組方式 <select data-cm-bind="groupMode" data-ctx="${ctx}"><option value="count" ${f.groupMode==='count'?'selected':''}>分成幾組</option><option value="size" ${f.groupMode==='size'?'selected':''}>每組最多幾人</option></select></label><input aria-label="分組數值" type="number" min="1" max="120" data-cm-bind="groupValue" data-ctx="${ctx}" value="${f.groupValue}" style="width:85px"><button class="btn" data-cm="auto" data-ctx="${ctx}">依座號平均分組</button><button class="btn" data-cm="random" data-ctx="${ctx}">隨機分組</button></div>${CM.board(f,ctx)}`;
  },
  view(f) {
    const absent=new Set(f.absent), names=['七','八','九'];
    return `<h2>${f.id?'班級設定與開課':'建立班級'}</h2><section class="t-sec"><h3>1. 選班級</h3><div class="row"><label>年級<select data-cm-bind="grade">${[7,8,9].map(n=>`<option value="${n}" ${+f.grade===n?'selected':''}>${names[n-7]}年級</option>`).join('')}</select></label><label>班級<select data-cm-bind="classNo">${Array.from({length:40},(_,i)=>i+1).map(n=>`<option value="${n}" ${+f.classNo===n?'selected':''}>${n} 班</option>`).join('')}</select></label></div><label class="lab" for="cm-label">顯示名稱（可自訂）</label><input id="cm-label" maxlength="80" data-cm-bind="label" value="${esc(f.label)}"><p class="small muted">班級 QR Code 自動建立，不需要輸入網址或代號。</p></section>
    <section class="t-sec"><h3>2. 實際座號名單｜${f.roster.length} 人</h3><div class="row"><label>最大座號 <input type="number" min="1" max="120" data-cm-bind="maxSeat" value="${f.maxSeat}" style="width:85px"></label><button class="btn" data-cm="range">調整座號範圍</button><button class="btn ghost" data-cm="allseats">全選 1～${f.maxSeat}</button></div><p class="small muted">點掉沒有人的座號，例如 4、6 號。灰色表示班上沒有這個座號，不是今天請假。</p><div class="roster-grid">${Array.from({length:Math.min(120,Math.max(...f.roster,Number(f.maxSeat)||1))},(_,i)=>i+1).map(n=>`<button data-cm="roster" data-seat="${n}" aria-pressed="${f.roster.includes(n)}">${n}</button>`).join('')}</div><details class="box"><summary>從 Excel 貼上座號欄</summary><textarea data-cm-bind="importText" placeholder="只貼座號，例如：1、2、3、5、7……">${esc(f.importText)}</textarea><button class="btn" data-cm="import">套用這份名單</button></details></section>
    <section class="t-sec"><h3>3. 今天誰請假？｜出席 ${CM.present(f).length} 人</h3><p class="small muted">點選今天缺席的座號；只影響這堂課，不刪除班級名單。未標缺席的人會列入分組。</p><div class="roster-grid attendance">${f.roster.map(n=>`<button data-cm="absent" data-seat="${n}" aria-pressed="${absent.has(n)}">${n}${absent.has(n)?' 缺席':''}</button>`).join('')}</div></section>
    <section class="t-sec"><h3>4. 分組與微調</h3>${f.id?`<button class="btn ghost" data-cm="reuse">沿用已儲存分組</button>`:''}${CM.grouping(f)}</section>
    <section class="t-sec"><h3>5. 儲存或直接開課</h3><div class="pillset">${[1,2].map(n=>`<button data-act="flesson" data-v="${n}" aria-pressed="${f.lesson===n}">${esc(LESSONS[n].title)}</button>`).join('')}</div>${f.lesson===2?`<label class="lab">帶入第 1 節的產品<select data-cm-bind="from"><option value="">不帶入</option>${T.sessions.filter(s=>s.lesson===1 && (s.profileId===f.id || s.classKey===f.classKey)).map(s=>`<option value="${s.id}" ${f.from===s.id?'selected':''}>${esc(s.label)} · ${new Date(s.created_at).toLocaleDateString('zh-TW')}</option>`).join('')}</select></label>`:''}${f.error?`<div class="banner bad">${esc(f.error)}</div>`:''}<p class="small muted">儲存會保留完整班級名單與分組；今天的缺席名單只記在這堂課。PDF 一張 A4 六張，附裁切線，可重複使用。</p><div class="row"><button class="btn" data-cm="save" ${dis(!CM.saving && !CM.launching)}>儲存班級名單與分組</button><button class="btn" data-cm="saveqr" ${dis(!CM.saving && !CM.launching)}>儲存並產生 QR 桌卡 PDF</button><button class="btn primary" data-cm="create" ${dis(!CM.saving && !CM.launching)}>儲存並開始上課</button><button class="btn ghost" data-act="cancelform">取消</button></div></section>`;
  },
  async create(f) {
    if(CM.launching)return;CM.launching=true;
    try {
    const c=await CM.save(f); if(!c) return;
    const map=CM.activeMap(f), roles=buildRoles(map,f.lesson), state={page:LESSONS[f.lesson].pages[0].id,pages:{},classKey:c.class_key,profileId:c.id,roster:[...f.roster],absent:[...f.absent],baseGroups:{...f.map}};
    if(f.lesson===2 && f.from) { const r=await rpc('lesson_teacher_poll',{p_token:T.token,p_id:f.from,p_with_private:false});if(!r?.ok){f.error='無法讀取第 1 節產品，請稍後再試或改選「不帶入」。';render(true);return;}
      state.products={};(r.responses||[]).filter(x=>x.page==='1-8' && x.owner[0]==='g').forEach(x=>{const d=x.sent||x.data;if(d?.product)state.products[x.owner.slice(1)]=productText(d.product);}); }
    if(CM.saving) return;CM.saving=true;render(true);
    const r=await rpc('lesson_create',{p_token:T.token,p_lesson:f.lesson,p_label:f.label,p_seats:CM.present(f).length,p_groups:map,p_reps:roles.reps,p_ai:roles.ai,p_state:state});
    CM.saving=false;
    if(r?.ok) location.href='?s='+encodeURIComponent(r.id);else{f.error='建立課堂失敗，班級名單已保存，請再試一次。';render(true);}
    } finally {CM.launching=false;render(true);}
  },
  beginSessionEdit() {
    const f=CM.form({id:null,roster:Object.keys(groupsMap()).map(Number),groups:groupsMap(),label:T.session.class_label});
    CM.sessionEdit=f;render(true);
  },
  async saveSession() {
    const f=CM.sessionEdit, err=CM.validate(f);if(err){toast(err);return;}
    const roles=buildRoles(f.map,T.session.lesson);
    const r=await rpc('lesson_teacher_update',{p_token:T.token,p_id:T.sid,p_rev:T.session.rev,p_state:null,p_groups:f.map,p_reps:roles.reps,p_ai:roles.ai});
    if(r?.ok){CM.sessionEdit=null;await refresh();toast('已更新這堂課的分組與代表。');}else toast('更新失敗或課堂已變更，請重新整理後再試。');
  }
};

document.addEventListener('click', async e=>{
  const t=e.target.closest('[data-cm]');if(!t || t.disabled)return;
  const act=t.dataset.cm,ctx=t.dataset.ctx||'form',f=ctx==='session'?CM.sessionEdit:T.form,n=+t.dataset.seat;
  if(act==='new'){CM.open();return;}if(act==='open'){CM.open(t.dataset.id);return;}
  if(act==='qr'){const c=CM.classes.find(c=>c.id===t.dataset.id);if(c)QRDesk.open(c);return;}
  if(act==='sessionedit'){CM.beginSessionEdit();return;}if(act==='sessionsave'){await CM.saveSession();return;}
  if(act==='sessioncancel'){CM.sessionEdit=null;render(true);return;}
  if(!f)return;
  switch(act){
    case 'range':case 'allseats':{const max=Number(f.maxSeat);if(!Number.isInteger(max)||max<1||max>120){f.error='最大座號須為 1～120。';break;}const old=Math.max(...f.roster,0);f.roster=act==='allseats'?Array.from({length:max},(_,i)=>i+1):[...f.roster.filter(n=>n<=max),...Array.from({length:Math.max(0,max-old)},(_,i)=>old+i+1)];f.absent=f.absent.filter(n=>f.roster.includes(n));f.map=Object.fromEntries(f.roster.map(n=>[n,f.map[n]||1]));break;}
    case 'roster': if(f.roster.includes(n)){f.roster=f.roster.filter(x=>x!==n);delete f.map[n];f.absent=f.absent.filter(x=>x!==n);}else{f.roster.push(n);f.roster.sort((a,b)=>a-b);f.map[n]=1;}break;
    case 'absent': f.absent=f.absent.includes(n)?f.absent.filter(x=>x!==n):[...f.absent,n];f.selected=null;break;
    case 'import':try{f.roster=CM.parseSeats(f.importText);f.maxSeat=Math.max(...f.roster);f.absent=[];CM.auto(f);}catch(err){f.error=err.message;}break;
    case 'auto':case 'random': CM.auto(f,act==='random');break;
    case 'select':f.selected=f.selected===n?null:n;break;
    case 'move':if(f.selected && CM.present(f).includes(f.selected)){f.map[f.selected]=+t.dataset.g;f.selected=null;}break;
    case 'reuse':{const c=CM.classes.find(c=>c.id===f.id);if(c){f.map=Object.fromEntries(f.roster.map(n=>[n,c.groups[n]||1]));f.groupCount=Math.max(...Object.values(f.map),1);}break;}
    case 'save':if(await CM.save(f))toast('班級名單與分組已儲存。');return;
    case 'saveqr':{const c=await CM.save(f);if(c){QRDesk.open(c);await QRDesk.download(c);}return;}
    case 'create':await CM.create(f);return;
  }render(true);
});
document.addEventListener('input',e=>{
 const t=e.target,k=t.dataset.cmBind;if(!k)return;const f=t.dataset.ctx==='session'?CM.sessionEdit:T.form;if(!f)return;f[k]=t.value;f.error='';
});
document.addEventListener('change',e=>{
 const t=e.target,k=t.dataset.cmBind;if(!k)return;const f=t.dataset.ctx==='session'?CM.sessionEdit:T.form;if(!f)return;f[k]=t.value;
 if(k==='grade'||k==='classNo')f.label=({7:'七',8:'八',9:'九'}[f.grade]||f.grade)+'年 '+f.classNo+' 班';
 render(true);
});
document.addEventListener('dragstart',e=>{const t=e.target.closest('[data-cm="select"]');if(!t)return;const f=t.dataset.ctx==='session'?CM.sessionEdit:T.form;if(!f)return;CM.dragging=true;f.selected=+t.dataset.seat;e.dataTransfer.setData('text/plain',t.dataset.seat);e.dataTransfer.effectAllowed='move';});
document.addEventListener('dragover',e=>{if(e.target.closest('[data-drop-group]'))e.preventDefault();});
document.addEventListener('dragend',()=>{CM.dragging=false;render(true);});
document.addEventListener('drop',e=>{CM.dragging=false;const target=e.target.closest('[data-drop-group]');if(!target)return;e.preventDefault();const f=target.dataset.ctx==='session'?CM.sessionEdit:T.form,n=+e.dataTransfer.getData('text/plain');if(f && CM.present(f).includes(n)){f.map[n]=+target.dataset.dropGroup;f.selected=null;render(true);}});
