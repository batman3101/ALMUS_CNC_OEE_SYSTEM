/*
 * Layout Studio engine — ported from docs/previews/forecast-layout/{app,setup}.js (2026-09-22 preview,
 * 21 browser scenarios PASS). The behaviour is kept line-for-line on purpose: the preview's verification
 * suite is the acceptance bar for this port, and rewriting the logic is where features get lost.
 *
 * Differences from the preview, and only these:
 *  - Element lookups are scoped to `root` instead of `document` (the app shell has its own ids/buttons).
 *  - Language comes from the app (`setLang`) instead of the preview's own <select>; `<html lang>` is
 *    left to the app.
 *  - Preview globals (`window.setupTask`, `window.renderSetup`, …) are closure-local. The read-only
 *    test hook moved from `window.previewState` to `window.__layoutStudio`.
 *  - `destroy()` releases the ResizeObserver, timers and the test hook when the page unmounts.
 *
 * Browser-only: no API, database or production calls. Drafts and setup examples live in localStorage.
 */
'use strict';

const colors = {ON1:['#fff2c9','#c79d29'],ON3:['#f9eed5','#bc8f37'],H8M:['#ddecfa','#3885c7'],H8S:['#deedf4','#498ca3'],M1:['#e9eef5','#7b8da4'],M3:['#e1f0e7','#509477'],PA1:['#e8edfa','#7c86bd'],B6S6:['#e9efdd','#89a25c']};
const messages = {
 ko:{factory:'1공장 · 800대',breadcrumb:'생산 계획 / Layout',title:'Layout 배치',subtitle:'W39 Excel 배치를 기준으로 설비를 살펴보고 다음 배치를 조정하세요.',demo:'변경 예시 보기',save:'초안 저장',notice:'UI 시안 · 위치와 모델은 원본 Excel 기준입니다. 편집은 이 브라우저에만 저장되며 운영 설비에 적용되지 않습니다.',buildingSuffix:'동',all:'전체',current:'원본 배치',draft:'조정안',compare:'변경 비교',changedOnly:'변경만',demoBadge:'직접 만든 변경 예시 · CAPA 미검증',fit:'전체 맞춤',overview:'전체 위치',hint:'드래그로 이동 · 휠 / 핀치로 확대',source:'Setting CNC.xlsx / W39 · 상단 배치만 참조',export:'초안 내보내기',selection:'선택 설비',before:'원본',after:'조정안',targetModel:'변경할 모델',targetProcess:'가공 공정',applyEdit:'조정안에 반영',unvalidated:'T/T·가공 호환성이 연결되지 않아 CAPA와 실행 가능 여부는 아직 판단하지 않습니다.',changes:'변경 목록',pending:'CAPA 검증 대기',pendingText:'가동시간·효율과 설비별 T/T 연결 후 확정할 수 있습니다.',confirm:'Layout 확정 적용',reset:'원본으로 새 초안',footer:'A/B동은 같은 1공장의 건물 구분입니다. 2공장 배치는 별도 자료가 필요합니다.',resetTitle:'원본 배치로 새 초안을 만들까요?',resetText:'현재 편집 내용은 이력에 남으며 되돌리기로 복원할 수 있습니다.',cancel:'취소',search:'설비 번호 검색',allModels:'모든 모델',sourceBaseline:'W39 · Excel 기준 배치',count:'대',building:'동',cell:'원본 셀',unchanged:'원본 배치와 같습니다.',modified:'사용자가 수정한 배치 · 검증 전',fixed:'고정된 배치입니다. 수정하려면 잠금을 해제하세요.',lock:'이 배치 고정',unlock:'배치 잠금 해제',empty:'아직 변경한 설비가 없습니다.\n설비를 선택하거나 변경 예시를 확인하세요.',saved:'이 브라우저에 초안을 저장했습니다.',autosaved:'브라우저 초안 자동 저장',original:'원본 Excel을 보고 있습니다.',missing:'해당 설비를 찾을 수 없습니다. 1~800번으로 검색하세요.',updated:'조정안에 반영했습니다. CAPA 검증은 필요합니다.',same:'현재 조정안과 같습니다.',locked:'고정한 설비는 수정할 수 없습니다.',localError:'브라우저 저장소를 사용할 수 없습니다. 내보내기로 보관하세요.',demoLoaded:'가상 변경 예시를 불러왔습니다. 실제 추천 결과가 아닙니다.',restore:'이전 브라우저 초안을 복구했습니다.',reverted:'원본 기준 새 초안을 만들었습니다.',noSelection:'설비를 먼저 선택하세요.',changed:'변경',fixedLegend:'고정',free:'대기 (모델 제거)',filterEmpty:'조건에 맞는 설비가 없습니다.',demoDirty:'기존 편집/잠금을 보존하려면 새 초안에서 예시를 시작하세요.',draftExport:'초안 파일을 내보냈습니다.',zoomLabel:'설비 배치도: 드래그 이동, +/− 확대 축소',lastSaved:'저장',previewOnly:'시안 · 운영 적용 없음',
  setupTitle:'현장 셋업', setupNotice:'조정안을 작업 지시로 반영하고 진행 상태를 체크해 보세요. 브라우저 전용 예시입니다.',
  setupPublish:'조정안으로 셋업 예시 시작',setupView:'셋업 현황',setupStart:'셋업 시작',setupComplete:'셋업 완료',
  setupReadyNote:'완료는 준비 완료를 뜻합니다. 정상 가동·생산 시작은 별도로 확인합니다.',setupNone:'셋업 대상 아님',
  setupEmpty:'변경 조정안을 먼저 만드세요.',setupWaiting:'○ 대기',setupWorking:'◐ 진행 중',setupDone:'✓ 완료',
  setupAll:'모든 셋업 상태',setupFrozen:'작업 지시 고정 · 이후 초안 편집과 별개',setupPublished:'목표 배치가 예시 설비정보에 즉시 반영됐습니다.',
  setupNotPublished:'아직 셋업 작업 지시가 없습니다.',setupScope:'1공장 전체 변경 대상',setupTarget:'설비정보 · 목표',setupAt:'반영',setupStarted:'시작',setupFinished:'완료',setupActor:'시안 사용자',setupSaved:'셋업 상태를 브라우저에 저장했습니다.',setupFailed:'저장에 실패했습니다. 상태를 변경하지 않았습니다.'},
 vi:{factory:'Nhà máy 1 · 800 máy',breadcrumb:'Kế hoạch sản xuất / Layout',title:'Bố trí Layout',subtitle:'Xem và điều chỉnh bố trí theo Excel W39.',demo:'Xem ví dụ thay đổi',save:'Lưu bản nháp',notice:'Bản mẫu UI · Vị trí và model lấy từ Excel. Thay đổi chỉ lưu trên trình duyệt, không áp dụng vào máy thực tế.',buildingSuffix:'',all:'Tất cả',current:'Bố trí gốc',draft:'Bản điều chỉnh',compare:'So sánh',changedOnly:'Chỉ thay đổi',demoBadge:'Ví dụ thay đổi · Chưa kiểm tra CAPA',fit:'Vừa khung',overview:'Tổng quan',hint:'Kéo để di chuyển · Cuộn / chụm để thu phóng',source:'Setting CNC.xlsx / W39 · Chỉ bố trí phía trên',export:'Xuất bản nháp',selection:'Máy đã chọn',before:'Gốc',after:'Điều chỉnh',targetModel:'Model mới',targetProcess:'Công đoạn',applyEdit:'Cập nhật bản nháp',unvalidated:'Chưa kết nối T/T và khả năng gia công. CAPA và tính khả thi chưa được xác nhận.',changes:'Danh sách thay đổi',pending:'Chờ kiểm tra CAPA',pendingText:'Cần giờ làm, hiệu suất và T/T từng máy để xác nhận.',confirm:'Áp dụng Layout',reset:'Bản nháp từ bố trí gốc',footer:'A/B là hai xưởng của nhà máy 1. Nhà máy 2 cần dữ liệu riêng.',resetTitle:'Tạo bản nháp từ bố trí gốc?',resetText:'Các chỉnh sửa được giữ trong lịch sử và có thể hoàn tác.',cancel:'Hủy',search:'Tìm số máy',allModels:'Tất cả model',sourceBaseline:'W39 · Bố trí từ Excel',count:'máy',building:'Xưởng',cell:'Ô gốc',unchanged:'Giống bố trí gốc.',modified:'Bố trí người dùng sửa · Chưa kiểm tra',fixed:'Bố trí đã khóa. Mở khóa để sửa.',lock:'Khóa bố trí này',unlock:'Mở khóa bố trí',empty:'Chưa có thay đổi.\nChọn máy hoặc xem ví dụ thay đổi.',saved:'Đã lưu bản nháp trên trình duyệt này.',autosaved:'Tự lưu trên trình duyệt',original:'Đang xem bố trí Excel gốc.',missing:'Không tìm thấy máy. Nhập số 1–800.',updated:'Đã cập nhật bản nháp. Cần kiểm tra CAPA.',same:'Giống bản nháp hiện tại.',locked:'Không thể sửa máy đã khóa.',localError:'Không thể lưu trên trình duyệt. Hãy xuất bản nháp.',demoLoaded:'Đã tải ví dụ. Đây không phải kết quả tối ưu thực tế.',restore:'Đã khôi phục bản nháp.',reverted:'Đã tạo bản nháp từ bố trí gốc.',noSelection:'Hãy chọn máy.',changed:'Đổi',fixedLegend:'Khóa',free:'Chờ (bỏ model)',filterEmpty:'Không có máy phù hợp.',demoDirty:'Hãy tạo bản nháp mới trước khi tải ví dụ để giữ các chỉnh sửa.',draftExport:'Đã xuất bản nháp.',zoomLabel:'Bố trí máy: kéo di chuyển, +/− thu phóng',lastSaved:'Đã lưu',previewOnly:'Bản mẫu · Không áp dụng thực tế',
  setupTitle:'Setup tại xưởng',setupNotice:'Thử áp dụng bản điều chỉnh và đánh dấu tiến độ. Chỉ là ví dụ trên trình duyệt.',
  setupPublish:'Tạo ví dụ setup từ bản nháp',setupView:'Tiến độ setup',setupStart:'Bắt đầu setup',setupComplete:'Hoàn tất setup',
  setupReadyNote:'Hoàn tất nghĩa là sẵn sàng. Vận hành và bắt đầu sản xuất được xác nhận riêng.',setupNone:'Không cần setup',
  setupEmpty:'Hãy tạo thay đổi trước.',setupWaiting:'○ Chờ',setupWorking:'◐ Đang setup',setupDone:'✓ Hoàn tất',
  setupAll:'Mọi trạng thái setup',setupFrozen:'Lệnh đã cố định · Tách biệt bản nháp',setupPublished:'Model mục tiêu đã cập nhật ngay trong ví dụ.',
  setupNotPublished:'Chưa có lệnh setup.',setupScope:'Máy thay đổi toàn nhà máy 1',setupTarget:'Máy · Mục tiêu',setupAt:'Áp dụng',setupStarted:'Bắt đầu',setupFinished:'Hoàn tất',setupActor:'Người dùng mẫu',setupSaved:'Đã lưu tiến độ trên trình duyệt.',setupFailed:'Lưu thất bại. Trạng thái chưa thay đổi.'}
};

