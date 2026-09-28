/* Browser-only setup workflow example; no production writes. */
'use strict';
Object.assign(messages.ko, {
 setupTitle:'현장 셋업', setupNotice:'조정안을 작업 지시로 반영하고 진행 상태를 체크해 보세요. 브라우저 전용 예시입니다.',
 setupPublish:'조정안으로 셋업 예시 시작',setupView:'셋업 현황',setupStart:'셋업 시작',setupComplete:'셋업 완료',
 setupReadyNote:'완료는 준비 완료를 뜻합니다. 정상 가동·생산 시작은 별도로 확인합니다.',setupNone:'셋업 대상 아님',
 setupEmpty:'변경 조정안을 먼저 만드세요.',setupWaiting:'○ 대기',setupWorking:'◐ 진행 중',setupDone:'✓ 완료',
 setupAll:'모든 셋업 상태',setupFrozen:'작업 지시 고정 · 이후 초안 편집과 별개',setupPublished:'목표 배치가 예시 설비정보에 즉시 반영됐습니다.',
 setupNotPublished:'아직 셋업 작업 지시가 없습니다.',setupScope:'1공장 전체 변경 대상',setupTarget:'설비정보 · 목표',setupAt:'반영',setupStarted:'시작',setupFinished:'완료',setupActor:'시안 사용자',setupSaved:'셋업 상태를 브라우저에 저장했습니다.',setupFailed:'저장에 실패했습니다. 상태를 변경하지 않았습니다.'
});
Object.assign(messages.vi, {
 setupTitle:'Setup tại xưởng',setupNotice:'Thử áp dụng bản điều chỉnh và đánh dấu tiến độ. Chỉ là ví dụ trên trình duyệt.',
 setupPublish:'Tạo ví dụ setup từ bản nháp',setupView:'Tiến độ setup',setupStart:'Bắt đầu setup',setupComplete:'Hoàn tất setup',
 setupReadyNote:'Hoàn tất nghĩa là sẵn sàng. Vận hành và bắt đầu sản xuất được xác nhận riêng.',setupNone:'Không cần setup',
 setupEmpty:'Hãy tạo thay đổi trước.',setupWaiting:'○ Chờ',setupWorking:'◐ Đang setup',setupDone:'✓ Hoàn tất',
 setupAll:'Mọi trạng thái setup',setupFrozen:'Lệnh đã cố định · Tách biệt bản nháp',setupPublished:'Model mục tiêu đã cập nhật ngay trong ví dụ.',
 setupNotPublished:'Chưa có lệnh setup.',setupScope:'Máy thay đổi toàn nhà máy 1',setupTarget:'Máy · Mục tiêu',setupAt:'Áp dụng',setupStarted:'Bắt đầu',setupFinished:'Hoàn tất',setupActor:'Người dùng mẫu',setupSaved:'Đã lưu tiến độ trên trình duyệt.',setupFailed:'Lưu thất bại. Trạng thái chưa thay đổi.'
});
const setupKey='cnc-layout-setup-preview-v1-'+DATA.sha256;
let setupBatch=null;
const statusKey={pending:'setupWaiting',in_progress:'setupWorking',completed:'setupDone'};
function validSetup(value){return value?.sourceHash===DATA.sha256 && typeof value.version==='string' && value.tasks && Object.entries(value.tasks).every(([id,task])=>machines.has(Number(id)) && statusKey[task.status] && task.target && [...DATA.models,''].includes(task.target.model) && ['C0','C1','C2'].includes(task.target.process) && Array.isArray(task.events));}
try{const value=JSON.parse(localStorage.getItem(setupKey)||'null');if(validSetup(value))setupBatch=value;}catch{/* Ignore invalid local examples. */}
function saveSetup(next){try{localStorage.setItem(setupKey,JSON.stringify(next));setupBatch=next;return true;}catch{toast(t('setupFailed'));return false;}}
window.setupTask=id=>setupBatch?.tasks[id]||null;
window.setupAssignment=m=>window.setupTask(m.id)?.target||baseAssignment(m);
window.setupMatches=id=>{const filter=$('setupFilter').value;return !filter||(window.setupTask(id)?.status||'none')===filter;};
window.setupBadge=(g,task)=>{if(!task)return;const badge=svgEl('text',{x:85,y:27,fill:{pending:'#697789',in_progress:'#bb6410',completed:'#16774d'}[task.status],'font-size':20,'font-weight':700});g.querySelector('.change-mark')?.remove();badge.textContent={pending:'○',in_progress:'◐',completed:'✓'}[task.status];g.append(badge);g.dataset.setup=task.status;g.setAttribute('aria-label',g.getAttribute('aria-label')+' '+t(statusKey[task.status]));};
window.renderSetup=()=>{
 const active=mode==='setup',task=window.setupTask(selected),tasks=Object.values(setupBatch?.tasks||{});
 $('setupPublish').disabled=!!setupBatch||!changedIds().length;
 $('setupPublish').textContent=t(setupBatch?'setupFrozen':'setupPublish');
 $('setupCounts').textContent=setupBatch?t('setupScope')+' '+tasks.length+' · '+['pending','in_progress','completed'].map(s=>t(statusKey[s])+' '+tasks.filter(task=>task.status===s).length).join(' / '):t('setupNotPublished');
 $('setupFilter').hidden=!active;const filter=$('setupFilter').value;setOptions($('setupFilter'),[['',t('setupAll')],...Object.entries(statusKey).map(([s,key])=>[s,t(key)]),['none',t('setupNone')]],filter);
 $('setupPanel').hidden=!active;
 for(const selector of ['.assignment','#selectionStatus','#editForm','#lock','.inspector > .help','.changes-section','.review-box'])document.querySelector(selector).hidden=active;
 $('modelFilter').hidden=active;$('changedOnly').parentElement.hidden=active;
 if(!active){$('stageLabel').textContent=t('sourceBaseline');return;}
 $('legend').replaceChildren();for(const [status,key] of Object.entries(statusKey)){const item=document.createElement('span');item.textContent=t(key);item.dataset.state=status;$('legend').append(item);}
 $('stageLabel').textContent=t('setupView')+' · '+(setupBatch?.version||'—');
 $('setupState').textContent=t(task?statusKey[task.status]:(setupBatch?'setupNone':'setupNotPublished'));$('setupState').dataset.state=task?.status||'none';
 $('setupTarget').textContent=t('setupTarget')+': '+label(window.setupAssignment(machines.get(selected)))+(task?' ('+label(task.before)+' → '+label(task.target)+')':'');
 $('setupTimes').replaceChildren();
 if(task)for(const event of task.events){const line=document.createElement('div');line.textContent=t({pending:'setupAt',in_progress:'setupStarted',completed:'setupFinished'}[event.status])+' · '+new Date(event.at).toLocaleString(lang==='ko'?'ko-KR':'vi-VN')+' · '+t('setupActor');$('setupTimes').append(line);}
 $('setupStart').hidden=!task||task.status!=='pending';$('setupComplete').hidden=!task||task.status!=='in_progress';
};
$('setupFilter').onchange=()=>renderMap();
$('setupPublish').onclick=()=>{
 if(setupBatch||!changedIds().length)return;
 const at=new Date().toISOString(),tasks={};
 for(const id of changedIds())tasks[id]={before:baseAssignment(machines.get(id)),target:copy(assignment(machines.get(id))),status:'pending',events:[{status:'pending',at,actor:'preview-user'}]};
 if(!saveSetup({previewOnly:true,sourceHash:DATA.sha256,version:'EXAMPLE-1',at,tasks}))return;
 mode='setup';selectMachine(changedIds()[0],true);toast(t('setupPublished'));
};
function transitionSetup(from,to){const task=window.setupTask(selected);if(!task||task.status!==from)return;const next=copy(setupBatch);next.tasks[selected].status=to;next.tasks[selected].events.push({status:to,at:new Date().toISOString(),actor:'preview-user'});if(saveSetup(next)){render();toast(t('setupSaved'));}}
$('setupStart').onclick=()=>transitionSetup('pending','in_progress');
$('setupComplete').onclick=()=>transitionSetup('in_progress','completed');
const originalPreviewState=window.previewState;
window.previewState=()=>({...originalPreviewState(),setup:copy(setupBatch)});
// Refresh with setup translations available. Draft history never mutates setupBatch.
translate();
