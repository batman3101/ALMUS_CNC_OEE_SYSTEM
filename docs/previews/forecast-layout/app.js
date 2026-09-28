/* Standalone UI proposal. No production, AI, or database connections. */
'use strict';
const DATA = window.LAYOUT_DATA;
const $ = id => document.getElementById(id);
const ns = 'http://www.w3.org/2000/svg';
const copy = value => JSON.parse(JSON.stringify(value));
const machines = new Map(DATA.machines.map(m => [m.id, m]));
const colors = {ON1:['#fff2c9','#c79d29'],ON3:['#f9eed5','#bc8f37'],H8M:['#ddecfa','#3885c7'],H8S:['#deedf4','#498ca3'],M1:['#e9eef5','#7b8da4'],M3:['#e1f0e7','#509477'],PA1:['#e8edfa','#7c86bd'],B6S6:['#e9efdd','#89a25c']};
const messages = {
 ko:{factory:'1공장 · 800대',breadcrumb:'생산 계획 / Layout',title:'배치는 그대로, 변경은 필요한 만큼.',subtitle:'W39 Excel 배치를 기준으로 설비를 살펴보고 다음 배치를 조정하세요.',demo:'변경 예시 보기',save:'초안 저장',notice:'UI 시안 · 위치와 모델은 원본 Excel 기준입니다. 편집은 이 브라우저에만 저장되며 운영 설비에 적용되지 않습니다.',buildingSuffix:'동',all:'전체',current:'원본 배치',draft:'조정안',compare:'변경 비교',changedOnly:'변경만',demoBadge:'직접 만든 변경 예시 · CAPA 미검증',fit:'전체 맞춤',overview:'전체 위치',hint:'드래그로 이동 · 휠 / 핀치로 확대',source:'Setting CNC.xlsx / W39 · 상단 배치만 참조',export:'초안 내보내기',selection:'선택 설비',before:'원본',after:'조정안',targetModel:'변경할 모델',targetProcess:'가공 공정',applyEdit:'조정안에 반영',unvalidated:'T/T·가공 호환성이 연결되지 않아 CAPA와 실행 가능 여부는 아직 판단하지 않습니다.',changes:'변경 목록',pending:'CAPA 검증 대기',pendingText:'가동시간·효율과 설비별 T/T 연결 후 확정할 수 있습니다.',confirm:'Layout 확정 적용',reset:'원본으로 새 초안',footer:'A/B동은 같은 1공장의 건물 구분입니다. 2공장 배치는 별도 자료가 필요합니다.',resetTitle:'원본 배치로 새 초안을 만들까요?',resetText:'현재 편집 내용은 이력에 남으며 되돌리기로 복원할 수 있습니다.',cancel:'취소',search:'설비 번호 검색',allModels:'모든 모델',sourceBaseline:'W39 · Excel 기준 배치',count:'대',building:'동',cell:'원본 셀',unchanged:'원본 배치와 같습니다.',modified:'사용자가 수정한 배치 · 검증 전',fixed:'고정된 배치입니다. 수정하려면 잠금을 해제하세요.',lock:'이 배치 고정',unlock:'배치 잠금 해제',empty:'아직 변경한 설비가 없습니다.\n설비를 선택하거나 변경 예시를 확인하세요.',saved:'이 브라우저에 초안을 저장했습니다.',autosaved:'브라우저 초안 자동 저장',original:'원본 Excel을 보고 있습니다.',missing:'해당 설비를 찾을 수 없습니다. 1~800번으로 검색하세요.',updated:'조정안에 반영했습니다. CAPA 검증은 필요합니다.',same:'현재 조정안과 같습니다.',locked:'고정한 설비는 수정할 수 없습니다.',localError:'브라우저 저장소를 사용할 수 없습니다. 내보내기로 보관하세요.',demoLoaded:'가상 변경 예시를 불러왔습니다. 실제 추천 결과가 아닙니다.',restore:'이전 브라우저 초안을 복구했습니다.',reverted:'원본 기준 새 초안을 만들었습니다.',noSelection:'설비를 먼저 선택하세요.',changed:'변경',fixedLegend:'고정',free:'대기 (모델 제거)',filterEmpty:'조건에 맞는 설비가 없습니다.',demoDirty:'기존 편집/잠금을 보존하려면 새 초안에서 예시를 시작하세요.',draftExport:'초안 파일을 내보냈습니다.',zoomLabel:'설비 배치도: 드래그 이동, +/− 확대 축소',lastSaved:'저장',previewOnly:'시안 · 운영 적용 없음'},
 vi:{factory:'Nhà máy 1 · 800 máy',breadcrumb:'Kế hoạch sản xuất / Layout',title:'Giữ bố trí. Chỉ đổi khi cần.',subtitle:'Xem và điều chỉnh bố trí theo Excel W39.',demo:'Xem ví dụ thay đổi',save:'Lưu bản nháp',notice:'Bản mẫu UI · Vị trí và model lấy từ Excel. Thay đổi chỉ lưu trên trình duyệt, không áp dụng vào máy thực tế.',buildingSuffix:'',all:'Tất cả',current:'Bố trí gốc',draft:'Bản điều chỉnh',compare:'So sánh',changedOnly:'Chỉ thay đổi',demoBadge:'Ví dụ thay đổi · Chưa kiểm tra CAPA',fit:'Vừa khung',overview:'Tổng quan',hint:'Kéo để di chuyển · Cuộn / chụm để thu phóng',source:'Setting CNC.xlsx / W39 · Chỉ bố trí phía trên',export:'Xuất bản nháp',selection:'Máy đã chọn',before:'Gốc',after:'Điều chỉnh',targetModel:'Model mới',targetProcess:'Công đoạn',applyEdit:'Cập nhật bản nháp',unvalidated:'Chưa kết nối T/T và khả năng gia công. CAPA và tính khả thi chưa được xác nhận.',changes:'Danh sách thay đổi',pending:'Chờ kiểm tra CAPA',pendingText:'Cần giờ làm, hiệu suất và T/T từng máy để xác nhận.',confirm:'Áp dụng Layout',reset:'Bản nháp từ bố trí gốc',footer:'A/B là hai xưởng của nhà máy 1. Nhà máy 2 cần dữ liệu riêng.',resetTitle:'Tạo bản nháp từ bố trí gốc?',resetText:'Các chỉnh sửa được giữ trong lịch sử và có thể hoàn tác.',cancel:'Hủy',search:'Tìm số máy',allModels:'Tất cả model',sourceBaseline:'W39 · Bố trí từ Excel',count:'máy',building:'Xưởng',cell:'Ô gốc',unchanged:'Giống bố trí gốc.',modified:'Bố trí người dùng sửa · Chưa kiểm tra',fixed:'Bố trí đã khóa. Mở khóa để sửa.',lock:'Khóa bố trí này',unlock:'Mở khóa bố trí',empty:'Chưa có thay đổi.\nChọn máy hoặc xem ví dụ thay đổi.',saved:'Đã lưu bản nháp trên trình duyệt này.',autosaved:'Tự lưu trên trình duyệt',original:'Đang xem bố trí Excel gốc.',missing:'Không tìm thấy máy. Nhập số 1–800.',updated:'Đã cập nhật bản nháp. Cần kiểm tra CAPA.',same:'Giống bản nháp hiện tại.',locked:'Không thể sửa máy đã khóa.',localError:'Không thể lưu trên trình duyệt. Hãy xuất bản nháp.',demoLoaded:'Đã tải ví dụ. Đây không phải kết quả tối ưu thực tế.',restore:'Đã khôi phục bản nháp.',reverted:'Đã tạo bản nháp từ bố trí gốc.',noSelection:'Hãy chọn máy.',changed:'Đổi',fixedLegend:'Khóa',free:'Chờ (bỏ model)',filterEmpty:'Không có máy phù hợp.',demoDirty:'Hãy tạo bản nháp mới trước khi tải ví dụ để giữ các chỉnh sửa.',draftExport:'Đã xuất bản nháp.',zoomLabel:'Bố trí máy: kéo di chuyển, +/− thu phóng',lastSaved:'Đã lưu',previewOnly:'Bản mẫu · Không áp dụng thực tế'}
};
let lang='ko', building='B', mode='draft', selected=305;
let draft={edits:{},locks:[],demo:false}, undoStack=[], redoStack=[];
let scale=.56, tx=0, ty=0, saveTime=null, toastTimer;
const storageKey='cnc-layout-preview-v1-'+DATA.sha256;
const t = key => messages[lang][key] || key;
const buildingName = b => lang==='ko' ? b+'동' : 'Xưởng '+b;
const displayName = id => 'CNC-'+String(id).padStart(3,'0');
const baseAssignment = m => ({model:m.model,process:m.process});
const assignment = m => draft.edits[m.id] || baseAssignment(m);
const label = a => a.model ? a.model+'-'+a.process : t('free');
const changedIds = () => Object.keys(draft.edits).map(Number).sort((a,b)=>a-b);
const visibleMachines = () => DATA.machines.filter(m=>building==='all'||m.building===building);
const svgEl = (tag,attrs={}) => {const e=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);return e;};
function toast(message){$('toast').textContent=message;$('toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),3200);}
function persist(showToast=false){try{localStorage.setItem(storageKey,JSON.stringify({version:1,hash:DATA.sha256,draft,undoStack:undoStack.slice(-30),redoStack:redoStack.slice(-30),at:Date.now()}));saveTime=new Date();if(showToast)toast(t('saved'));}catch{toast(t('localError'));}renderSaveStatus();}
function renderSaveStatus(){$('saveStatus').textContent=saveTime?t('autosaved')+' · '+saveTime.toLocaleTimeString(lang==='ko'?'ko-KR':'vi-VN',{hour:'2-digit',minute:'2-digit'}):t('previewOnly');}
function validDraft(value){return value && value.edits && Array.isArray(value.locks) && value.locks.every(id=>machines.has(id)) && Object.entries(value.edits).every(([id,a])=>machines.has(Number(id))&&a&&[...DATA.models,''].includes(a.model)&&['C0','C1','C2'].includes(a.process));}
try{const raw=JSON.parse(localStorage.getItem(storageKey)||'null');if(raw?.hash===DATA.sha256&&validDraft(raw.draft)){draft=raw.draft;undoStack=(raw.undoStack||[]).filter(validDraft).slice(-30);redoStack=(raw.redoStack||[]).filter(validDraft).slice(-30);saveTime=new Date(raw.at);}}catch{/* Invalid saved preview does not replace the source. */}
function commit(next){undoStack.push(copy(draft));undoStack=undoStack.slice(-30);redoStack=[];draft=next;persist();render();}
function editAssignment(id,a){const next=copy(draft);if(a.model===machines.get(id).model && a.process===machines.get(id).process)delete next.edits[id];else next.edits[id]=a;commit(next);}
function setOptions(select,values,current){select.replaceChildren(...values.map(([value,text])=>{const e=document.createElement('option');e.value=value;e.textContent=text;return e;}));select.value=current;}
function translate(){document.documentElement.lang=lang;document.querySelectorAll('[data-i18n]').forEach(e=>e.textContent=t(e.dataset.i18n));$('search').placeholder=t('search');$('search').setAttribute('aria-label',t('search'));$('stage').setAttribute('aria-label',t('zoomLabel'));$('stageLabel').textContent=t('sourceBaseline');const filter=$('modelFilter').value;setOptions($('modelFilter'),[['',t('allModels')],...DATA.models.map(m=>[m,m])],filter);render();}
function render(){
 document.querySelectorAll('[data-building]').forEach(b=>b.classList.toggle('active',b.dataset.building===building));
 document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
 $('buildingTitle').textContent=building==='all'?t('all'):buildingName(building);
 $('mapCount').textContent=visibleMachines().length+' '+t('count')+' · '+t('sourceBaseline');
 $('demoBadge').hidden=!draft.demo;
 renderMap();renderInspector();renderChanges();renderLegend();renderSaveStatus();if(window.renderSetup)window.renderSetup();
 $('undo').disabled=!undoStack.length;$('redo').disabled=!redoStack.length;
}
function renderMap(){
 const world=$('world');world.replaceChildren();
 for(const b of DATA.buildings.filter(b=>building==='all'||b.id===building)){
  world.append(svgEl('rect',{x:b.x,y:b.y,width:b.width,height:b.height,class:'building-border'}));
  const name=svgEl('text',{x:60,y:b.y+47,class:'building-name'});name.textContent=buildingName(b.id);world.append(name);
  const note=svgEl('text',{x:200,y:b.y+45,class:'building-note'});note.textContent=b.count+' '+t('count')+' / W39';world.append(note);
 }
 const filter=$('modelFilter').value,only=$('changedOnly').checked;
 for(const m of visibleMachines()){
  const a=mode==='setup'&&window.setupAssignment?window.setupAssignment(m):(mode==='current'?baseAssignment(m):assignment(m)),changed=mode==='setup'?!!window.setupTask?.(m.id):!!draft.edits[m.id],locked=mode!=='setup'&&draft.locks.includes(m.id);
  const task=mode==='setup'&&window.setupTask?window.setupTask(m.id):null;
  const dim=(filter&&a.model!==filter)||(mode!=='setup'&&only&&!changed)||(mode==='setup'&&window.setupMatches&&!window.setupMatches(m.id));
  const g=svgEl('g',{class:['machine',selected===m.id?'selected':'',changed&&mode!=='current'?'changed':'',locked?'locked':'',dim?'dim':''].join(' '),transform:`translate(${m.x} ${m.y})`,'data-id':m.id,tabindex:dim?-1:0,role:'button','aria-label':displayName(m.id)+' '+buildingName(m.building)+' '+label(a),'aria-pressed':selected===m.id});
  const palette=colors[a.model]||['#f2f4f7','#aab3c0'];
  g.append(svgEl('rect',{width:104,height:62,fill:palette[0],class:'machine-body'}));
  g.append(svgEl('rect',{x:0,y:9,width:4,height:44,rx:2,fill:palette[1]}));
  const number=svgEl('text',{x:10,y:27,class:'machine-number'});number.textContent=String(m.id).padStart(3,'0');g.append(number);
  if(mode==='compare'&&changed){const old=svgEl('text',{x:10,y:42,fill:'#8794a4','font-size':12});old.textContent=label(baseAssignment(m));g.append(old);const newText=svgEl('text',{x:10,y:56,fill:'#ad6318','font-size':13});newText.textContent='→ '+(a.model?label(a):'—');g.append(newText);}else{const code=svgEl('text',{x:10,y:49,class:'machine-model'});code.textContent=a.model?label(a):'—';g.append(code);}
  if(changed&&mode!=='current'){const mark=svgEl('text',{x:84,y:27,class:'change-mark'});mark.textContent='↗';g.append(mark);}else if(locked){const mark=svgEl('text',{x:86,y:25,fill:'#647790','font-size':21});mark.textContent='▣';g.append(mark);}
  g.addEventListener('click',()=>{if(!wasDrag)selectMachine(m.id);});
  g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectMachine(m.id);}});
  if(mode==='setup'&&window.setupBadge)window.setupBadge(g,task);
  world.append(g);
 }
 transform();renderMinimap();
}
function renderMinimap(){const mini=$('minimap');mini.replaceChildren();for(const b of DATA.buildings){mini.append(svgEl('rect',{x:b.x,y:b.y,width:b.width,height:b.height,fill:'#f0f3f7',stroke:'#b8c6d7','stroke-width':15}));}for(const m of DATA.machines)mini.append(svgEl('rect',{x:m.x,y:m.y,width:104,height:62,fill:draft.edits[m.id]?'#cc7927':(colors[m.model]?.[1]||'#a0adbc')}));mini.append(svgEl('rect',{id:'viewport',fill:'#2357c616',stroke:'#2357c6','stroke-width':30}));updateViewport();}
function transform(){$('world').setAttribute('transform',`translate(${tx} ${ty}) scale(${scale})`);$('zoomValue').textContent=Math.round(scale*100)+'%';updateViewport();}
function updateViewport(){const rect=$('viewport');if(!rect)return;rect.setAttribute('x',-tx/scale);rect.setAttribute('y',-ty/scale);rect.setAttribute('width',$('stage').clientWidth/scale);rect.setAttribute('height',$('stage').clientHeight/scale);}
function zoom(factor,x=$('stage').clientWidth/2,y=$('stage').clientHeight/2){const before=scale;scale=Math.max(.08,Math.min(2.5,scale*factor));tx=x-(x-tx)*scale/before;ty=y-(y-ty)*scale/before;transform();}
function fit(){const bs=DATA.buildings.filter(b=>building==='all'||b.id===building);const left=Math.min(...bs.map(b=>b.x)),top=Math.min(...bs.map(b=>b.y)),right=Math.max(...bs.map(b=>b.x+b.width)),bottom=Math.max(...bs.map(b=>b.y+b.height));const stage=$('stage');scale=Math.min((stage.clientWidth-34)/(right-left),(stage.clientHeight-95)/(bottom-top));tx=(stage.clientWidth-(right-left)*scale)/2-left*scale;ty=58+(stage.clientHeight-95-(bottom-top)*scale)/2-top*scale;transform();}
function focusMachine(id){const m=machines.get(id);if(!m)return;scale=window.innerWidth<760?.76:.58;tx=$('stage').clientWidth/2-(m.x+52)*scale;ty=$('stage').clientHeight/2-(m.y+31)*scale;transform();}
function selectMachine(id,focus=false){selected=id;const m=machines.get(id);if(focus||(building!=='all'&&building!==m.building))building=m.building;$('editModel').value=assignment(m).model;render();if(focus)focusMachine(id);document.querySelector('.inspector').classList.add('mobile-open');}
function renderInspector(){const m=machines.get(selected);const a=assignment(m);$('selectedName').textContent=displayName(m.id);$('selectedLocation').textContent=buildingName(m.building)+' · '+t('cell')+' '+m.cell;$('currentLabel').textContent=label(baseAssignment(m));$('draftLabel').textContent=label(a);const locked=draft.locks.includes(m.id);$('selectionStatus').textContent=locked?t('fixed'):(draft.edits[m.id]?t('modified'):t('unchanged'));$('selectionStatus').classList.toggle('changed',!!draft.edits[m.id]);setOptions($('editModel'),[...DATA.models.map(m=>[m,m]),['',t('free')]],a.model);$('editProcess').value=a.process;$('editModel').disabled=locked;$('editProcess').disabled=locked||!a.model;$('applyEdit').disabled=locked;$('lock').textContent=(locked?'▣ ':'□ ')+t(locked?'unlock':'lock');$('lock').classList.toggle('is-locked',locked);}
function renderChanges(){const ids=changedIds();$('changeCount').textContent=ids.length;$('changes').replaceChildren();if(!ids.length){const empty=document.createElement('div');empty.className='empty';empty.style.whiteSpace='pre-line';empty.textContent=t('empty');$('changes').append(empty);return;}for(const id of ids){const m=machines.get(id),a=assignment(m);const b=document.createElement('button');b.className='change-row';b.dataset.changeId=id;const d=document.createElement('div'),name=document.createElement('strong'),small=document.createElement('small'),value=document.createElement('span');name.textContent=displayName(id)+' · '+buildingName(m.building);small.textContent=label(baseAssignment(m));value.textContent='→ '+label(a);d.append(name,small);b.append(d,value);b.onclick=()=>selectMachine(id,true);$('changes').append(b);}}
function renderLegend(){$('legend').replaceChildren();for(const model of DATA.models){const span=document.createElement('span'),dot=document.createElement('i');dot.style.background=colors[model]?.[1]||'#aaa';span.append(dot,document.createTextNode(model));$('legend').append(span);}const changed=document.createElement('span');changed.textContent='↗ '+t('changed');changed.style.color='#ba741c';$('legend').append(changed);}
document.querySelectorAll('[data-building]').forEach(b=>b.onclick=()=>{building=b.dataset.building;render();fit();});
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{mode=b.dataset.mode;render();});
$('language').onchange=e=>{lang=e.target.value;translate();};
$('modelFilter').onchange=()=>renderMap();$('changedOnly').onchange=()=>renderMap();
$('searchForm').onsubmit=e=>{e.preventDefault();const value=$('search').value.trim().replace(/^CNC[- ]?/i,'');if(!/^\d{1,3}$/.test(value)||!machines.has(Number(value))){toast(t('missing'));return;}$('modelFilter').value='';$('changedOnly').checked=false;$('setupFilter').value='';selectMachine(Number(value),true);};
$('editModel').onchange=()=>{$('editProcess').disabled=!$('editModel').value;};
$('editForm').onsubmit=e=>{e.preventDefault();if(draft.locks.includes(selected)){toast(t('locked'));return;}const a={model:$('editModel').value,process:$('editProcess').value};if(JSON.stringify(a)===JSON.stringify(assignment(machines.get(selected)))){toast(t('same'));return;}mode='draft';editAssignment(selected,a);toast(t('updated'));};
$('lock').onclick=()=>{const next=copy(draft);next.locks=next.locks.includes(selected)?next.locks.filter(id=>id!==selected):[...next.locks,selected];commit(next);};
$('undo').onclick=()=>{if(!undoStack.length)return;redoStack.push(copy(draft));draft=undoStack.pop();persist();render();};
$('redo').onclick=()=>{if(!redoStack.length)return;undoStack.push(copy(draft));draft=redoStack.pop();persist();render();};
$('save').onclick=()=>persist(true);
$('demo').onclick=()=>{if(changedIds().length||draft.locks.length){toast(t('demoDirty'));return;}const next=copy(draft);next.demo=true;for(const [id,model,process] of [[305,'ON1','C1'],[306,'ON1','C1'],[315,'ON1','C2'],[316,'ON1','C2'],[653,'M3','C2'],[654,'M3','C2']])next.edits[id]={model,process};mode='compare';commit(next);selectMachine(305,true);toast(t('demoLoaded'));};
$('reset').onclick=()=>$('resetDialog').showModal();$('cancelReset').onclick=()=>$('resetDialog').close();$('confirmReset').onclick=()=>{commit({edits:{},locks:[],demo:false});$('resetDialog').close();toast(t('reverted'));};
$('export').onclick=()=>{const out={schemaVersion:1,previewOnly:true,sourceFile:DATA.source,sourceSheet:DATA.sheet,sourceHash:DATA.sha256,capacityValidated:false,exportedAt:new Date().toISOString(),edits:changedIds().map(id=>({id,building:machines.get(id).building,sourceCell:machines.get(id).cell,before:baseAssignment(machines.get(id)),after:assignment(machines.get(id))})),lockedIds:draft.locks};const url=URL.createObjectURL(new Blob([JSON.stringify(out,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='layout-w39-preview-draft.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast(t('draftExport'));};
$('closePanel').onclick=()=>document.querySelector('.inspector').classList.remove('mobile-open');
$('zoomIn').onclick=()=>zoom(1.25);$('zoomOut').onclick=()=>zoom(.8);$('fit').onclick=fit;
const stage=$('stage');let pointers=new Map(),pan=null,pinch=null,wasDrag=false;
const point=e=>{const r=stage.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};};
stage.addEventListener('wheel',e=>{if(e.target.closest('.map-tools'))return;e.preventDefault();const p=point(e);zoom(Math.exp(-e.deltaY*.0015),p.x,p.y);},{passive:false});
stage.addEventListener('pointerdown',e=>{if(e.target.closest('.map-tools'))return;wasDrag=false;const p=point(e);pointers.set(e.pointerId,p);if(pointers.size===1){pan={x:p.x,y:p.y,tx,ty,id:e.pointerId};}if(pointers.size===2){const [a,b]=[...pointers.values()];pinch={distance:Math.hypot(a.x-b.x,a.y-b.y),scale,tx,ty,cx:(a.x+b.x)/2,cy:(a.y+b.y)/2};pan=null;}});
stage.addEventListener('pointermove',e=>{if(!pointers.has(e.pointerId))return;const p=point(e);pointers.set(e.pointerId,p);if(pointers.size===2&&pinch){const[a,b]=[...pointers.values()];const cx=(a.x+b.x)/2,cy=(a.y+b.y)/2;scale=Math.max(.08,Math.min(2.5,pinch.scale*Math.hypot(a.x-b.x,a.y-b.y)/Math.max(1,pinch.distance)));tx=cx-(pinch.cx-pinch.tx)*scale/pinch.scale;ty=cy-(pinch.cy-pinch.ty)*scale/pinch.scale;wasDrag=true;transform();}else if(pan){const dx=p.x-pan.x,dy=p.y-pan.y;if(Math.hypot(dx,dy)>4){wasDrag=true;if(!stage.hasPointerCapture(e.pointerId))stage.setPointerCapture(e.pointerId);tx=pan.tx+dx;ty=pan.ty+dy;transform();}}});
function endPointer(e){pointers.delete(e.pointerId);if(stage.hasPointerCapture(e.pointerId))stage.releasePointerCapture(e.pointerId);pinch=null;pan=null;if(pointers.size===1){const [id,p]=[...pointers.entries()][0];pan={id,x:p.x,y:p.y,tx,ty};}setTimeout(()=>{if(!pointers.size)wasDrag=false;},0);}
stage.addEventListener('pointerup',endPointer);stage.addEventListener('pointercancel',endPointer);stage.addEventListener('pointerleave',e=>{if(!stage.hasPointerCapture(e.pointerId))endPointer(e);});
stage.addEventListener('keydown',e=>{if(e.target.closest('button,input,select'))return;if(e.key==='+'||e.key==='='){e.preventDefault();zoom(1.25);}if(e.key==='-'){e.preventDefault();zoom(.8);}const delta={ArrowLeft:[40,0],ArrowRight:[-40,0],ArrowUp:[0,40],ArrowDown:[0,-40]}[e.key];if(delta){e.preventDefault();tx+=delta[0];ty+=delta[1];transform();}});
let previousStageSize={width:stage.clientWidth,height:stage.clientHeight};
new ResizeObserver(()=>{const width=stage.clientWidth,height=stage.clientHeight;tx+=(width-previousStageSize.width)/2;ty+=(height-previousStageSize.height)/2;previousStageSize={width,height};transform();}).observe(stage);
translate();requestAnimationFrame(()=>focusMachine(selected));
window.previewState=()=>({building,mode,selected,scale,tx,ty,draft:copy(draft),machineCount:DATA.machines.length});