// DB mode (2026-09-25): texts that differ once the studio shows a real plan instead of the Excel sample.
const dbMessages = {
 ko:{breadcrumb:'생산 계획 / Layout',subtitle:'Forecast 수요와 앱에 등록된 T/T 로 계산한 추천 배치입니다. 설비별로 미세조정한 뒤 확정하세요.',notice:'추천 Layout · 확정하기 전까지 설비정보에는 반영되지 않습니다. 편집은 서버에 저장됩니다.',demo:'추천안으로 되돌리기',demoBadge:'추천 Layout · 앱 T/T 기준 CAPA',current:'현재 배치',before:'현재',after:'조정안',sourceBaseline:'계획 기준 배치',source:'앱 설비·모델 정보 + 등록 도면',unvalidated:'CAPA 는 앱에 등록된 T/T·교대·휴식으로 계산합니다(cavity 로 나누지 않음).',pending:'CAPA 알림',pendingText:'모델·공정별 필요 대수 대비 부족·여유입니다. 여유 설비를 더 배치할지는 판단해 주세요.',confirm:'Layout 확정 적용',footer:'도면 위치는 등록된 Layout 도면 기준입니다.',previewOnly:'확정 전 초안',saved:'서버에 저장했습니다.',autosaved:'서버 저장',saving:'저장 중…',saveFailed:'저장하지 못했습니다. 다시 시도하세요.',conflict:'다른 사용자가 먼저 저장했습니다. 새로 불러옵니다.',recommendedLoaded:'추천안으로 되돌렸습니다.',readOnly:'읽기 전용 Layout 입니다. 새 추천은 Forecast 화면에서 만드세요.',confirmTitle:'이 Layout 을 확정할까요?',confirmText:'바뀐 설비 {n}대의 모델·공정이 즉시 설비정보에 반영되고, 셋업 작업이 대기로 생성됩니다.',confirmShortage:'아직 {n}대가 부족한 채로 확정합니다.',confirmed:'확정했습니다. 셋업 현황에서 진행을 체크하세요.',confirmFailed:'확정하지 못했습니다.',stale:'계획을 만든 뒤 설비 배정이 바뀌었습니다. Forecast 화면에서 다시 추천하세요.',setupNotice:'확정하면 바뀐 설비가 셋업 대상이 됩니다. 현장에서 시작·완료를 체크하세요.',setupNotPublished:'아직 확정 전입니다.',setupScope:'확정 변경 대상',setupActor:'앱 사용자',setupSaved:'셋업 상태를 저장했습니다.',setupFailed:'저장에 실패했습니다. 상태를 변경하지 않았습니다.',alertShortage:'부족',alertSurplus:'여유',alertZero:'수요 0',alertUnassigned:'미배정',alertNotComputable:'계산 불가',alertNotInForecast:'Forecast 없음',alertsEmpty:'부족·여유가 없습니다.',groupLine:'{g} · 필요 {r} / 배정 {a}',alertMore:'외 {n}개',machinesUnit:'대',noticeReadOnly:'읽기 전용 Layout · 편집·확정할 수 없습니다. 새 추천은 Forecast 화면에서 만드세요.',subtitleReadOnly:'확정된 Layout 과 현장 셋업 진행을 확인합니다.'},
 vi:{breadcrumb:'Kế hoạch sản xuất / Layout',subtitle:'Bố trí đề xuất tính từ nhu cầu Forecast và T/T đã đăng ký trong app. Tinh chỉnh từng máy rồi xác nhận.',notice:'Layout đề xuất · Chưa áp dụng vào thông tin máy cho đến khi xác nhận. Chỉnh sửa được lưu trên máy chủ.',demo:'Quay về đề xuất',demoBadge:'Layout đề xuất · CAPA theo T/T app',current:'Bố trí hiện tại',before:'Hiện tại',after:'Điều chỉnh',sourceBaseline:'Bố trí gốc của kế hoạch',source:'Thông tin máy·model trong app + bản vẽ',unvalidated:'CAPA tính theo T/T·ca·nghỉ đã đăng ký trong app (không chia cho cavity).',pending:'Cảnh báo CAPA',pendingText:'Thiếu·dư so với số máy cần theo model·công đoạn. Việc bố trí thêm máy dư do bạn quyết định.',confirm:'Xác nhận áp dụng Layout',footer:'Vị trí theo bản vẽ Layout đã đăng ký.',previewOnly:'Bản nháp chưa xác nhận',saved:'Đã lưu lên máy chủ.',autosaved:'Đã lưu máy chủ',saving:'Đang lưu…',saveFailed:'Không lưu được. Hãy thử lại.',conflict:'Người khác đã lưu trước. Đang tải lại.',recommendedLoaded:'Đã quay về đề xuất.',readOnly:'Layout chỉ đọc. Tạo đề xuất mới ở màn hình Forecast.',confirmTitle:'Xác nhận Layout này?',confirmText:'Model·công đoạn của {n} máy thay đổi sẽ áp dụng ngay vào thông tin máy và tạo việc setup ở trạng thái chờ.',confirmShortage:'Vẫn còn thiếu {n} máy khi xác nhận.',confirmed:'Đã xác nhận. Theo dõi tiến độ ở Tiến độ setup.',confirmFailed:'Không xác nhận được.',stale:'Phân bổ máy đã thay đổi sau khi tạo kế hoạch. Hãy tạo đề xuất lại ở màn hình Forecast.',setupNotice:'Sau khi xác nhận, các máy thay đổi sẽ cần setup. Đánh dấu bắt đầu·hoàn tất tại xưởng.',setupNotPublished:'Chưa xác nhận.',setupScope:'Máy thay đổi đã xác nhận',setupActor:'Người dùng app',setupSaved:'Đã lưu trạng thái setup.',setupFailed:'Lưu thất bại. Trạng thái chưa thay đổi.',alertShortage:'Thiếu',alertSurplus:'Dư',alertZero:'Nhu cầu 0',alertUnassigned:'Chưa gán',alertNotComputable:'Không tính được',alertNotInForecast:'Không có Forecast',alertsEmpty:'Không thiếu·dư.',groupLine:'{g} · cần {r} / đã gán {a}',alertMore:'và {n} nhóm khác',machinesUnit:'máy',noticeReadOnly:'Layout chỉ đọc · không thể chỉnh sửa·xác nhận. Tạo đề xuất mới ở màn hình Forecast.',subtitleReadOnly:'Xem Layout đã xác nhận và tiến độ setup tại xưởng.'}
};

