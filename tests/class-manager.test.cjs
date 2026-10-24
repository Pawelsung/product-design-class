const vm=require('vm'),fs=require('fs'),assert=require('assert');
const root=require('path').join(__dirname,'../');
const ctx=vm.createContext({URLSearchParams,URL,location:{search:'',href:'https://pawelsung.github.io/product-design-class/teacher.html'},localStorage:{getItem:()=>null},document:{getElementById:()=>null,addEventListener:()=>{},body:{classList:{add:()=>{}}}},window:{},setTimeout,clearTimeout,setInterval:()=>{},console});
for(const f of ['content','common','class-manager','qr-desk','teacher'])vm.runInContext(fs.readFileSync(root+'js/'+f+'.js','utf8').replace(/\nboot\(\);/,''),ctx);
vm.runInContext(`
const f=CM.form(); f.roster=f.roster.filter(n=>![4,6].includes(n)); f.absent=[8]; f.groupValue=6;CM.auto(f);
if(f.roster.length!==28||CM.present(f).length!==27)throw Error('attendance count');
if(CM.activeMap(f)[4]||CM.activeMap(f)[6]||CM.activeMap(f)[8]||!CM.activeMap(f)[30])throw Error('noncontiguous seats');
const sizes=Object.values(groupSeats(CM.activeMap(f))).map(g=>g.length);if(Math.max(...sizes)-Math.min(...sizes)>1)throw Error('unbalanced');
f.groupMode='size';f.groupValue=5;CM.auto(f,true);if(Object.values(groupSeats(CM.activeMap(f))).some(g=>g.length>5))throw Error('group size');
if(CM.validate(f))throw Error(CM.validate(f));
for(const bad of ['1,1','0,2','1,foo','121']){let threw=false;try{CM.parseSeats(bad)}catch(e){threw=true;}if(!threw)throw Error('bad import accepted');}
if(CM.parseSeats('1\\n2\\n3\\n5\\n30').join(',')!=='1,2,3,5,30')throw Error('import failed');
T.form=f;T.session={lesson:1,seats:27,groups:CM.activeMap(f),state:{pages:{}},class_label:'九年 1 班'};
if(loginTab().includes('>4</span>')||loginTab().includes('>6</span>')||!loginTab().includes('>30</span>'))throw Error('login grid wrong');
if(missingList([1,2,3,5,7,...Array.from({length:22},(_,i)=>i+9)]).includes('4 號'))throw Error('missing list uses count');
if(parseRoster('1,2\\n30',[1,2,30]).error)throw Error('advanced roster blocks sparse seats');
if(!CM.view(f).includes('班級 QR Code 自動建立'))throw Error('new form missing');
`,ctx);
console.log('Passed: sparse roster, absence, balanced random and sequential groups, max group size, import validation, teacher grids and class setup');
