/* A4 desk cards: local generation, fixed class URL, four-module QR quiet zone. */
const QRDesk = {
  profile:null, copies:1, busy:false,
  url(c) { return new URL('index.html',location.href).href.split('?')[0]+'?k='+encodeURIComponent(c.class_key || c.classKey); },
  groups(c) { return groupIds(c.groups || c.map || {}).length ? groupIds(c.groups || c.map) : [1]; },
  open(c) { QRDesk.profile=c;QRDesk.copies=1;QRDesk.show(); },
  show() {
    document.getElementById('qr-dialog')?.remove();
    const c=QRDesk.profile;if(!c)return;
    const el=document.createElement('dialog');el.id='qr-dialog';el.className='qr-dialog';
    el.innerHTML=`<div class="row"><h2 style="flex:1">${esc(c.label)}｜班級 QR Code</h2><button class="btn ghost" data-qr="close" aria-label="關閉 QR Code">關閉</button></div><div class="qr-preview" role="img" aria-label="${esc(c.label)}班級 QR Code">${QRDesk.svg(QRDesk.url(c))}</div><p>學生掃描後輸入自己的座號。老師開這班的新課時，同一張 QR Code 會自動接到新課，不必重印。</p><label>每組幾張？ <select id="qr-copies">${[1,2,3,4].map(n=>`<option ${QRDesk.copies===n?'selected':''}>${n}</option>`).join('')}</select></label><p class="small muted">${QRDesk.groups(c).length} 組 · 共 ${QRDesk.groups(c).length*QRDesk.copies} 張 · A4 每頁六張，含虛線裁切。桌卡標示組別，登入仍依實際座號分組。</p><div class="row"><button class="btn primary" data-qr="pdf">下載桌卡 PDF</button><button class="btn" data-qr="print">直接列印</button></div><p id="qr-status" role="status"></p><details><summary>查看學生網址</summary><a href="${esc(QRDesk.url(c))}" target="_blank" rel="noopener">${esc(QRDesk.url(c))}</a></details>`;
    document.body.appendChild(el);el.showModal();el.querySelector('button').focus();
  },
  svg(url) { try {const q=qrcode(0,'M');q.addData(url);q.make();return q.createSvgTag({cellSize:6,margin:24,scalable:true});}catch(e){return '<p>QR Code 產生失敗，請重新整理。</p>';} },
  async canvases(c) {
    if(document.fonts){await document.fonts.ready;await document.fonts.load('bold 48px "Noto Sans TC"');}
    const list=[];
    for(const group of QRDesk.groups(c)) for(let copy=0;copy<QRDesk.copies;copy++){
      const canvas=document.createElement('canvas');canvas.width=1122;canvas.height=1091;
      const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
      const text=(s,y,size=36,bold=false)=>{ctx.fillStyle='#18261f';ctx.font=`${bold?'bold ':''}${size}px "Noto Sans TC", "PingFang TC", sans-serif`;ctx.textAlign='center';ctx.fillText(s,561,y,1010);};
      text(c.label,85,48,true);text('第 '+group+' 組｜產品設計課堂',145,36,true);
      const qr=qrcode(0,'M');qr.addData(QRDesk.url(c));qr.make();const n=qr.getModuleCount(),unit=Math.floor(560/(n+8)),width=(n+8)*unit,left=Math.floor((1122-width)/2),top=185;
      ctx.fillStyle='#000';for(let row=0;row<n;row++)for(let col=0;col<n;col++)if(qr.isDark(row,col))ctx.fillRect(left+(col+4)*unit,top+(row+4)*unit,unit,unit);
      text('1. 掃描 QR Code',810,35,true);text('2. 輸入自己的座號',862,35,true);text('3. 等老師開課，就會自動進入',914,35,true);
      text('同班每節課共用這張；請沿虛線剪開放在桌上',975,25);
      const url=QRDesk.url(c);text(url.slice(0,65),1023,20);if(url.length>65)text(url.slice(65),1051,20);
      list.push(canvas);
    }return list;
  },
  async pdfBytes(c) {
    if(!window.PDFLib)throw Error('PDF 元件尚未載入，請重新整理後再試。');
    const doc=await PDFLib.PDFDocument.create();doc.setTitle(c.label+' QR Code 桌卡');doc.setCreator('產品設計課堂');
    const cards=await QRDesk.canvases(c),mm=72/25.4,w=210*mm,h=297*mm,margin=10*mm,cw=95*mm,ch=(277/3)*mm;
    for(let start=0;start<cards.length;start+=6){const page=doc.addPage([w,h]);for(let k=0;k<6 && start+k<cards.length;k++){
      const img=await doc.embedPng(cards[start+k].toDataURL('image/png'));const x=margin+(k%2)*cw,y=h-margin-(Math.floor(k/2)+1)*ch;
      page.drawImage(img,{x,y,width:cw,height:ch});
    }
    for(let col=0;col<=2;col++)page.drawLine({start:{x:margin+col*cw,y:margin},end:{x:margin+col*cw,y:h-margin},thickness:.5,color:PDFLib.rgb(.6,.65,.62),dashArray:[3,3]});
    for(let row=0;row<=3;row++)page.drawLine({start:{x:margin,y:margin+row*ch},end:{x:w-margin,y:margin+row*ch},thickness:.5,color:PDFLib.rgb(.6,.65,.62),dashArray:[3,3]});
    }return doc.save();
  },
  async download(c=QRDesk.profile) {
    if(QRDesk.busy || !c)return;QRDesk.busy=true;QRDesk.status('正在建立 PDF，請稍候…');
    try {const bytes=await QRDesk.pdfBytes(c),url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));const a=document.createElement('a');a.href=url;a.download=c.label.replace(/[\\/:*?"<>|]/g,'_')+'-QR桌卡.pdf';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);QRDesk.status('PDF 已建立，請查看下載項目。');}
    catch(e){QRDesk.status(e.message||'PDF 產生失敗，請重試。');}finally{QRDesk.busy=false;}
  },
  async print() {
    if(QRDesk.busy)return;QRDesk.busy=true;QRDesk.status('正在準備列印…');
    try {const cards=await QRDesk.canvases(QRDesk.profile);document.getElementById('qr-print-frame')?.remove();const frame=document.createElement('iframe');frame.id='qr-print-frame';frame.style.cssText='position:fixed;width:0;height:0;border:0';document.body.appendChild(frame);
      const d=frame.contentDocument;d.open();d.write('<!doctype html><meta charset="utf-8"><title>QR 桌卡</title><style>@page{size:A4;margin:10mm}*{box-sizing:border-box}body{margin:0}.sheet{width:190mm;height:277mm;display:grid;grid-template-columns:95mm 95mm;grid-template-rows:repeat(3,92.333mm);break-after:page}.sheet:last-child{break-after:auto}img{width:95mm;height:92.333mm;border:.2mm dashed #aaa;object-fit:contain;display:block}</style>');
      for(let i=0;i<cards.length;i+=6)d.write('<section class="sheet">'+cards.slice(i,i+6).map(c=>'<img src="'+c.toDataURL('image/png')+'">').join('')+'</section>');d.close();await Promise.all([...d.images].map(img=>img.decode()));frame.contentWindow.focus();frame.contentWindow.print();QRDesk.status('已開啟列印視窗。');
    }catch(e){QRDesk.status('列印準備失敗，可改下載 PDF 後列印。');}finally{QRDesk.busy=false;}
  },
  status(text) {const el=document.getElementById('qr-status');if(el)el.textContent=text;}
};
document.addEventListener('click',e=>{const t=e.target.closest('[data-qr]');if(!t)return;if(t.dataset.qr==='close')document.getElementById('qr-dialog')?.close();if(t.dataset.qr==='pdf')QRDesk.download();if(t.dataset.qr==='print')QRDesk.print();});
document.addEventListener('change',e=>{if(e.target.id==='qr-copies'){QRDesk.copies=Math.max(1,Math.min(4,+e.target.value));QRDesk.show();}});