/** Pastel fill + stripe for models the preview palette does not know (DB model names), stable per name. */
function generatedColor(model){let h=0;for(const ch of model)h=(h*31+ch.charCodeAt(0))%360;return['hsl('+h+' 62% 92%)','hsl('+h+' 42% 48%)'];}
const colorKey = model => String(model||'').replace(/\s+/g,'').toUpperCase();

/**
 * Mounts the studio into `root` (which must already contain the studio markup).
 * @param {HTMLElement} root
 * `backend` (optional) switches the studio from the Excel sample to a real layout plan (DB mode). Without it the
 * preview behaviour is unchanged. With it: the base is the plan's machine state, drafts save to the server, the
 * "example" button restores the recommendation, confirm applies the plan, setup tasks come from the server and
 * the CAPA alert panel is shown. Shape (see LayoutStudio.tsx):
 *   { readOnly, initial:{draft,recommended,setup}, save(draft), confirm(draft), transition(no,to), summarize(draft), reload(), onConfirmed(result) }
 * @param {{ data: any, lang: 'ko' | 'vi', backend?: any }} options
 * @returns {{ setLang: (lang: 'ko' | 'vi') => void, destroy: () => void }}
 */
export function mountLayoutStudio(root, { data, lang: initialLang, backend = null }) {
const DATA = data;
const M = backend ? {ko:{...messages.ko,...dbMessages.ko},vi:{...messages.vi,...dbMessages.vi}} : messages;
const PROCESSES = DATA.processes || ['C0','C1','C2'];
const readOnly = !!(backend && backend.readOnly);
const colorOf = model => colors[model] || colors[colorKey(model)] || (model ? generatedColor(model) : ['#f2f4f7','#aab3c0']);
const processLabel = code => 'CNC '+code.slice(1);
const processesFor = model => (DATA.processesByModel && DATA.processesByModel[model]) || PROCESSES;
const $ = id => root.querySelector('#' + id);
const ns = 'http://www.w3.org/2000/svg';
const copy = value => JSON.parse(JSON.stringify(value));
const machines = new Map(DATA.machines.map(m => [m.id, m]));
let lang=messages[initialLang]?initialLang:'ko', building='B', mode='draft', selected=DATA.machines.some(m=>m.id===305)?305:DATA.machines[0].id;
building=DATA.machines.find(m=>m.id===selected).building;
if(backend&&backend.initialMode)mode=backend.initialMode;
let draft={edits:{},locks:[],demo:false}, undoStack=[], redoStack=[];
let scale=.56, tx=0, ty=0, saveTime=null, toastTimer;
const storageKey='cnc-layout-preview-v1-'+DATA.sha256;
const t = key => M[lang][key] || key;
const tf = (key, vars) => Object.entries(vars).reduce((text,[k,v])=>text.replace('{'+k+'}',String(v)),t(key));
let saveState=null, saving=null, savePending=false;
const buildingName = b => lang==='ko' ? b+'동' : 'Xưởng '+b;
const displayName = id => 'CNC-'+String(id).padStart(3,'0');
const baseAssignment = m => ({model:m.model,process:m.process});
const assignment = m => draft.edits[m.id] || baseAssignment(m);
const label = a => a.model ? a.model+'-'+a.process : t('free');
const changedIds = () => Object.keys(draft.edits).map(Number).sort((a,b)=>a-b);
const visibleMachines = () => DATA.machines.filter(m=>building==='all'||m.building===building);
const svgEl = (tag,attrs={}) => {const e=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);return e;};
function toast(message){$('toast').textContent=message;$('toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),3200);}
function persist(showToast=false){if(backend){saveToServer(showToast);return;}try{localStorage.setItem(storageKey,JSON.stringify({version:1,hash:DATA.sha256,draft,undoStack:undoStack.slice(-30),redoStack:redoStack.slice(-30),at:Date.now()}));saveTime=new Date();if(showToast)toast(t('saved'));}catch{toast(t('localError'));}renderSaveStatus();}
function saveToServer(showToast){
 if(readOnly)return;
 if(saving){savePending=true;return;}
 saveState='saving';renderSaveStatus();
 saving=backend.save(copy(draft)).then(()=>{saveTime=new Date();saveState=null;if(showToast)toast(t('saved'));})
  .catch(error=>{saveState='failed';const code=error&&error.code;toast(code==='plan_revision_conflict'?t('conflict'):code==='layout_base_stale'?t('stale'):t('saveFailed'));if(code==='plan_revision_conflict'&&backend.reload)backend.reload();})
  .finally(()=>{saving=null;renderSaveStatus();if(savePending){savePending=false;saveToServer(false);}});
}
function renderSaveStatus(){if(backend){$('saveStatus').textContent=readOnly?t('readOnly'):saveState==='saving'?t('saving'):saveState==='failed'?t('saveFailed'):saveTime?t('autosaved')+' · '+saveTime.toLocaleTimeString(lang==='ko'?'ko-KR':'vi-VN',{hour:'2-digit',minute:'2-digit'}):t('previewOnly');return;}$('saveStatus').textContent=saveTime?t('autosaved')+' · '+saveTime.toLocaleTimeString(lang==='ko'?'ko-KR':'vi-VN',{hour:'2-digit',minute:'2-digit'}):t('previewOnly');}
function validDraft(value){return value && value.edits && Array.isArray(value.locks) && value.locks.every(id=>machines.has(id)) && Object.entries(value.edits).every(([id,a])=>machines.has(Number(id))&&a&&[...DATA.models,''].includes(a.model)&&(a.model===''||PROCESSES.includes(a.process)));}
if(backend){draft=copy(backend.initial.draft);}else try{const raw=JSON.parse(localStorage.getItem(storageKey)||'null');if(raw?.hash===DATA.sha256&&validDraft(raw.draft)){draft=raw.draft;undoStack=(raw.undoStack||[]).filter(validDraft).slice(-30);redoStack=(raw.redoStack||[]).filter(validDraft).slice(-30);saveTime=new Date(raw.at);}}catch{/* Invalid saved preview does not replace the source. */}
function commit(next){undoStack.push(copy(draft));undoStack=undoStack.slice(-30);redoStack=[];draft=next;persist();render();}
function editAssignment(id,a){const next=copy(draft);if(a.model===machines.get(id).model && a.process===machines.get(id).process)delete next.edits[id];else next.edits[id]=a;commit(next);}
function setOptions(select,values,current){select.replaceChildren(...values.map(([value,text])=>{const e=document.createElement('option');e.value=value;e.textContent=text;return e;}));select.value=current;}
function translate(){root.querySelectorAll('[data-i18n]').forEach(e=>e.textContent=t(e.dataset.i18n));if(readOnly){root.querySelector('[data-i18n="notice"]').textContent=t('noticeReadOnly');root.querySelector('[data-i18n="subtitle"]').textContent=t('subtitleReadOnly');}for(const id of ['demo','save','reset'])$(id).hidden=readOnly;$('search').placeholder=t('search');$('search').setAttribute('aria-label',t('search'));$('stage').setAttribute('aria-label',t('zoomLabel'));$('stageLabel').textContent=t('sourceBaseline');const filter=$('modelFilter').value;setOptions($('modelFilter'),[['',t('allModels')],...DATA.models.map(m=>[m,m])],filter);render();}
function render(){
 root.querySelectorAll('[data-building]').forEach(b=>b.classList.toggle('active',b.dataset.building===building));
 root.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
 $('buildingTitle').textContent=building==='all'?t('all'):buildingName(building);
 $('mapCount').textContent=visibleMachines().length+' '+t('count')+' · '+t('sourceBaseline');
 $('demoBadge').hidden=!draft.demo;
 renderMap();renderInspector();renderChanges();renderLegend();renderSaveStatus();renderSetup();renderAlerts();
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
  const a=mode==='setup'?setupAssignment(m):(mode==='current'?baseAssignment(m):assignment(m)),changed=mode==='setup'?!!setupTask(m.id):!!draft.edits[m.id],locked=mode!=='setup'&&draft.locks.includes(m.id);
  const task=mode==='setup'?setupTask(m.id):null;
  const dim=(filter&&a.model!==filter)||(mode!=='setup'&&only&&!changed)||(mode==='setup'&&!setupMatches(m.id));
  const g=svgEl('g',{class:['machine',selected===m.id?'selected':'',changed&&mode!=='current'?'changed':'',locked?'locked':'',dim?'dim':''].join(' '),transform:`translate(${m.x} ${m.y})`,'data-id':m.id,tabindex:dim?-1:0,role:'button','aria-label':displayName(m.id)+' '+buildingName(m.building)+' '+label(a),'aria-pressed':selected===m.id});
  const palette=colorOf(a.model);
  g.append(svgEl('rect',{width:104,height:62,fill:palette[0],class:'machine-body'}));
  g.append(svgEl('rect',{x:0,y:9,width:4,height:44,rx:2,fill:palette[1]}));
  const number=svgEl('text',{x:10,y:27,class:'machine-number'});number.textContent=String(m.id).padStart(3,'0');g.append(number);
  if(mode==='compare'&&changed){const old=svgEl('text',{x:10,y:42,fill:'#8794a4','font-size':12});old.textContent=label(baseAssignment(m));g.append(old);const newText=svgEl('text',{x:10,y:56,fill:'#ad6318','font-size':13});newText.textContent='→ '+(a.model?label(a):'—');g.append(newText);}else{const code=svgEl('text',{x:10,y:49,class:'machine-model'});code.textContent=a.model?label(a):'—';g.append(code);}
  if(changed&&mode!=='current'){const mark=svgEl('text',{x:84,y:27,class:'change-mark'});mark.textContent='↗';g.append(mark);}else if(locked){const mark=svgEl('text',{x:86,y:25,fill:'#647790','font-size':21});mark.textContent='▣';g.append(mark);}
  g.addEventListener('click',()=>{if(!wasDrag)selectMachine(m.id);});
  g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectMachine(m.id);}});
  if(mode==='setup')setupBadge(g,task);
  world.append(g);
 }
 transform();renderMinimap();
}
function renderMinimap(){const mini=$('minimap');mini.replaceChildren();for(const b of DATA.buildings){mini.append(svgEl('rect',{x:b.x,y:b.y,width:b.width,height:b.height,fill:'#f0f3f7',stroke:'#b8c6d7','stroke-width':15}));}for(const m of DATA.machines)mini.append(svgEl('rect',{x:m.x,y:m.y,width:104,height:62,fill:draft.edits[m.id]?'#cc7927':(m.model?colorOf(m.model)[1]:'#a0adbc')}));mini.append(svgEl('rect',{id:'viewport',fill:'#2357c616',stroke:'#2357c6','stroke-width':30}));updateViewport();}
function transform(){$('world').setAttribute('transform',`translate(${tx} ${ty}) scale(${scale})`);$('zoomValue').textContent=Math.round(scale*100)+'%';updateViewport();}
function updateViewport(){const rect=$('viewport');if(!rect)return;rect.setAttribute('x',-tx/scale);rect.setAttribute('y',-ty/scale);rect.setAttribute('width',$('stage').clientWidth/scale);rect.setAttribute('height',$('stage').clientHeight/scale);}
function zoom(factor,x=$('stage').clientWidth/2,y=$('stage').clientHeight/2){const before=scale;scale=Math.max(.08,Math.min(2.5,scale*factor));tx=x-(x-tx)*scale/before;ty=y-(y-ty)*scale/before;transform();}
function fit(){const bs=DATA.buildings.filter(b=>building==='all'||b.id===building);const left=Math.min(...bs.map(b=>b.x)),top=Math.min(...bs.map(b=>b.y)),right=Math.max(...bs.map(b=>b.x+b.width)),bottom=Math.max(...bs.map(b=>b.y+b.height));const stage=$('stage');scale=Math.min((stage.clientWidth-34)/(right-left),(stage.clientHeight-95)/(bottom-top));tx=(stage.clientWidth-(right-left)*scale)/2-left*scale;ty=58+(stage.clientHeight-95-(bottom-top)*scale)/2-top*scale;transform();}
function focusMachine(id){const m=machines.get(id);if(!m)return;scale=window.innerWidth<760?.76:.58;tx=$('stage').clientWidth/2-(m.x+52)*scale;ty=$('stage').clientHeight/2-(m.y+31)*scale;transform();}
function selectMachine(id,focus=false){selected=id;const m=machines.get(id);if(focus||(building!=='all'&&building!==m.building))building=m.building;$('editModel').value=assignment(m).model;render();if(focus)focusMachine(id);root.querySelector('.inspector').classList.add('mobile-open');}
function renderInspector(){const m=machines.get(selected);const a=assignment(m);$('selectedName').textContent=displayName(m.id);$('selectedLocation').textContent=buildingName(m.building)+' · '+t('cell')+' '+m.cell;$('currentLabel').textContent=label(baseAssignment(m));$('draftLabel').textContent=label(a);const locked=draft.locks.includes(m.id);$('selectionStatus').textContent=locked?t('fixed'):(draft.edits[m.id]?t('modified'):t('unchanged'));$('selectionStatus').classList.toggle('changed',!!draft.edits[m.id]);setOptions($('editModel'),[...DATA.models.map(m=>[m,m]),['',t('free')]],a.model);if(backend)setOptions($('editProcess'),processesFor(a.model).map(p=>[p,processLabel(p)]),a.process);$('editProcess').value=a.process;$('editModel').disabled=locked||readOnly;$('editProcess').disabled=locked||!a.model||readOnly;$('applyEdit').disabled=locked||readOnly;$('lock').disabled=readOnly;renderGroupAlert(a);$('lock').textContent=(locked?'▣ ':'□ ')+t(locked?'unlock':'lock');$('lock').classList.toggle('is-locked',locked);}
function renderChanges(){const ids=changedIds();$('changeCount').textContent=ids.length;$('changes').replaceChildren();if(!ids.length){const empty=document.createElement('div');empty.className='empty';empty.style.whiteSpace='pre-line';empty.textContent=t('empty');$('changes').append(empty);return;}for(const id of ids){const m=machines.get(id),a=assignment(m);const b=document.createElement('button');b.className='change-row';b.dataset.changeId=id;const d=document.createElement('div'),name=document.createElement('strong'),small=document.createElement('small'),value=document.createElement('span');name.textContent=displayName(id)+' · '+buildingName(m.building);small.textContent=label(baseAssignment(m));value.textContent='→ '+label(a);d.append(name,small);b.append(d,value);b.onclick=()=>selectMachine(id,true);$('changes').append(b);}}
function renderLegend(){$('legend').replaceChildren();for(const model of DATA.models){const span=document.createElement('span'),dot=document.createElement('i');dot.style.background=colorOf(model)[1];span.append(dot,document.createTextNode(model));$('legend').append(span);}const changed=document.createElement('span');changed.textContent='↗ '+t('changed');changed.style.color='#ba741c';$('legend').append(changed);}

// ── Setup workflow (preview setup.js) ────────────────────────────────────────
const setupKey='cnc-layout-setup-preview-v1-'+DATA.sha256;
let setupBatch=null;
const statusKey={pending:'setupWaiting',in_progress:'setupWorking',completed:'setupDone'};
function validSetup(value){return value?.sourceHash===DATA.sha256 && typeof value.version==='string' && value.tasks && Object.entries(value.tasks).every(([id,task])=>machines.has(Number(id)) && statusKey[task.status] && task.target && [...DATA.models,''].includes(task.target.model) && (task.target.model===''||PROCESSES.includes(task.target.process)) && Array.isArray(task.events));}
if(backend)setupBatch=backend.initial.setup?copy(backend.initial.setup):null;else try{const value=JSON.parse(localStorage.getItem(setupKey)||'null');if(validSetup(value))setupBatch=value;}catch{/* Ignore invalid local examples. */}
function saveSetup(next){try{localStorage.setItem(setupKey,JSON.stringify(next));setupBatch=next;return true;}catch{toast(t('setupFailed'));return false;}}
function setupTask(id){return setupBatch?.tasks[id]||null;}
function setupAssignment(m){return setupTask(m.id)?.target||baseAssignment(m);}
function setupMatches(id){const filter=$('setupFilter').value;return !filter||(setupTask(id)?.status||'none')===filter;}
function setupBadge(g,task){if(!task)return;const badge=svgEl('text',{x:85,y:27,fill:{pending:'#697789',in_progress:'#bb6410',completed:'#16774d'}[task.status],'font-size':20,'font-weight':700});g.querySelector('.change-mark')?.remove();badge.textContent={pending:'○',in_progress:'◐',completed:'✓'}[task.status];g.append(badge);g.dataset.setup=task.status;g.setAttribute('aria-label',g.getAttribute('aria-label')+' '+t(statusKey[task.status]));}
function renderSetup(){
 const active=mode==='setup',task=setupTask(selected),tasks=Object.values(setupBatch?.tasks||{});
 $('setupPublish').hidden=!!backend;
 $('setupPublish').disabled=!!setupBatch||!changedIds().length;
 $('setupPublish').textContent=t(setupBatch?'setupFrozen':'setupPublish');
 $('setupCounts').textContent=setupBatch?t('setupScope')+' '+tasks.length+' · '+['pending','in_progress','completed'].map(s=>t(statusKey[s])+' '+tasks.filter(task=>task.status===s).length).join(' / '):t('setupNotPublished');
 $('setupFilter').hidden=!active;const filter=$('setupFilter').value;setOptions($('setupFilter'),[['',t('setupAll')],...Object.entries(statusKey).map(([s,key])=>[s,t(key)]),['none',t('setupNone')]],filter);
 $('setupPanel').hidden=!active;
 for(const selector of ['.assignment','#selectionStatus','#editForm','#lock','.inspector > .help','.changes-section','.review-box'])root.querySelector(selector).hidden=active;
 $('modelFilter').hidden=active;$('changedOnly').parentElement.hidden=active;
 if(!active){$('stageLabel').textContent=t('sourceBaseline');return;}
 $('legend').replaceChildren();for(const [status,key] of Object.entries(statusKey)){const item=document.createElement('span');item.textContent=t(key);item.dataset.state=status;$('legend').append(item);}
 $('stageLabel').textContent=t('setupView')+' · '+(setupBatch?.version||'—');
 $('setupState').textContent=t(task?statusKey[task.status]:(setupBatch?'setupNone':'setupNotPublished'));$('setupState').dataset.state=task?.status||'none';
 $('setupTarget').textContent=t('setupTarget')+': '+label(setupAssignment(machines.get(selected)))+(task?' ('+label(task.before)+' → '+label(task.target)+')':'');
 $('setupTimes').replaceChildren();
 if(task)for(const event of task.events){const line=document.createElement('div');line.textContent=t({pending:'setupAt',in_progress:'setupStarted',completed:'setupFinished'}[event.status])+' · '+new Date(event.at).toLocaleString(lang==='ko'?'ko-KR':'vi-VN')+' · '+t('setupActor');$('setupTimes').append(line);}
 $('setupStart').hidden=!task||task.status!=='pending';$('setupComplete').hidden=!task||task.status!=='in_progress';
}
function transitionSetup(from,to){const task=setupTask(selected);if(!task||task.status!==from)return;if(backend){backend.transition(selected,to).then(next=>{setupBatch=next;render();toast(t('setupSaved'));}).catch(()=>toast(t('setupFailed')));return;}const next=copy(setupBatch);next.tasks[selected].status=to;next.tasks[selected].events.push({status:to,at:new Date().toISOString(),actor:'preview-user'});if(saveSetup(next)){render();toast(t('setupSaved'));}}

// ── DB mode: CAPA alerts + confirm ───────────────────────────────────────────
const ALERT_KEY={shortage:'alertShortage',surplus:'alertSurplus',zero_demand:'alertZero',not_computable:'alertNotComputable',not_in_forecast:'alertNotInForecast'};
let summary=null;
function renderAlerts(){
 root.querySelector('.review-box').classList.toggle('db-mode',!!backend);
 $('alertTotals').hidden=!backend;$('alertList').hidden=!backend;
 if(!backend)return;
 summary=backend.summarize(draft);
 const totals=summary.totals;
 $('alertTotals').replaceChildren(...[['shortage',totals.shortageMachines,'alertShortage'],['surplus',totals.spareMachines,'alertSurplus'],['unassigned',totals.unassignedMachines,'alertUnassigned'],['not_computable',totals.notComputableGroups,'alertNotComputable']].map(([state,count,key])=>{const s=document.createElement('span');s.dataset.state=state;s.textContent=t(key)+' '+count;return s;}));
 const rows=summary.groups.filter(g=>ALERT_KEY[g.status]);
 $('alertList').replaceChildren();
 if(!rows.length){const e=document.createElement('div');e.className='empty';e.textContent=t('alertsEmpty');$('alertList').append(e);}
 for(const g of rows.slice(0,8)){const b=document.createElement('button');b.className='alert-row';b.dataset.state=g.status;b.dataset.model=g.model;
  const name=document.createElement('strong');name.textContent=g.code;const detail=document.createElement('small');
  detail.textContent=t(ALERT_KEY[g.status])+(g.gap===null||g.gap===0?'':' '+Math.abs(g.gap)+t('machinesUnit'))+(g.required===null?'':' · '+g.assigned+'/'+g.required)+(g.utilization===null?'':' · '+Math.round(g.utilization*100)+'%');
  b.append(name,detail);b.onclick=()=>{$('modelFilter').value=g.model;$('changedOnly').checked=false;if(mode==='setup')mode='draft';render();};$('alertList').append(b);}
 if(rows.length>8){const more=document.createElement('div');more.className='empty';more.textContent=tf('alertMore',{n:rows.length-8});$('alertList').append(more);}
 $('confirmLayout').disabled=readOnly||!backend.confirm;
}
function renderGroupAlert(a){
 const line=$('groupAlert');line.hidden=!backend||!a.model;if(line.hidden)return;
 const g=(summary||backend.summarize(draft)).groups.find(x=>x.model===a.model&&x.process===a.process);
 line.dataset.state=g?g.status:'none';
 line.textContent=g?tf('groupLine',{g:g.code,r:g.required===null?'—':g.required,a:g.assigned})+(ALERT_KEY[g.status]?' · '+t(ALERT_KEY[g.status])+(g.gap?' '+Math.abs(g.gap)+t('machinesUnit'):''):''):label(a);
}
$('confirmLayout').onclick=()=>{if(!backend||readOnly)return;$('confirmText').textContent=tf('confirmText',{n:changedIds().length});const short=summary?summary.totals.shortageMachines:0;$('confirmShortage').textContent=short?tf('confirmShortage',{n:short}):'';$('confirmShortage').hidden=!short;$('confirmDialog').showModal();};
$('cancelConfirm').onclick=()=>$('confirmDialog').close();
$('confirmLayoutGo').onclick=()=>{$('confirmDialog').close();$('confirmLayout').disabled=true;
 Promise.resolve(saving).then(()=>backend.confirm(copy(draft))).then(result=>{setupBatch=result.setup;mode='setup';toast(t('confirmed'));if(backend.onConfirmed)backend.onConfirmed(result);else render();})
  .catch(error=>{toast(error&&error.code==='layout_base_stale'?t('stale'):t('confirmFailed'));render();});};

// ── Event wiring ─────────────────────────────────────────────────────────────
root.querySelectorAll('[data-building]').forEach(b=>b.onclick=()=>{building=b.dataset.building;render();fit();});
root.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{mode=b.dataset.mode;render();});
$('modelFilter').onchange=()=>renderMap();$('changedOnly').onchange=()=>renderMap();
$('searchForm').onsubmit=e=>{e.preventDefault();const value=$('search').value.trim().replace(/^CNC[- ]?/i,'');if(!/^\d{1,3}$/.test(value)||!machines.has(Number(value))){toast(t('missing'));return;}$('modelFilter').value='';$('changedOnly').checked=false;$('setupFilter').value='';selectMachine(Number(value),true);};
$('editModel').onchange=()=>{const model=$('editModel').value;if(backend&&model){const current=$('editProcess').value,procs=processesFor(model);setOptions($('editProcess'),procs.map(p=>[p,processLabel(p)]),procs.includes(current)?current:procs[0]);}$('editProcess').disabled=!model;};
$('editForm').onsubmit=e=>{e.preventDefault();if(draft.locks.includes(selected)){toast(t('locked'));return;}const a={model:$('editModel').value,process:$('editProcess').value};if(JSON.stringify(a)===JSON.stringify(assignment(machines.get(selected)))){toast(t('same'));return;}mode='draft';editAssignment(selected,a);toast(t('updated'));};
$('lock').onclick=()=>{const next=copy(draft);next.locks=next.locks.includes(selected)?next.locks.filter(id=>id!==selected):[...next.locks,selected];commit(next);};
$('undo').onclick=()=>{if(!undoStack.length)return;redoStack.push(copy(draft));draft=undoStack.pop();persist();render();};
$('redo').onclick=()=>{if(!redoStack.length)return;undoStack.push(copy(draft));draft=redoStack.pop();persist();render();};
$('save').onclick=()=>persist(true);
$('demo').onclick=()=>{if(backend){if(readOnly)return;const next=copy(backend.initial.recommended);next.demo=true;mode='compare';commit(next);toast(t('recommendedLoaded'));return;}if(changedIds().length||draft.locks.length){toast(t('demoDirty'));return;}const next=copy(draft);next.demo=true;for(const [id,model,process] of [[305,'ON1','C1'],[306,'ON1','C1'],[315,'ON1','C2'],[316,'ON1','C2'],[653,'M3','C2'],[654,'M3','C2']])next.edits[id]={model,process};mode='compare';commit(next);selectMachine(305,true);toast(t('demoLoaded'));};
$('reset').onclick=()=>$('resetDialog').showModal();$('cancelReset').onclick=()=>$('resetDialog').close();$('confirmReset').onclick=()=>{commit({edits:{},locks:[],demo:false});$('resetDialog').close();toast(t('reverted'));};
$('export').onclick=()=>{const out={schemaVersion:1,previewOnly:!backend,sourceFile:DATA.source,sourceSheet:DATA.sheet,sourceHash:DATA.sha256,capacityValidated:!!backend,exportedAt:new Date().toISOString(),edits:changedIds().map(id=>({id,building:machines.get(id).building,sourceCell:machines.get(id).cell,before:baseAssignment(machines.get(id)),after:assignment(machines.get(id))})),lockedIds:draft.locks};const url=URL.createObjectURL(new Blob([JSON.stringify(out,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='layout-w39-preview-draft.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast(t('draftExport'));};
$('closePanel').onclick=()=>root.querySelector('.inspector').classList.remove('mobile-open');
$('zoomIn').onclick=()=>zoom(1.25);$('zoomOut').onclick=()=>zoom(.8);$('fit').onclick=fit;
$('setupFilter').onchange=()=>renderMap();
$('setupPublish').onclick=()=>{
 if(setupBatch||!changedIds().length)return;
 const at=new Date().toISOString(),tasks={};
 for(const id of changedIds())tasks[id]={before:baseAssignment(machines.get(id)),target:copy(assignment(machines.get(id))),status:'pending',events:[{status:'pending',at,actor:'preview-user'}]};
 if(!saveSetup({previewOnly:true,sourceHash:DATA.sha256,version:'EXAMPLE-1',at,tasks}))return;
 mode='setup';selectMachine(changedIds()[0],true);toast(t('setupPublished'));
};
$('setupStart').onclick=()=>transitionSetup('pending','in_progress');
$('setupComplete').onclick=()=>transitionSetup('in_progress','completed');

// ── Pan / zoom / pinch: only the single <g id="world"> transform changes while moving ─────────
const stage=$('stage');let pointers=new Map(),pan=null,pinch=null,wasDrag=false;
const point=e=>{const r=stage.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};};
stage.addEventListener('wheel',e=>{if(e.target.closest('.map-tools'))return;e.preventDefault();const p=point(e);zoom(Math.exp(-e.deltaY*.0015),p.x,p.y);},{passive:false});
stage.addEventListener('pointerdown',e=>{if(e.target.closest('.map-tools'))return;wasDrag=false;const p=point(e);pointers.set(e.pointerId,p);if(pointers.size===1){pan={x:p.x,y:p.y,tx,ty,id:e.pointerId};}if(pointers.size===2){const [a,b]=[...pointers.values()];pinch={distance:Math.hypot(a.x-b.x,a.y-b.y),scale,tx,ty,cx:(a.x+b.x)/2,cy:(a.y+b.y)/2};pan=null;}});
stage.addEventListener('pointermove',e=>{if(!pointers.has(e.pointerId))return;const p=point(e);pointers.set(e.pointerId,p);if(pointers.size===2&&pinch){const[a,b]=[...pointers.values()];const cx=(a.x+b.x)/2,cy=(a.y+b.y)/2;scale=Math.max(.08,Math.min(2.5,pinch.scale*Math.hypot(a.x-b.x,a.y-b.y)/Math.max(1,pinch.distance)));tx=cx-(pinch.cx-pinch.tx)*scale/pinch.scale;ty=cy-(pinch.cy-pinch.ty)*scale/pinch.scale;wasDrag=true;transform();}else if(pan){const dx=p.x-pan.x,dy=p.y-pan.y;if(Math.hypot(dx,dy)>4){wasDrag=true;if(!stage.hasPointerCapture(e.pointerId))stage.setPointerCapture(e.pointerId);tx=pan.tx+dx;ty=pan.ty+dy;transform();}}});
function endPointer(e){pointers.delete(e.pointerId);if(stage.hasPointerCapture(e.pointerId))stage.releasePointerCapture(e.pointerId);pinch=null;pan=null;if(pointers.size===1){const [id,p]=[...pointers.entries()][0];pan={id,x:p.x,y:p.y,tx,ty};}setTimeout(()=>{if(!pointers.size)wasDrag=false;},0);}
stage.addEventListener('pointerup',endPointer);stage.addEventListener('pointercancel',endPointer);stage.addEventListener('pointerleave',e=>{if(!stage.hasPointerCapture(e.pointerId))endPointer(e);});
stage.addEventListener('keydown',e=>{if(e.target.closest('button,input,select'))return;if(e.key==='+'||e.key==='='){e.preventDefault();zoom(1.25);}if(e.key==='-'){e.preventDefault();zoom(.8);}const delta={ArrowLeft:[40,0],ArrowRight:[-40,0],ArrowUp:[0,40],ArrowDown:[0,-40]}[e.key];if(delta){e.preventDefault();tx+=delta[0];ty+=delta[1];transform();}});
let previousStageSize={width:stage.clientWidth,height:stage.clientHeight};
const resizeObserver=new ResizeObserver(()=>{const width=stage.clientWidth,height=stage.clientHeight;tx+=(width-previousStageSize.width)/2;ty+=(height-previousStageSize.height)/2;previousStageSize={width,height};transform();});
resizeObserver.observe(stage);
translate();const focusFrame=requestAnimationFrame(()=>focusMachine(selected));

// Read-only hook for the browser verification suite (scripts/verify-layout-studio-browser.cjs).
const hook={data:DATA,state:()=>({building,mode,selected,scale,tx,ty,lang,draft:copy(draft),machineCount:DATA.machines.length,setup:copy(setupBatch)})};
window.__layoutStudio=hook;

return {
 setLang(next){if(!messages[next]||next===lang)return;lang=next;translate();},
 destroy(){resizeObserver.disconnect();cancelAnimationFrame(focusFrame);clearTimeout(toastTimer);if(window.__layoutStudio===hook)delete window.__layoutStudio;},
};
}
