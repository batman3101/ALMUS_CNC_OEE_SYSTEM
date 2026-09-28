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
 *
 * Puzzle tray (DB mode, 2026-09-28 — replaces fine-tuning by dropdown, which the user rated unusable): model·process
 * pieces are dragged from a tray onto machines, the displaced piece returns to the tray through CAPA, and the walkway
 * rules (puzzleRules.ts) are shown as rings while dragging. Colours: model = hue, process = lightness.
 * The dropdown editor (model/process selects + apply) was removed on the user's request the same day: the tray is
 * the only way to change a machine, so there is one editing path to keep correct.
 */
'use strict';
import { PuzzleBoard, pieceKey } from './puzzleRules';

const messages = {
 ko:{factory:'1공장 · 800대',breadcrumb:'생산 계획 / Layout',title:'Layout 배치',subtitle:'W39 Excel 배치를 기준으로 설비를 살펴보고 다음 배치를 조정하세요.',demo:'변경 예시 보기',save:'초안 저장',notice:'UI 시안 · 위치와 모델은 원본 Excel 기준입니다. 편집은 이 브라우저에만 저장되며 운영 설비에 적용되지 않습니다.',buildingSuffix:'동',all:'전체',current:'원본 배치',draft:'조정안',compare:'변경 비교',changedOnly:'변경만',demoBadge:'직접 만든 변경 예시 · CAPA 미검증',fit:'전체 맞춤',overview:'전체 위치',hint:'드래그로 이동 · 휠 / 핀치로 확대',source:'Setting CNC.xlsx / W39 · 상단 배치만 참조',export:'초안 내보내기',selection:'선택 설비',before:'원본',after:'조정안',unvalidated:'T/T·가공 호환성이 연결되지 않아 CAPA와 실행 가능 여부는 아직 판단하지 않습니다.',changes:'변경 목록',pending:'CAPA 검증 대기',pendingText:'가동시간·효율과 설비별 T/T 연결 후 확정할 수 있습니다.',confirm:'Layout 확정 적용',reset:'원본으로 새 초안',footer:'A/B동은 같은 1공장의 건물 구분입니다. 2공장 배치는 별도 자료가 필요합니다.',resetTitle:'원본 배치로 새 초안을 만들까요?',resetText:'현재 편집 내용은 이력에 남으며 되돌리기로 복원할 수 있습니다.',cancel:'취소',search:'설비 번호 검색',allModels:'모든 모델',sourceBaseline:'W39 · Excel 기준 배치',count:'대',building:'동',cell:'원본 셀',unchanged:'원본 배치와 같습니다.',modified:'사용자가 수정한 배치 · 검증 전',fixed:'고정된 배치입니다. 수정하려면 잠금을 해제하세요.',lock:'이 배치 고정',unlock:'배치 잠금 해제',empty:'아직 변경한 설비가 없습니다.\n설비를 선택하거나 변경 예시를 확인하세요.',saved:'이 브라우저에 초안을 저장했습니다.',autosaved:'브라우저 초안 자동 저장',original:'원본 Excel을 보고 있습니다.',missing:'해당 설비를 찾을 수 없습니다. 1~800번으로 검색하세요.',updated:'조정안에 반영했습니다. CAPA 검증은 필요합니다.',same:'현재 조정안과 같습니다.',locked:'고정한 설비는 수정할 수 없습니다.',localError:'브라우저 저장소를 사용할 수 없습니다. 내보내기로 보관하세요.',demoLoaded:'가상 변경 예시를 불러왔습니다. 실제 추천 결과가 아닙니다.',restore:'이전 브라우저 초안을 복구했습니다.',reverted:'원본 기준 새 초안을 만들었습니다.',noSelection:'설비를 먼저 선택하세요.',changed:'변경',fixedLegend:'고정',free:'대기 (모델 제거)',filterEmpty:'조건에 맞는 설비가 없습니다.',demoDirty:'기존 편집/잠금을 보존하려면 새 초안에서 예시를 시작하세요.',draftExport:'초안 파일을 내보냈습니다.',zoomLabel:'설비 배치도: 드래그 이동, +/− 확대 축소',lastSaved:'저장',previewOnly:'시안 · 운영 적용 없음',
  setupTitle:'현장 셋업', setupNotice:'조정안을 작업 지시로 반영하고 진행 상태를 체크해 보세요. 브라우저 전용 예시입니다.',
  setupPublish:'조정안으로 셋업 예시 시작',setupView:'셋업 현황',setupStart:'셋업 시작',setupComplete:'셋업 완료',
  setupReadyNote:'완료는 준비 완료를 뜻합니다. 정상 가동·생산 시작은 별도로 확인합니다.',setupNone:'셋업 대상 아님',
  setupEmpty:'변경 조정안을 먼저 만드세요.',setupWaiting:'○ 대기',setupWorking:'◐ 진행 중',setupDone:'✓ 완료',
  setupAll:'모든 셋업 상태',setupFrozen:'작업 지시 고정 · 이후 초안 편집과 별개',setupPublished:'목표 배치가 예시 설비정보에 즉시 반영됐습니다.',
  setupNotPublished:'아직 셋업 작업 지시가 없습니다.',setupScope:'1공장 전체 변경 대상',setupTarget:'설비정보 · 목표',setupAt:'반영',setupStarted:'시작',setupFinished:'완료',setupActor:'시안 사용자',setupSaved:'셋업 상태를 브라우저에 저장했습니다.',setupFailed:'저장에 실패했습니다. 상태를 변경하지 않았습니다.'},
 vi:{factory:'Nhà máy 1 · 800 máy',breadcrumb:'Kế hoạch sản xuất / Layout',title:'Bố trí Layout',subtitle:'Xem và điều chỉnh bố trí theo Excel W39.',demo:'Xem ví dụ thay đổi',save:'Lưu bản nháp',notice:'Bản mẫu UI · Vị trí và model lấy từ Excel. Thay đổi chỉ lưu trên trình duyệt, không áp dụng vào máy thực tế.',buildingSuffix:'',all:'Tất cả',current:'Bố trí gốc',draft:'Bản điều chỉnh',compare:'So sánh',changedOnly:'Chỉ thay đổi',demoBadge:'Ví dụ thay đổi · Chưa kiểm tra CAPA',fit:'Vừa khung',overview:'Tổng quan',hint:'Kéo để di chuyển · Cuộn / chụm để thu phóng',source:'Setting CNC.xlsx / W39 · Chỉ bố trí phía trên',export:'Xuất bản nháp',selection:'Máy đã chọn',before:'Gốc',after:'Điều chỉnh',unvalidated:'Chưa kết nối T/T và khả năng gia công. CAPA và tính khả thi chưa được xác nhận.',changes:'Danh sách thay đổi',pending:'Chờ kiểm tra CAPA',pendingText:'Cần giờ làm, hiệu suất và T/T từng máy để xác nhận.',confirm:'Áp dụng Layout',reset:'Bản nháp từ bố trí gốc',footer:'A/B là hai xưởng của nhà máy 1. Nhà máy 2 cần dữ liệu riêng.',resetTitle:'Tạo bản nháp từ bố trí gốc?',resetText:'Các chỉnh sửa được giữ trong lịch sử và có thể hoàn tác.',cancel:'Hủy',search:'Tìm số máy',allModels:'Tất cả model',sourceBaseline:'W39 · Bố trí từ Excel',count:'máy',building:'Xưởng',cell:'Ô gốc',unchanged:'Giống bố trí gốc.',modified:'Bố trí người dùng sửa · Chưa kiểm tra',fixed:'Bố trí đã khóa. Mở khóa để sửa.',lock:'Khóa bố trí này',unlock:'Mở khóa bố trí',empty:'Chưa có thay đổi.\nChọn máy hoặc xem ví dụ thay đổi.',saved:'Đã lưu bản nháp trên trình duyệt này.',autosaved:'Tự lưu trên trình duyệt',original:'Đang xem bố trí Excel gốc.',missing:'Không tìm thấy máy. Nhập số 1–800.',updated:'Đã cập nhật bản nháp. Cần kiểm tra CAPA.',same:'Giống bản nháp hiện tại.',locked:'Không thể sửa máy đã khóa.',localError:'Không thể lưu trên trình duyệt. Hãy xuất bản nháp.',demoLoaded:'Đã tải ví dụ. Đây không phải kết quả tối ưu thực tế.',restore:'Đã khôi phục bản nháp.',reverted:'Đã tạo bản nháp từ bố trí gốc.',noSelection:'Hãy chọn máy.',changed:'Đổi',fixedLegend:'Khóa',free:'Chờ (bỏ model)',filterEmpty:'Không có máy phù hợp.',demoDirty:'Hãy tạo bản nháp mới trước khi tải ví dụ để giữ các chỉnh sửa.',draftExport:'Đã xuất bản nháp.',zoomLabel:'Bố trí máy: kéo di chuyển, +/− thu phóng',lastSaved:'Đã lưu',previewOnly:'Bản mẫu · Không áp dụng thực tế',
  setupTitle:'Setup tại xưởng',setupNotice:'Thử áp dụng bản điều chỉnh và đánh dấu tiến độ. Chỉ là ví dụ trên trình duyệt.',
  setupPublish:'Tạo ví dụ setup từ bản nháp',setupView:'Tiến độ setup',setupStart:'Bắt đầu setup',setupComplete:'Hoàn tất setup',
  setupReadyNote:'Hoàn tất nghĩa là sẵn sàng. Vận hành và bắt đầu sản xuất được xác nhận riêng.',setupNone:'Không cần setup',
  setupEmpty:'Hãy tạo thay đổi trước.',setupWaiting:'○ Chờ',setupWorking:'◐ Đang setup',setupDone:'✓ Hoàn tất',
  setupAll:'Mọi trạng thái setup',setupFrozen:'Lệnh đã cố định · Tách biệt bản nháp',setupPublished:'Model mục tiêu đã cập nhật ngay trong ví dụ.',
  setupNotPublished:'Chưa có lệnh setup.',setupScope:'Máy thay đổi toàn nhà máy 1',setupTarget:'Máy · Mục tiêu',setupAt:'Áp dụng',setupStarted:'Bắt đầu',setupFinished:'Hoàn tất',setupActor:'Người dùng mẫu',setupSaved:'Đã lưu tiến độ trên trình duyệt.',setupFailed:'Lưu thất bại. Trạng thái chưa thay đổi.'}
};

// DB mode (2026-09-25): texts that differ once the studio shows a real plan instead of the Excel sample.
const dbMessages = {
 ko:{breadcrumb:'생산 계획 / Layout',subtitle:'Forecast 수요와 앱에 등록된 T/T 로 계산한 추천 배치입니다. 설비별로 미세조정한 뒤 확정하세요.',notice:'추천 Layout · 확정하기 전까지 설비정보에는 반영되지 않습니다. 편집은 서버에 저장됩니다.',demo:'추천안으로 되돌리기',demoBadge:'추천 Layout · 앱 T/T 기준 CAPA',current:'현재 배치',before:'현재',after:'조정안',sourceBaseline:'계획 기준 배치',source:'앱 설비·모델 정보 + 등록 도면',unvalidated:'CAPA 는 앱에 등록된 T/T·교대·휴식으로 계산합니다(cavity 로 나누지 않음).',pending:'CAPA 알림',pendingText:'모델·공정별 필요 대수 대비 부족·여유입니다. 여유 설비를 더 배치할지는 판단해 주세요.',confirm:'Layout 확정 적용',footer:'도면 위치는 등록된 Layout 도면 기준입니다.',previewOnly:'확정 전 초안',saved:'서버에 저장했습니다.',autosaved:'서버 저장',saving:'저장 중…',saveFailed:'저장하지 못했습니다. 다시 시도하세요.',conflict:'다른 사용자가 먼저 저장했습니다. 새로 불러옵니다.',recommendedLoaded:'추천안으로 되돌렸습니다.',readOnly:'편집할 수 없는 Layout 입니다.',noPlanStatus:'추천 계획 없음 · 현재 배치',confirmTitle:'이 Layout 을 확정할까요?',confirmText:'바뀐 설비 {n}대가 셋업 대기로 등록됩니다. 설비정보는 지금 바뀌지 않고, 현장에서 설비별로 셋업을 완료할 때 그 설비만 바뀝니다.',confirmShortage:'아직 {n}대가 부족한 채로 확정합니다.',confirmed:'확정했습니다. 셋업 현황에서 진행을 체크하세요.',confirmFailed:'확정하지 못했습니다.',stale:'계획을 만든 뒤 설비 배정이 바뀌었습니다. Forecast 화면에서 다시 추천하세요.',setupNotice:'확정하면 바뀐 설비가 셋업 대상이 됩니다. 현장에서 시작·완료를 체크하세요. 완료한 설비만 설비정보(모델·공정)에 반영됩니다.',setupMachineChanged:'셋업 시작 뒤 이 설비가 다른 모델로 바뀌어 있어 완료할 수 없습니다. 설비 현황을 확인하세요.',setupMachineInactive:'비활성 설비라 완료할 수 없습니다.',setupNotPublished:'아직 확정 전입니다.',setupScope:'확정 변경 대상',setupActor:'앱 사용자',setupSaved:'셋업 상태를 저장했습니다.',setupFailed:'저장에 실패했습니다. 상태를 변경하지 않았습니다.',alertShortage:'부족',alertSurplus:'여유',alertZero:'수요 0',alertUnassigned:'미배정',alertNotComputable:'계산 불가',alertNotInForecast:'Forecast 없음',alertProcessMissing:'공정 미등록',alertDemandUnknown:'수요 불명',setupPreviousPlan:'이전 계획의 작업',alertsEmpty:'부족·여유가 없습니다.',groupLine:'{g} · 필요 {r} / 배정 {a}',alertMore:'외 {n}개',machinesUnit:'대',noticeReadOnly:'확정된 Layout 입니다 · 편집·확정할 수 없습니다. 배치를 다시 바꾸려면 Forecast 화면에서 새 추천을 만드세요.',adjusted:'사용자가 조정한 배치',recommendedAssignment:'추천 배치',noticeNoPlan:'추천 계획이 없습니다 · 지금은 현재 설비 배치만 보여 줍니다. 추천을 만들면 이 화면에서 미세조정·확정합니다.',noticeClosed:'대체되었거나 폐기된 계획입니다 · 편집·확정할 수 없습니다.',subtitleNoPlan:'현재 설비 배치를 확인합니다.',subtitleReadOnly:'확정된 Layout 과 현장 셋업 진행을 확인합니다.'},
 vi:{breadcrumb:'Kế hoạch sản xuất / Layout',subtitle:'Bố trí đề xuất tính từ nhu cầu Forecast và T/T đã đăng ký trong app. Tinh chỉnh từng máy rồi xác nhận.',notice:'Layout đề xuất · Chưa áp dụng vào thông tin máy cho đến khi xác nhận. Chỉnh sửa được lưu trên máy chủ.',demo:'Quay về đề xuất',demoBadge:'Layout đề xuất · CAPA theo T/T app',current:'Bố trí hiện tại',before:'Hiện tại',after:'Điều chỉnh',sourceBaseline:'Bố trí gốc của kế hoạch',source:'Thông tin máy·model trong app + bản vẽ',unvalidated:'CAPA tính theo T/T·ca·nghỉ đã đăng ký trong app (không chia cho cavity).',pending:'Cảnh báo CAPA',pendingText:'Thiếu·dư so với số máy cần theo model·công đoạn. Việc bố trí thêm máy dư do bạn quyết định.',confirm:'Xác nhận áp dụng Layout',footer:'Vị trí theo bản vẽ Layout đã đăng ký.',previewOnly:'Bản nháp chưa xác nhận',saved:'Đã lưu lên máy chủ.',autosaved:'Đã lưu máy chủ',saving:'Đang lưu…',saveFailed:'Không lưu được. Hãy thử lại.',conflict:'Người khác đã lưu trước. Đang tải lại.',recommendedLoaded:'Đã quay về đề xuất.',readOnly:'Layout không thể chỉnh sửa.',noPlanStatus:'Chưa có kế hoạch · bố trí hiện tại',confirmTitle:'Xác nhận Layout này?',confirmText:'{n} máy thay đổi sẽ vào danh sách chờ setup. Thông tin máy chưa đổi ngay; chỉ máy nào hoàn tất setup tại xưởng mới được cập nhật.',confirmShortage:'Vẫn còn thiếu {n} máy khi xác nhận.',confirmed:'Đã xác nhận. Theo dõi tiến độ ở Tiến độ setup.',confirmFailed:'Không xác nhận được.',stale:'Phân bổ máy đã thay đổi sau khi tạo kế hoạch. Hãy tạo đề xuất lại ở màn hình Forecast.',setupNotice:'Sau khi xác nhận, các máy thay đổi sẽ cần setup. Đánh dấu bắt đầu·hoàn tất tại xưởng. Chỉ máy đã hoàn tất mới được cập nhật model·công đoạn.',setupMachineChanged:'Máy này đã bị đổi sang model khác sau khi bắt đầu setup nên không thể hoàn tất. Hãy kiểm tra tình trạng máy.',setupMachineInactive:'Máy không hoạt động nên không thể hoàn tất.',setupNotPublished:'Chưa xác nhận.',setupScope:'Máy thay đổi đã xác nhận',setupActor:'Người dùng app',setupSaved:'Đã lưu trạng thái setup.',setupFailed:'Lưu thất bại. Trạng thái chưa thay đổi.',alertShortage:'Thiếu',alertSurplus:'Dư',alertZero:'Nhu cầu 0',alertUnassigned:'Chưa gán',alertNotComputable:'Không tính được',alertNotInForecast:'Không có Forecast',alertProcessMissing:'Chưa đăng ký công đoạn',alertDemandUnknown:'Nhu cầu không rõ',setupPreviousPlan:'Việc của kế hoạch trước',alertsEmpty:'Không thiếu·dư.',groupLine:'{g} · cần {r} / đã gán {a}',alertMore:'và {n} nhóm khác',machinesUnit:'máy',noticeReadOnly:'Layout đã xác nhận · không thể chỉnh sửa·xác nhận. Muốn đổi bố trí, hãy tạo đề xuất mới ở màn hình Forecast.',adjusted:'Bố trí do người dùng chỉnh',recommendedAssignment:'Bố trí đề xuất',noticeNoPlan:'Chưa có kế hoạch đề xuất · hiện chỉ hiển thị bố trí máy hiện tại. Sau khi tạo đề xuất, tinh chỉnh·xác nhận tại màn hình này.',noticeClosed:'Kế hoạch đã bị thay thế hoặc hủy · không thể chỉnh sửa·xác nhận.',subtitleNoPlan:'Xem bố trí máy hiện tại.',subtitleReadOnly:'Xem Layout đã xác nhận và tiến độ setup tại xưởng.'}
};
// Puzzle tray texts (2026-09-28).
Object.assign(dbMessages.ko,{trayTitle:'조각 트레이',trayHelp:'조각을 도면의 설비로 끌어 놓으세요. 원래 그 자리의 모델·공정은 트레이로 돌아옵니다. 설비를 끌어 다른 설비에 놓으면 옮겨지고, 아래 비우기에 놓으면 빈 자리가 됩니다. Shift+클릭으로 한 열의 여러 대를 묶습니다. 터치: 조각을 누른 뒤 설비를 누르세요.',trayNeed:'놓아야 할 조각',trayNeedEmpty:'모두 채웠습니다 ✓',traySpare:'여유 — 바꿔도 되는 설비',traySpareEmpty:'없음',trayDropOut:'여기에 설비를 끌어 놓으면 비우기(빈 자리)',ruleGood:'무리에 붙음',ruleWarn:'동선 공정 섞임',ruleBad:'섬·끼워넣기·3조각',violations:'규칙 위반',armed:'{g} 을(를) 놓을 설비를 누르세요 · 다시 누르거나 Esc 로 취소',noRoom:'그 열에는 이만큼 들어갈 자리가 없습니다.',placedBad:'⚠ 규칙 위반: {r} — 되돌리려면 ↶',placedWarn:'동선 안에 공정이 섞였습니다.',reasonIsland:'섬',reasonMiddle:'끼워넣기',reasonThree:'3조각',rangeHint:'한 열에서 {n}대 선택 — 끌어서 한 번에 옮기거나, 조각을 놓아 한 번에 채웁니다.',fromTile:'설비에서 옮기는 중',fromTray:'트레이에서'});
Object.assign(messages.ko,{emptySlot:'빈 자리'});Object.assign(messages.vi,{emptySlot:'Trống'});
Object.assign(dbMessages.ko,{setupPlanNotCurrent:'이 셋업은 새로 확정된 Layout 으로 대체되었습니다. 화면을 새로 불러오세요.',concurrentUpdate:'다른 작업과 동시에 처리되어 반영하지 못했습니다. 잠시 뒤 다시 시도하세요.'});
Object.assign(dbMessages.vi,{setupPlanNotCurrent:'Setup này đã được thay bằng Layout vừa xác nhận. Hãy tải lại màn hình.',concurrentUpdate:'Bị trùng với thao tác khác nên chưa áp dụng được. Hãy thử lại sau.'});
Object.assign(dbMessages.ko,{trayViewTitle:'현재 배정 현황',trayViewNote:'편집할 수 없는 화면입니다. 모델·공정별 배정 대수와 색을 확인하세요.',trayViewNoDemand:'수요(Forecast)가 없어 필요·차이는 비워 둡니다.'});
Object.assign(dbMessages.vi,{trayViewTitle:'Phân bổ hiện tại',trayViewNote:'Màn hình chỉ xem. Kiểm tra số máy và màu theo model·công đoạn.',trayViewNoDemand:'Chưa có Forecast nên để trống Cần·Chênh.'});
Object.assign(dbMessages.ko,{trayCapa:'CAPA',capaCount:'{n}개',capaRequired:'필요',capaAssigned:'배정',capaGap:'차이',trayLegend:'색 범례'});
Object.assign(dbMessages.vi,{trayCapa:'CAPA',capaCount:'{n} nhóm',capaRequired:'Cần',capaAssigned:'Đã gán',capaGap:'Chênh',trayLegend:'Chú thích màu'});
Object.assign(dbMessages.ko,{verdictGood:'✓ 무리에 붙음',verdictWarn:'⚠ 동선 공정 섞임',verdictEmpty:'여기 놓으면 비우기(빈 자리)'});
Object.assign(dbMessages.vi,{verdictGood:'✓ Liền nhóm',verdictWarn:'⚠ Lẫn công đoạn trong lối đi',verdictEmpty:'Thả vào đây để bỏ trống'});
Object.assign(dbMessages.ko,{setupBoard:'셋업 작업판',setupProgress:'완료 {d} / {n}대',setupListHint:'진행 중 → 대기 → 완료 순입니다. 행을 누르면 도면에서 위치를 보여 줍니다. 완료는 한 대씩 누릅니다 — 누르는 순간 그 설비의 모델·공정이 설비정보에 반영됩니다.',setupDoneTitle:'셋업 완료',setupDoneText:'바뀐 설비 {n}대의 셋업을 모두 마쳤습니다. 설비정보(모델·공정)에 반영됐습니다.',setupDonePeriod:'기간 {a} ~ {b}',setupRowDone:'완료 {t}'});
Object.assign(dbMessages.vi,{setupBoard:'Bảng setup',setupProgress:'Hoàn tất {d} / {n} máy',setupListHint:'Thứ tự: đang setup → chờ → hoàn tất. Chạm một dòng để xem vị trí trên bản vẽ. Hoàn tất từng máy một — khi nhấn, model·công đoạn của máy đó được cập nhật vào thông tin máy.',setupDoneTitle:'Setup hoàn tất',setupDoneText:'Đã hoàn tất setup cho cả {n} máy thay đổi. Thông tin máy (model·công đoạn) đã được cập nhật.',setupDonePeriod:'Thời gian {a} ~ {b}',setupRowDone:'Xong {t}'});
Object.assign(dbMessages.vi,{trayTitle:'Khay mảnh ghép',trayHelp:'Kéo mảnh ghép vào máy trên bản vẽ. Model·công đoạn cũ của máy đó quay về khay. Kéo một máy sang máy khác để di chuyển, thả vào ô Bỏ trống bên dưới để để trống. Shift+nhấp để chọn nhiều máy trong một cột. Cảm ứng: chạm mảnh ghép rồi chạm máy.',trayNeed:'Mảnh cần đặt',trayNeedEmpty:'Đã đủ ✓',traySpare:'Dư — máy có thể đổi',traySpareEmpty:'Không có',trayDropOut:'Thả máy vào đây để bỏ trống',ruleGood:'Liền nhóm',ruleWarn:'Lẫn công đoạn trong lối đi',ruleBad:'Tách rời·chèn giữa·3 đoạn',violations:'Vi phạm quy tắc',armed:'Chạm máy để đặt {g} · chạm lại hoặc Esc để hủy',noRoom:'Cột này không đủ chỗ.',placedBad:'⚠ Vi phạm: {r} — nhấn ↶ để hoàn tác',placedWarn:'Lối đi đang lẫn công đoạn.',reasonIsland:'tách rời',reasonMiddle:'chèn giữa',reasonThree:'3 đoạn',rangeHint:'Đã chọn {n} máy trong một cột — kéo để di chuyển cùng lúc hoặc thả mảnh ghép để điền cùng lúc.',fromTile:'Đang di chuyển từ máy',fromTray:'Từ khay'});

/**
 * Colours (user request 2026-09-28): the model is the hue, the process the lightness — C1 light, C2 dark, C0 hatched —
 * so a model's groups read as one family and a mixed walkway stands out. Hues are spread over the sorted model list;
 * a model outside it (inactive) gets a stable hue from its name.
 */
const PALETTE=[4,28,52,88,122,146,172,196,214,232,262,284,304,326,344,12,40,70,104,136,160,186,206,248,294,316];
const nameHue=model=>{let h=0;for(const ch of String(model))h=(h*31+ch.charCodeAt(0))%360;return h;};
const REASON_KEY={island:'reasonIsland',middle:'reasonMiddle',three_pieces:'reasonThree',mixed_process:'ruleWarn'};

/**
 * Mounts the studio into `root` (which must already contain the studio markup).
 * @param {HTMLElement} root
 * `backend` (optional) switches the studio from the Excel sample to a real layout plan (DB mode). Without it the
 * preview behaviour is unchanged. With it: the base is the plan's machine state, drafts save to the server, the
 * "example" button restores the recommendation, confirm applies the plan, setup tasks come from the server and
 * the CAPA alert panel is shown. Shape (see LayoutStudio.tsx):
 *   { readOnly, readOnlyReason ('no_plan'|'confirmed'|'closed'), initial:{draft,recommended,setup}, save(draft), confirm(draft), transition(no,to), summarize(draft), reload(), onConfirmed(result) }
 * @param {{ data: any, lang: 'ko' | 'vi', backend?: any }} options
 * @returns {{ setLang: (lang: 'ko' | 'vi') => void, destroy: () => void }}
 */
export function mountLayoutStudio(root, { data, lang: initialLang, backend = null }) {
const DATA = data;
const M = backend ? {ko:{...messages.ko,...dbMessages.ko},vi:{...messages.vi,...dbMessages.vi}} : messages;
const PROCESSES = DATA.processes || ['C0','C1','C2'];
const readOnly = !!(backend && backend.readOnly);
// Why it is read-only decides what the notice says (no plan ≠ no permission). Absent → treated as a confirmed plan.
const readOnlyReason = readOnly ? (backend.readOnlyReason || 'confirmed') : null;
// Hues go to the models this layout actually uses first — machines, plan edits and demand, as the prototype did (26 on
// W40). Spreading them over every registered model (31, five unused) shifted the colours away from the prototype.
const usedModels=[...new Set([...DATA.machines.map(m=>m.model),...(backend?Object.values(backend.initial.draft.edits).map(a=>a.model):[]),...(backend?backend.summarize(backend.initial.draft).groups.map(g=>g.model):[])].filter(Boolean))].sort((a,b)=>a.localeCompare(b));
const hueOrder=[...usedModels,...DATA.models.filter(m=>!usedModels.includes(m)).sort((a,b)=>a.localeCompare(b))];
const hueIndex = new Map(hueOrder.map((m,i)=>[m,i]));
const hueOf = model => hueIndex.has(model) ? PALETTE[hueIndex.get(model)%PALETTE.length] : nameHue(model);
/** {fill, solid, ink, stripe} for an assignment. `fill` may be a hatch pattern (C0); `solid` is for HTML swatches. */
function tone(a){
 if(!a||!a.model)return{fill:'#ffffff',solid:'#ffffff',ink:'#101828',stripe:'#aab3c0'};
 const h=hueOf(a.model);
 if(a.process==='C2')return{fill:`hsl(${h} 62% 40%)`,solid:`hsl(${h} 62% 40%)`,ink:'#ffffff',stripe:`hsl(${h} 70% 22%)`};
 if(a.process==='C0')return{fill:`url(#${hatchId(a.model)})`,solid:`hsl(${h} 72% 66%)`,ink:'#101828',stripe:`hsl(${h} 62% 40%)`};
 if(a.process==='C1')return{fill:`hsl(${h} 72% 82%)`,solid:`hsl(${h} 72% 82%)`,ink:'#101828',stripe:`hsl(${h} 62% 40%)`};
 return{fill:`hsl(${h} 55% 64%)`,solid:`hsl(${h} 55% 64%)`,ink:'#101828',stripe:`hsl(${h} 62% 32%)`};
}
const processesFor = model => (DATA.processesByModel && DATA.processesByModel[model]) || PROCESSES;
const $ = id => root.querySelector('#' + id);
const ns = 'http://www.w3.org/2000/svg';
const copy = value => JSON.parse(JSON.stringify(value));
const machines = new Map(DATA.machines.map(m => [m.id, m]));
let lang=messages[initialLang]?initialLang:'ko', building='B', mode='draft', selected=DATA.machines.some(m=>m.id===305)?305:DATA.machines[0].id;
building=DATA.machines.find(m=>m.id===selected).building;
// Building buttons come from the drawing, not the markup: 1공장 has B/A (448/352), 2공장 one building (B, 350).
// "All" only when there is more than one building to switch between.
{const wrap=root.querySelector('.segmented.buildings');const btn=(id,html,i18n)=>{const e=document.createElement('button');e.dataset.building=id;if(i18n)e.dataset.i18n=i18n;else e.innerHTML=html;return e;};
 wrap.replaceChildren(...DATA.buildings.map(b=>btn(b.id,`${b.id}<span data-i18n="buildingSuffix"></span><small>${DATA.machines.filter(m=>m.building===b.id).length}</small>`)),...(DATA.buildings.length>1?[btn('all','','all')]:[]));}
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
// C0 hatch patterns, created on first use. Ids are per mount so a remount never points at a removed pattern.
const hatchDefs=svgEl('defs'),hatchPrefix='ls-hatch-'+Math.random().toString(36).slice(2,8);$('map').prepend(hatchDefs);
function hatchId(model){const id=hatchPrefix+'-'+(hueIndex.has(model)?hueIndex.get(model):'h'+nameHue(model));if(!hatchDefs.querySelector('#'+id)){const h=hueOf(model),pattern=svgEl('pattern',{id,width:10,height:10,patternUnits:'userSpaceOnUse',patternTransform:'rotate(45)'});pattern.append(svgEl('rect',{width:10,height:10,fill:`hsl(${h} 72% 76%)`}),svgEl('rect',{width:4,height:10,fill:`hsl(${h} 62% 52%)`}));hatchDefs.append(pattern);}return id;}
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
function renderSaveStatus(){if(backend){$('saveStatus').textContent=readOnly?t(readOnlyReason==='no_plan'?'noPlanStatus':'readOnly'):saveState==='saving'?t('saving'):saveState==='failed'?t('saveFailed'):saveTime?t('autosaved')+' · '+saveTime.toLocaleTimeString(lang==='ko'?'ko-KR':'vi-VN',{hour:'2-digit',minute:'2-digit'}):t('previewOnly');return;}$('saveStatus').textContent=saveTime?t('autosaved')+' · '+saveTime.toLocaleTimeString(lang==='ko'?'ko-KR':'vi-VN',{hour:'2-digit',minute:'2-digit'}):t('previewOnly');}
function validDraft(value){return value && value.edits && Array.isArray(value.locks) && value.locks.every(id=>machines.has(id)) && Object.entries(value.edits).every(([id,a])=>machines.has(Number(id))&&a&&[...DATA.models,''].includes(a.model)&&(a.model===''||PROCESSES.includes(a.process)));}
if(backend){draft=copy(backend.initial.draft);}else try{const raw=JSON.parse(localStorage.getItem(storageKey)||'null');if(raw?.hash===DATA.sha256&&validDraft(raw.draft)){draft=raw.draft;undoStack=(raw.undoStack||[]).filter(validDraft).slice(-30);redoStack=(raw.redoStack||[]).filter(validDraft).slice(-30);saveTime=new Date(raw.at);}}catch{/* Invalid saved preview does not replace the source. */}
function commit(next){undoStack.push(copy(draft));undoStack=undoStack.slice(-30);redoStack=[];draft=next;persist();render();}
function setOptions(select,values,current){select.replaceChildren(...values.map(([value,text])=>{const e=document.createElement('option');e.value=value;e.textContent=text;return e;}));select.value=current;}
function translate(){root.querySelectorAll('[data-i18n]').forEach(e=>e.textContent=t(e.dataset.i18n));if(readOnly){root.querySelector('[data-i18n="notice"]').textContent=t(readOnlyReason==='no_plan'?'noticeNoPlan':readOnlyReason==='closed'?'noticeClosed':'noticeReadOnly');root.querySelector('[data-i18n="subtitle"]').textContent=t(readOnlyReason==='no_plan'?'subtitleNoPlan':'subtitleReadOnly');}for(const id of ['demo','save','reset','lock'])$(id).hidden=readOnly;$('search').placeholder=t('search');$('search').setAttribute('aria-label',t('search'));$('stage').setAttribute('aria-label',t('zoomLabel'));$('stageLabel').textContent=t('sourceBaseline');const filter=$('modelFilter').value;setOptions($('modelFilter'),[['',t('allModels')],...DATA.models.map(m=>[m,m])],filter);render();}
function render(){
 root.querySelectorAll('[data-building]').forEach(b=>b.classList.toggle('active',b.dataset.building===building));
 root.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
 root.classList.toggle('puzzle-mode',puzzleOn());
 $('buildingTitle').textContent=building==='all'?t('all'):buildingName(building);
 $('mapCount').textContent=visibleMachines().length+' '+t('count')+' · '+t('sourceBaseline');
 $('demoBadge').hidden=!draft.demo;
 // Alerts first: they recompute `summary`, which the inspector's group line reads. Drawing the inspector first
 // showed the previous draft's numbers after every edit/undo (2026-09-28).
 renderMap();renderAlerts();renderTray();renderInspector();renderChanges();renderLegend();renderSaveStatus();renderSetup();renderSetupBoard();
 $('undo').disabled=!undoStack.length;$('redo').disabled=!redoStack.length;
}
function renderMap(){
 const world=$('world');world.replaceChildren();
 for(const b of DATA.buildings.filter(b=>building==='all'||b.id===building)){
  world.append(svgEl('rect',{x:b.x,y:b.y,width:b.width,height:b.height,class:'building-border'}));
  const name=svgEl('text',{x:60,y:b.y+47,class:'building-name'});name.textContent=buildingName(b.id);world.append(name);
  const note=svgEl('text',{x:200,y:b.y+45,class:'building-note'});note.textContent=b.count+' '+t('count')+' / W39';world.append(note);
 }
 const filter=$('modelFilter').value,only=$('changedOnly').checked,puzzle=puzzleOn();
 root.classList.toggle('puzzle-focus',puzzle&&!!armed);
 if(puzzle)puzzleViolations=board.violations(draftState(),baseState);
 for(const m of visibleMachines()){
  const a=mode==='setup'?setupAssignment(m):(mode==='current'?baseAssignment(m):assignment(m)),changed=mode==='setup'?!!setupTask(m.id):!!draft.edits[m.id],locked=mode!=='setup'&&draft.locks.includes(m.id);
  const task=mode==='setup'?setupTask(m.id):null;
  const dim=(filter&&a.model!==filter)||(mode!=='setup'&&only&&!changed)||(mode==='setup'&&!setupMatches(m.id));
  const g=svgEl('g',{class:['machine',selected===m.id?'selected':'',changed&&mode!=='current'?'changed':'',locked?'locked':'',dim?'dim':'',a.model?'':'empty',puzzle&&range.includes(m.id)?'in-range':'',puzzle&&armed&&a.model&&keyOf(a)===keyOf(armed)?'kin':''].join(' '),transform:`translate(${m.x} ${m.y})`,'data-id':m.id,tabindex:dim?-1:0,role:'button','aria-label':displayName(m.id)+' '+buildingName(m.building)+' '+label(a),'aria-pressed':selected===m.id});
  const tn=tone(a);
  if(puzzle)g.append(svgEl('rect',{x:-6,y:-6,width:116,height:74,class:'puzzle-ring'}));
  g.append(svgEl('rect',{width:104,height:62,fill:tn.fill,class:'machine-body'}));
  // Inline style, not the fill attribute: the CSS class colour would win over an attribute and hide text on dark (C2) tiles.
  const number=svgEl('text',{x:10,y:27,class:'machine-number'});number.textContent=String(m.id).padStart(3,'0');number.style.fill=tn.ink;g.append(number);
  if(mode==='compare'&&changed){const old=svgEl('text',{x:10,y:42,'font-size':12,opacity:.75});old.style.fill=tn.ink;old.textContent=label(baseAssignment(m));g.append(old);const newText=svgEl('text',{x:10,y:56,'font-size':13,'font-weight':700});newText.style.fill=tn.ink;newText.textContent='→ '+(a.model?label(a):t('emptySlot'));g.append(newText);}else{const code=svgEl('text',{x:10,y:49,class:'machine-model'});code.style.fill=tn.ink;code.textContent=a.model?label(a):t('emptySlot');g.append(code);}
  if(puzzle&&puzzleViolations.machines.has(m.id))g.append(svgEl('path',{d:'M82 60 l10 -18 l10 18 z',class:'puzzle-viol-mark'}));
  if(changed&&mode!=='current'){g.append(svgEl('circle',{cx:95,cy:9,r:5,class:'change-mark'}));}else if(locked){const mark=svgEl('text',{x:86,y:25,fill:'#647790','font-size':21});mark.textContent='▣';g.append(mark);}
  g.addEventListener('click',e=>{if(wasDrag)return;if(puzzleOn()&&puzzleClick(m.id,e))return;selectMachine(m.id);});
  g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectMachine(m.id);}});
  if(mode==='setup')setupBadge(g,task);
  world.append(g);
 }
 transform();renderMinimap();
}
function renderMinimap(){const mini=$('minimap');mini.replaceChildren();for(const b of DATA.buildings){mini.append(svgEl('rect',{x:b.x,y:b.y,width:b.width,height:b.height,fill:'#f0f3f7',stroke:'#b8c6d7','stroke-width':15}));}for(const m of DATA.machines)mini.append(svgEl('rect',{x:m.x,y:m.y,width:104,height:62,fill:draft.edits[m.id]?'#cc7927':(m.model?tone(baseAssignment(m)).solid:'#a0adbc')}));mini.append(svgEl('rect',{id:'viewport',fill:'#2357c616',stroke:'#2357c6','stroke-width':30}));updateViewport();}
function transform(){$('world').setAttribute('transform',`translate(${tx} ${ty}) scale(${scale})`);$('zoomValue').textContent=Math.round(scale*100)+'%';updateViewport();}
function updateViewport(){const rect=$('viewport');if(!rect)return;rect.setAttribute('x',-tx/scale);rect.setAttribute('y',-ty/scale);rect.setAttribute('width',$('stage').clientWidth/scale);rect.setAttribute('height',$('stage').clientHeight/scale);}
function zoom(factor,x=$('stage').clientWidth/2,y=$('stage').clientHeight/2){const before=scale;scale=Math.max(.08,Math.min(2.5,scale*factor));tx=x-(x-tx)*scale/before;ty=y-(y-ty)*scale/before;transform();}
function fit(){const bs=DATA.buildings.filter(b=>building==='all'||b.id===building);const left=Math.min(...bs.map(b=>b.x)),top=Math.min(...bs.map(b=>b.y)),right=Math.max(...bs.map(b=>b.x+b.width)),bottom=Math.max(...bs.map(b=>b.y+b.height));const stage=$('stage');scale=Math.min((stage.clientWidth-34)/(right-left),(stage.clientHeight-95)/(bottom-top));tx=(stage.clientWidth-(right-left)*scale)/2-left*scale;ty=58+(stage.clientHeight-95-(bottom-top)*scale)/2-top*scale;transform();}
function focusMachine(id){const m=machines.get(id);if(!m)return;scale=window.innerWidth<760?.76:.58;tx=$('stage').clientWidth/2-(m.x+52)*scale;ty=$('stage').clientHeight/2-(m.y+31)*scale;transform();}
function selectMachine(id,focus=false){selected=id;const m=machines.get(id);if(focus||(building!=='all'&&building!==m.building))building=m.building;render();if(focus)focusMachine(id);root.querySelector('.inspector').classList.add('mobile-open');}
function renderInspector(){const m=machines.get(selected);const a=assignment(m);$('selectedName').textContent=displayName(m.id);$('selectedLocation').textContent=buildingName(m.building)+' · '+t('cell')+' '+m.cell;$('currentLabel').textContent=label(baseAssignment(m));$('draftLabel').textContent=label(a);const locked=draft.locks.includes(m.id);$('selectionStatus').textContent=locked?t('fixed'):backend?t(selectionKey(m.id)):(draft.edits[m.id]?t('modified'):t('unchanged'));$('selectionStatus').classList.toggle('changed',!!draft.edits[m.id]);$('lock').disabled=readOnly;renderGroupAlert(a);$('lock').textContent=(locked?'▣ ':'□ ')+t(locked?'unlock':'lock');$('lock').classList.toggle('is-locked',locked);}
function renderChanges(){const ids=changedIds();$('changeCount').textContent=ids.length;$('changes').replaceChildren();if(!ids.length){const empty=document.createElement('div');empty.className='empty';empty.style.whiteSpace='pre-line';empty.textContent=t('empty');$('changes').append(empty);return;}for(const id of ids){const m=machines.get(id),a=assignment(m);const b=document.createElement('button');b.className='change-row';b.dataset.changeId=id;const d=document.createElement('div'),name=document.createElement('strong'),small=document.createElement('small'),value=document.createElement('span');name.textContent=displayName(id)+' · '+buildingName(m.building);small.textContent=label(baseAssignment(m));value.textContent='→ '+label(a);d.append(name,small);b.append(d,value);b.onclick=()=>selectMachine(id,true);$('changes').append(b);}}
function renderLegend(){$('legend').replaceChildren();for(const model of DATA.models){const span=document.createElement('span');span.className='legend-model';for(const process of processesFor(model)){const dot=document.createElement('i');dot.style.background=tone({model,process}).solid;dot.title=process;span.append(dot);}span.append(document.createTextNode(model));$('legend').append(span);}const changed=document.createElement('span');changed.textContent='● '+t('changed');changed.style.color='#101828';$('legend').append(changed);}

// ── Setup workflow (preview setup.js) ────────────────────────────────────────
const setupKey='cnc-layout-setup-preview-v1-'+DATA.sha256;
let setupBatch=null;
const statusKey={pending:'setupWaiting',in_progress:'setupWorking',completed:'setupDone'};
function validSetup(value){return value?.sourceHash===DATA.sha256 && typeof value.version==='string' && value.tasks && Object.entries(value.tasks).every(([id,task])=>machines.has(Number(id)) && statusKey[task.status] && task.target && [...DATA.models,''].includes(task.target.model) && (task.target.model===''||PROCESSES.includes(task.target.process)) && Array.isArray(task.events));}
if(backend)setupBatch=backend.initial.setup?copy(backend.initial.setup):null;else try{const value=JSON.parse(localStorage.getItem(setupKey)||'null');if(validSetup(value))setupBatch=value;}catch{/* Ignore invalid local examples. */}
function saveSetup(next){try{localStorage.setItem(setupKey,JSON.stringify(next));setupBatch=next;return true;}catch{toast(t('setupFailed'));return false;}}
function setupTask(id){return setupBatch?.tasks[id]||null;}
function setupAssignment(m){return setupTask(m.id)?.target||baseAssignment(m);}
// Setup view: with no filter only the machines that need a setup stay vivid (user 2026-09-28); 'none' shows the others.
function setupMatches(id){const filter=$('setupFilter').value;if(!filter)return !setupBatch||!!setupTask(id);return (setupTask(id)?.status||'none')===filter;}
function setupBadge(g,task){if(!task)return;const badge=svgEl('text',{x:85,y:27,fill:{pending:'#697789',in_progress:'#bb6410',completed:'#16774d'}[task.status],'font-size':20,'font-weight':700});g.querySelector('.change-mark')?.remove();badge.textContent={pending:'○',in_progress:'◐',completed:'✓'}[task.status];g.append(badge);g.dataset.setup=task.status;g.setAttribute('aria-label',g.getAttribute('aria-label')+' '+t(statusKey[task.status]));}
function renderSetup(){
 const active=mode==='setup',task=setupTask(selected),tasks=Object.values(setupBatch?.tasks||{});
 $('setupPublish').hidden=!!backend;
 $('setupPublish').disabled=!!setupBatch||!changedIds().length;
 $('setupPublish').textContent=t(setupBatch?'setupFrozen':'setupPublish');
 $('setupCounts').textContent=setupBatch?t('setupScope')+' '+tasks.length+' · '+['pending','in_progress','completed'].map(s=>t(statusKey[s])+' '+tasks.filter(task=>task.status===s).length).join(' / '):t('setupNotPublished');
 $('setupFilter').hidden=!active;const filter=$('setupFilter').value;setOptions($('setupFilter'),[['',t('setupAll')],...Object.entries(statusKey).map(([s,key])=>[s,t(key)]),['none',t('setupNone')]],filter);
 $('setupPanel').hidden=!active;
 for(const selector of ['.assignment','#selectionStatus','#lock','.inspector > .help','.changes-section','.review-box'])root.querySelector(selector).hidden=active||(readOnly&&selector==='#lock');
 $('modelFilter').hidden=active;$('changedOnly').parentElement.hidden=active;
 if(!active){$('stageLabel').textContent=t('sourceBaseline');return;}
 $('legend').replaceChildren();for(const [status,key] of Object.entries(statusKey)){const item=document.createElement('span');item.textContent=t(key);item.dataset.state=status;$('legend').append(item);}
 $('stageLabel').textContent=t('setupView')+' · '+(setupBatch?.version||'—');
 $('setupState').textContent=t(task?statusKey[task.status]:(setupBatch?'setupNone':'setupNotPublished'));$('setupState').dataset.state=task?.status||'none';
 $('setupTarget').textContent=t('setupTarget')+': '+label(setupAssignment(machines.get(selected)))+(task?' ('+label(task.before)+' → '+label(task.target)+')':'')+(task&&task.previousPlan?' · '+t('setupPreviousPlan'):'');
 $('setupTimes').replaceChildren();
 if(task)for(const event of task.events){const line=document.createElement('div');line.textContent=t({pending:'setupAt',in_progress:'setupStarted',completed:'setupFinished'}[event.status])+' · '+new Date(event.at).toLocaleString(lang==='ko'?'ko-KR':'vi-VN')+' · '+t('setupActor');$('setupTimes').append(line);}
 $('setupStart').hidden=!task||task.status!=='pending';$('setupComplete').hidden=!task||task.status!=='in_progress';$('setupStart').disabled=$('setupComplete').disabled=setupBusy.has(selected);
}
// One machine per call (user decision 2026-09-28: no bulk complete — completing writes that machine to the DB). A machine
// with a request in flight is busy, so a double click cannot send the same transition twice.
let setupBusy=new Set();
function transitionSetup(from,to,id=selected){const task=setupTask(id);if(!task||task.status!==from||setupBusy.has(id))return;if(backend){setupBusy.add(id);render();backend.transition(id,to).then(next=>{setupBatch=next;toast(t('setupSaved'));}).catch(error=>{const code=error&&error.code;toast(code==='setup_machine_changed'?t('setupMachineChanged'):code==='machine_inactive'?t('setupMachineInactive'):code==='setup_plan_not_current'?t('setupPlanNotCurrent'):code==='concurrent_update'?t('concurrentUpdate'):t('setupFailed'));}).finally(()=>{setupBusy.delete(id);render();});return;}const next=copy(setupBatch);next.tasks[id].status=to;next.tasks[id].events.push({status:to,at:new Date().toISOString(),actor:'preview-user'});if(saveSetup(next)){render();toast(t('setupSaved'));}}

// ── Setup board (user decision 2026-09-28) ───────────────────────────────────
// Every task of the confirmed plan in one list — in progress, then waiting, then done, by walkway and number — with the
// next action on each row, a progress bar, and a "setup complete" summary once every machine is done.
const setupBoard=document.createElement('section');setupBoard.className='setup-board';setupBoard.id='setupBoard';setupBoard.hidden=true;
setupBoard.innerHTML='<div class="puzzle-head"><strong data-i18n="setupBoard"></strong><span id="setupProgressText" class="setup-progress-text"></span></div>'
 +'<div class="setup-progress" role="progressbar" aria-valuemin="0"><span id="setupProgressBar"></span></div>'
 +'<div id="setupDone" class="setup-done" hidden></div>'
 +'<p class="puzzle-help" data-i18n="setupListHint"></p><div id="setupList" class="setup-list"></div>';
root.querySelector('.inspector').prepend(setupBoard);
const when=at=>new Date(at).toLocaleString(lang==='ko'?'ko-KR':'vi-VN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
function renderSetupBoard(){
 const on=mode==='setup'&&!!setupBatch;setupBoard.hidden=!on;if(!on)return;
 const rank={in_progress:0,pending:1,completed:2};
 const rows=Object.entries(setupBatch.tasks).map(([id,task])=>({id:Number(id),task,m:machines.get(Number(id))})).filter(r=>r.m)
  .sort((a,b)=>rank[a.task.status]-rank[b.task.status]||String(a.m.walkway||'').localeCompare(String(b.m.walkway||''))||a.id-b.id);
 const done=rows.filter(r=>r.task.status==='completed').length,total=rows.length;
 $('setupProgressText').textContent=tf('setupProgress',{d:done,n:total});
 const bar=$('setupProgressBar');bar.style.width=(total?done/total*100:0)+'%';bar.parentElement.setAttribute('aria-valuenow',done);bar.parentElement.setAttribute('aria-valuemax',total);
 const allDone=total>0&&done===total;$('setupDone').hidden=!allDone;
 if(allDone){
  const times=rows.map(r=>(r.task.events.find(e=>e.status==='completed')||{}).at).filter(Boolean).sort();
  const title=document.createElement('strong');title.textContent='✓ '+t('setupDoneTitle');
  const text=document.createElement('p');text.textContent=tf('setupDoneText',{n:total});
  const period=document.createElement('small');period.textContent=times.length?tf('setupDonePeriod',{a:when(times[0]),b:when(times[times.length-1])}):'';
  $('setupDone').replaceChildren(title,text,period);
 }
 $('setupList').replaceChildren(...rows.map(({id,task})=>{
  const row=document.createElement('div');row.className='setup-row'+(id===selected?' selected':'');row.dataset.id=id;row.dataset.state=task.status;
  const main=document.createElement('button');main.type='button';main.className='setup-row-main';
  const icon=document.createElement('span');icon.className='setup-icon';icon.textContent={pending:'○',in_progress:'◐',completed:'✓'}[task.status];
  const name=document.createElement('strong');name.textContent=String(id).padStart(3,'0');
  const sw=document.createElement('i');sw.className='setup-swatch';sw.style.background=tone(task.target).solid;
  const change=document.createElement('small');change.textContent=label(task.before)+' → '+label(task.target)+(task.previousPlan?' · '+t('setupPreviousPlan'):'');
  main.append(icon,name,sw,change);main.onclick=()=>selectMachine(id,true);row.append(main);
  if(task.status==='completed'){const at=(task.events.find(e=>e.status==='completed')||{}).at;const s=document.createElement('span');s.className='setup-row-time';s.textContent=at?tf('setupRowDone',{t:when(at)}):t('setupDone');row.append(s);}
  else{const action=document.createElement('button');action.type='button';action.className='setup-row-action'+(task.status==='in_progress'?' primary':'');action.textContent=t(task.status==='pending'?'setupStart':'setupComplete');action.disabled=setupBusy.has(id);action.onclick=()=>{selected=id;transitionSetup(task.status,task.status==='pending'?'in_progress':'completed',id);};row.append(action);}
  return row;
 }));
}

// ── DB mode: CAPA alerts + confirm ───────────────────────────────────────────
const ALERT_KEY={shortage:'alertShortage',process_missing:'alertProcessMissing',demand_unknown:'alertDemandUnknown',surplus:'alertSurplus',zero_demand:'alertZero',not_computable:'alertNotComputable',not_in_forecast:'alertNotInForecast'};
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
 for(const g of rows.slice(0,8)){const b=document.createElement('button');b.className='alert-row';b.dataset.state=g.status;b.dataset.model=g.model;b.dataset.code=g.code;
  const name=document.createElement('strong');name.textContent=g.code;const detail=document.createElement('small');
  detail.textContent=t(ALERT_KEY[g.status])+(g.gap===null||g.gap===0?'':' '+Math.abs(g.gap)+t('machinesUnit'))+(g.required===null?'':' · '+g.assigned+'/'+g.required)+(g.utilization===null?'':' · '+Math.round(g.utilization*100)+'%');
  b.append(name,detail);b.onclick=()=>{$('modelFilter').value=g.model;$('changedOnly').checked=false;if(mode==='setup')mode='draft';render();};$('alertList').append(b);}
 if(rows.length>8){const more=document.createElement('div');more.className='empty';more.textContent=tf('alertMore',{n:rows.length-8});$('alertList').append(more);}
 $('confirmLayout').disabled=readOnly||!backend.confirm;
}
// Plan mode: a machine that just follows the recommendation is not a user edit (the preview's "modified · not validated"
// was wrong there — CAPA is validated in plan mode).
function selectionKey(no){const cur=draft.edits[no],rec=backend.initial.recommended.edits[no];const same=(cur&&cur.model)===(rec&&rec.model)&&(cur&&cur.process)===(rec&&rec.process);return same?(cur?'recommendedAssignment':'unchanged'):'adjusted';}
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
  .catch(error=>{toast(error&&error.code==='layout_base_stale'?t('stale'):error&&error.code==='concurrent_update'?t('concurrentUpdate'):t('confirmFailed'));render();});};

// ── Puzzle tray (user decision 2026-09-28) ───────────────────────────────────
// A piece is a model·process group. Dropping one on a machine sends whatever the machine held back to the tray through
// CAPA (short → "to place", over → "spare"). Rules are shown, never enforced: when no attachable spot exists the user
// decides (user decision) — the recommendation already applies the same rules.
const board=new PuzzleBoard(DATA.machines.map(m=>({id:m.id,y:m.y,height:m.height,walkway:m.walkway??null,side:m.side??null})));
const keyOf=a=>pieceKey(a.model,a.process);
const baseState=new Map(DATA.machines.map(m=>[m.id,keyOf(baseAssignment(m))]));
const draftState=()=>new Map(DATA.machines.map(m=>[m.id,keyOf(assignment(m))]));
let range=[],armed=null,drag=null,puzzleViolations={count:0,machines:new Set()};
function puzzleOn(){return !!backend&&!readOnly&&(mode==='draft'||mode==='compare');}
const tray=document.createElement('section');tray.className='puzzle-tray';tray.id='puzzleTray';tray.hidden=true;
tray.innerHTML='<div class="puzzle-head"><strong id="trayTitle" data-i18n="trayTitle"></strong><span id="puzzleViolations" class="puzzle-viol"></span></div>'
 +'<p class="puzzle-help" data-i18n="trayHelp"></p><p id="trayViewNote" class="puzzle-view-note" hidden></p>'
 +'<div class="puzzle-rules"><span data-level="good" data-i18n="ruleGood"></span><span data-level="warn" data-i18n="ruleWarn"></span><span data-level="bad" data-i18n="ruleBad"></span></div>'
 +'<p id="puzzleArmed" class="puzzle-note" hidden></p><p id="puzzleRange" class="puzzle-note" hidden></p>'
 +'<h4 class="need"><span data-i18n="trayNeed"></span><span class="n" id="needCount"></span></h4><div id="needCards" class="puzzle-cards"></div>'
 +'<h4 class="spare"><span data-i18n="traySpare"></span><span class="n" id="spareCount"></span></h4><div id="spareCards" class="puzzle-cards"></div>'
 +'<div id="puzzleDropOut" class="puzzle-dropout" data-i18n="trayDropOut"></div>'
 // CAPA table + colour legend, as in the prototype (user 2026-09-28).
 +'<h4 class="capa"><span data-i18n="trayCapa"></span><span class="n" id="capaCount"></span></h4><table id="capaTable" class="puzzle-capa"></table>'
 +'<h4 class="legend-title"><span data-i18n="trayLegend"></span></h4><div id="trayLegend" class="puzzle-legend"></div>';
root.querySelector('.inspector').prepend(tray);
// While puzzling the panel is the tray (user 2026-09-28): the selected-machine card, lock, change list and CAPA alert
// rows are hidden by CSS (.puzzle-mode). Undo/redo move up next to the tray title; the CAPA totals and the confirm
// button stay at the bottom.
{const history=document.createElement('span');history.className='puzzle-history';history.append($('undo'),$('redo'));tray.querySelector('.puzzle-head').append(history);}
const ghost=document.createElement('div');ghost.className='puzzle-ghost';ghost.hidden=true;root.append(ghost);
const groupCounts=()=>new Map((summary?summary.groups:[]).map(g=>[g.code,g.assigned]));
const codeOf=a=>a.model+'-'+a.process;
const cardFor=code=>[...tray.querySelectorAll('.puzzle-card')].find(c=>c.dataset.code===code)||null;
const tileEl=id=>$('world').querySelector('g.machine[data-id="'+id+'"]');
/** Read-only screens (no plan, confirmed, closed) show the same panel as a view: assignments + colours, no editing. */
function trayViewOn(){return !!backend&&readOnly&&mode!=='setup';}
function renderTray(){
 const on=puzzleOn(),view=!on&&trayViewOn();tray.hidden=!on&&!view;tray.classList.toggle('view-only',view);
 if(!on){armed=null;range=[];}
 if(!on&&!view)return;
 $('trayTitle').textContent=t(view?'trayViewTitle':'trayTitle');
 // Only groups a machine can actually be set to: a process missing from the app has no id to save.
 const groups=summary.groups.filter(g=>g.model&&g.process&&g.process!=='?'&&g.status!=='process_missing');
 const noDemand=!groups.some(g=>g.required!==null);
 $('trayViewNote').hidden=!view;if(view)$('trayViewNote').textContent=t('trayViewNote')+(noDemand?' '+t('trayViewNoDemand'):'');
 if(view){renderCapa(groups,noDemand);return;}
 const need=groups.filter(g=>g.status==='shortage').map(g=>[g,-g.gap]).sort((a,b)=>b[1]-a[1]||a[0].code.localeCompare(b[0].code));
 const spare=groups.filter(g=>(g.status==='surplus'||g.status==='zero_demand')&&g.gap>0).map(g=>[g,g.gap]).sort((a,b)=>b[1]-a[1]||a[0].code.localeCompare(b[0].code));
 const card=([g,n],kind)=>{const b=document.createElement('button');b.type='button';b.className='puzzle-card '+kind+(armed&&keyOf(armed)===keyOf(g)?' armed':'');b.dataset.model=g.model;b.dataset.process=g.process;b.dataset.code=g.code;
  const sw=document.createElement('span');sw.className='sw';sw.style.background=tone(g).solid;const name=document.createElement('span');name.className='t';name.textContent=g.model;const proc=document.createElement('span');proc.className='s';proc.textContent=g.process;const cnt=document.createElement('span');cnt.className='cnt';cnt.textContent=n;b.append(sw,name,proc,cnt);return b;};
 const fill=(el,rows,kind,emptyKey)=>{el.replaceChildren(...rows.map(r=>card(r,kind)));if(!rows.length){const e=document.createElement('span');e.className='puzzle-empty';e.textContent=t(emptyKey);el.append(e);}};
 fill($('needCards'),need,'need','trayNeedEmpty');fill($('spareCards'),spare,'spare','traySpareEmpty');
 $('needCount').textContent=need.reduce((s,x)=>s+x[1],0);$('spareCount').textContent=spare.reduce((s,x)=>s+x[1],0);
 $('puzzleViolations').textContent=board.hasWalkways?t('violations')+' '+puzzleViolations.count:'';$('puzzleViolations').classList.toggle('bad',puzzleViolations.count>0);
 tray.querySelector('.puzzle-rules').hidden=!board.hasWalkways;
 $('puzzleArmed').hidden=!armed;if(armed)$('puzzleArmed').textContent=tf('armed',{g:label(armed)});
 $('puzzleRange').hidden=range.length<2;if(range.length>1)$('puzzleRange').textContent=tf('rangeHint',{n:range.length});
 renderCapa(groups,false);
}
function renderCapa(groups,noDemand){
 // CAPA: every group with a known requirement, most short first (gap ascending), then by name. Without any demand
 // (no plan yet — 2공장 2026-09-28) every assigned group, by name, with need/gap left blank.
 const capa=noDemand?groups.filter(g=>g.assigned>0).sort((a,b)=>a.code.localeCompare(b.code))
  :groups.filter(g=>g.required!==null&&(g.required>0||g.assigned>0)).sort((a,b)=>a.gap-b.gap||a.code.localeCompare(b.code));
 $('capaCount').textContent=tf('capaCount',{n:capa.length});
 const cell=(text,cls)=>{const td=document.createElement('td');if(cls)td.className=cls;td.textContent=text;return td;};
 const head=document.createElement('tr');head.append(cell(''),cell(t('capaRequired'),'num'),cell(t('capaAssigned'),'num'),cell(t('capaGap'),'num'));
 $('capaTable').replaceChildren(head,...capa.map(g=>{const tr=document.createElement('tr');tr.dataset.code=g.code;tr.className=g.gap===null?'':g.gap<0?'short':g.gap>0?'over':'';
  const name=cell('');const sw=document.createElement('i');sw.className='sw-inline';sw.style.background=tone(g).solid;name.append(sw,document.createTextNode(g.model+' '+g.process));
  tr.append(name,cell(g.required===null?'—':String(g.required),'num'),cell(String(g.assigned),'num'),cell(g.gap===null?'—':(g.gap>0?'+':'')+g.gap,'num d'));return tr;}));
 $('trayLegend').replaceChildren(...DATA.models.map(model=>{const row=document.createElement('div');for(const process of processesFor(model)){const sw=document.createElement('i');sw.className='sw-inline';sw.title=process;sw.style.background=tone({model,process}).solid;row.append(sw);}row.append(document.createTextNode(model));return row;}));
}
/** Put `pieces[k]` on `targets[k]`; `sources` (a machine dragged off the map) become empty unless also a target. */
function puzzlePlace(pieces,targets,sources){
 const src=sources||[];
 if([...targets,...src].some(id=>draft.locks.includes(id))){toast(t('locked'));render();return;}
 const next=copy(draft),displaced=[];
 const put=(id,a)=>{const m=machines.get(id);if(a.model===m.model&&a.process===m.process)delete next.edits[id];else next.edits[id]={model:a.model,process:a.process};};
 targets.forEach((id,k)=>{const cur=assignment(machines.get(id));if(cur.model&&!src.includes(id)&&keyOf(cur)!==keyOf(pieces[k]))displaced.push({id,a:cur});put(id,pieces[k]);});
 for(const id of src)if(!targets.includes(id))put(id,{model:'',process:''});
 if(JSON.stringify(next.edits)===JSON.stringify(draft.edits)){toast(t('same'));render();return;}
 const before=draftState();for(const id of src)before.set(id,null);
 const verdict=pieces[0].model?board.evaluate(before,keyOf(pieces[0]),targets):{level:'good',reasons:[]};
 const prev=groupCounts();
 commit(next);
 // The displaced pieces fly back to their card; every CAPA row whose count moved flashes.
 for(const d of displaced){const from=tileEl(d.id);if(from)fly(from,cardFor(codeOf(d.a))||tray,d.a);}
 for(const [code,n] of groupCounts())if(prev.get(code)!==n){cardFor(code)?.classList.add('flash');root.querySelector('.alert-row[data-code="'+CSS.escape(code)+'"]')?.classList.add('flash');root.querySelector('.puzzle-capa tr[data-code="'+CSS.escape(code)+'"]')?.classList.add('flash');}
 if(verdict.level==='bad')toast(tf('placedBad',{r:verdict.reasons.map(r=>t(REASON_KEY[r])).join(', ')}));else if(verdict.level==='warn')toast(t('placedWarn'));
}
function fly(fromEl,toEl,a){
 const from=fromEl.getBoundingClientRect(),to=toEl.getBoundingClientRect(),tn=tone(a),f=document.createElement('div');
 f.className='puzzle-flyer';f.textContent=label(a);f.style.background=tn.solid;f.style.color=tn.ink;f.style.left=(from.left+from.width/2-30)+'px';f.style.top=(from.top+from.height/2-10)+'px';root.append(f);
 requestAnimationFrame(()=>{f.style.transform=`translate(${to.left+20-from.left-from.width/2+30}px, ${to.top+8-from.top-from.height/2+10}px) scale(.8)`;f.style.opacity='.2';});
 setTimeout(()=>f.remove(),750);
}
/** Click on a machine while puzzling: Shift extends a same-column range; an armed piece is placed. False → normal select. */
function puzzleClick(id,e){
 const r=e.shiftKey&&selected!==id?board.range(selected,id):null;
 if(r){range=r;selected=id;render();return true;}
 if(armed){const targets=range.length>1&&range.includes(id)?range.slice():[id];range=[];selected=id;puzzlePlace(targets.map(()=>armed),targets,null);return true;}
 range=[];return false;
}
const dropTargets=id=>drag.kind==='card'&&range.length>1&&range.includes(id)?range.slice():board.blockFrom(id,drag.kind==='tile'?drag.sources.length:1);
function startDrag(kind,e,extra){drag={kind,x0:e.clientX,y0:e.clientY,active:false,...extra};}
function activateDrag(){
 drag.active=true;root.classList.add('puzzle-dragging','puzzle-focus');
 const piece=drag.pieces[0],tn=tone(piece);
 drag.key=keyOf(piece);drag.state=draftState();for(const id of drag.sources||[])drag.state.set(id,null);drag.hover=null;
 const name=document.createElement('b'),from=document.createElement('small'),verdict=document.createElement('span');
 name.textContent=label(piece)+(drag.pieces.length>1?' ×'+drag.pieces.length:'');from.textContent=t(drag.kind==='tile'?'fromTile':'fromTray');verdict.className='puzzle-verdict';
 ghost.replaceChildren(name,from,verdict);ghost.style.background=tn.solid;ghost.style.color=tn.ink;ghost.dataset.level='';ghost.hidden=false;
 // Only the piece's own group (and what is being carried) stays vivid; the rest of the floor dims (user 2026-09-28).
 for(const g of $('world').querySelectorAll('g.machine')){const id=Number(g.dataset.id);g.classList.toggle('kin',(!!drag.key&&drag.state.get(id)===drag.key)||(drag.sources||[]).includes(id));}
}
/**
 * The rule verdict is shown for the spot under the pointer only — its outline plus a line on the carried piece — not on
 * every machine at once, which painted the whole floor red (user 2026-09-28).
 */
function showVerdict(el){
 const tile=el&&el.closest('g.machine'),id=tile&&root.contains(tile)?Number(tile.dataset.id):null,onTray=!!(el&&el.closest('.puzzle-tray'));
 const targets=id===null?null:dropTargets(id),hover=onTray?'tray':id===null?'':targets?targets.join(','):'none';
 if(hover===drag.hover)return;drag.hover=hover;
 for(const g of $('world').querySelectorAll('g.machine.puzzle-target')){g.classList.remove('puzzle-target');g.querySelector('.puzzle-ring')?.setAttribute('class','puzzle-ring');}
 const verdict=ghost.querySelector('.puzzle-verdict');verdict.textContent='';ghost.dataset.level='';
 if(onTray){if(drag.kind==='tile'){verdict.textContent=t('verdictEmpty');ghost.dataset.level='empty';}return;}
 if(id===null)return;
 if(!targets){verdict.textContent=t('noRoom');ghost.dataset.level='bad';return;}
 const v=drag.key?board.evaluate(drag.state,drag.key,targets):{level:'good',reasons:[]};
 for(const x of targets){const g=tileEl(x);if(!g)continue;g.classList.add('puzzle-target');g.querySelector('.puzzle-ring')?.setAttribute('class','puzzle-ring '+v.level);}
 verdict.textContent=v.level==='good'?t('verdictGood'):v.level==='warn'?t('verdictWarn'):'✕ '+v.reasons.map(r=>t(REASON_KEY[r])).join(', ');ghost.dataset.level=v.level;
}
function endDrag(e){
 const el=document.elementFromPoint(e.clientX,e.clientY),tile=el&&el.closest('g.machine'),out=el&&el.closest('.puzzle-tray');
 const dropId=tile&&root.contains(tile)?Number(tile.dataset.id):null;   // read before the redraw below replaces the tiles
 // Clear the drag marks first; a drop that changes nothing must not leave the floor dimmed or a target outlined.
 root.classList.remove('puzzle-dragging');ghost.hidden=true;$('puzzleDropOut').classList.remove('over');renderMap();
 if(dropId!==null){
  const targets=dropTargets(dropId);
  if(!targets){toast(t('noRoom'));return;}
  if(drag.kind==='tile'&&targets.every((x,k)=>x===drag.sources[k]))return;
  range=[];
  puzzlePlace(drag.kind==='card'?targets.map(()=>drag.pieces[0]):drag.pieces,targets,drag.kind==='tile'?drag.sources:null);
 }else if(out&&drag.kind==='tile'){range=[];puzzlePlace(drag.sources.map(()=>({model:'',process:''})),drag.sources,null);}
}
tray.addEventListener('pointerdown',e=>{const c=e.target.closest('.puzzle-card');if(!c||e.button!==0)return;e.preventDefault();startDrag('card',e,{pieces:[{model:c.dataset.model,process:c.dataset.process}],sources:null});});
tray.addEventListener('click',e=>{const c=e.target.closest('.puzzle-card');if(!c||wasDrag)return;const piece={model:c.dataset.model,process:c.dataset.process};armed=armed&&keyOf(armed)===keyOf(piece)?null:piece;render();});
const onDragMove=e=>{if(!drag)return;if(!drag.active){if(Math.hypot(e.clientX-drag.x0,e.clientY-drag.y0)<=5)return;activateDrag();}ghost.style.left=(e.clientX+14)+'px';ghost.style.top=(e.clientY+10)+'px';const el=document.elementFromPoint(e.clientX,e.clientY);$('puzzleDropOut').classList.toggle('over',!!(el&&el.closest('.puzzle-tray')&&drag.kind==='tile'));showVerdict(el);};
const onDragEnd=e=>{if(!drag)return;if(drag.active){endDrag(e);wasDrag=true;setTimeout(()=>{wasDrag=false;},0);}drag=null;};
const onDragCancel=()=>{if(!drag)return;root.classList.remove('puzzle-dragging');ghost.hidden=true;drag=null;renderMap();};
const onPuzzleKey=e=>{if(!puzzleOn()||e.target.closest?.('input,select,textarea'))return;if(e.key==='Escape'&&(armed||range.length)){armed=null;range=[];render();}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();$('undo').click();}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();$('redo').click();}};
document.addEventListener('pointermove',onDragMove);document.addEventListener('pointerup',onDragEnd);document.addEventListener('pointercancel',onDragCancel);document.addEventListener('keydown',onPuzzleKey);

// ── Event wiring ─────────────────────────────────────────────────────────────
root.querySelectorAll('[data-building]').forEach(b=>b.onclick=()=>{building=b.dataset.building;render();fit();});
root.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{mode=b.dataset.mode;render();});
$('modelFilter').onchange=()=>renderMap();$('changedOnly').onchange=()=>renderMap();
$('searchForm').onsubmit=e=>{e.preventDefault();const value=$('search').value.trim().replace(/^CNC[- ]?/i,'');if(!/^\d{1,3}$/.test(value)||!machines.has(Number(value))){toast(t('missing'));return;}$('modelFilter').value='';$('changedOnly').checked=false;$('setupFilter').value='';selectMachine(Number(value),true);};
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
stage.addEventListener('pointerdown',e=>{if(e.target.closest('.map-tools'))return;wasDrag=false;
 if(puzzleOn()&&e.pointerType!=='touch'&&e.button===0&&!e.shiftKey){const tile=e.target.closest('g.machine');if(tile){const id=Number(tile.dataset.id),sources=range.length>1&&range.includes(id)?range.slice():[id],pieces=sources.map(x=>assignment(machines.get(x)));if(pieces.some(p=>p.model)&&!sources.some(x=>draft.locks.includes(x))){startDrag('tile',e,{pieces,sources});return;}}}
const p=point(e);pointers.set(e.pointerId,p);if(pointers.size===1){pan={x:p.x,y:p.y,tx,ty,id:e.pointerId};}if(pointers.size===2){const [a,b]=[...pointers.values()];pinch={distance:Math.hypot(a.x-b.x,a.y-b.y),scale,tx,ty,cx:(a.x+b.x)/2,cy:(a.y+b.y)/2};pan=null;}});
stage.addEventListener('pointermove',e=>{if(!pointers.has(e.pointerId))return;const p=point(e);pointers.set(e.pointerId,p);if(pointers.size===2&&pinch){const[a,b]=[...pointers.values()];const cx=(a.x+b.x)/2,cy=(a.y+b.y)/2;scale=Math.max(.08,Math.min(2.5,pinch.scale*Math.hypot(a.x-b.x,a.y-b.y)/Math.max(1,pinch.distance)));tx=cx-(pinch.cx-pinch.tx)*scale/pinch.scale;ty=cy-(pinch.cy-pinch.ty)*scale/pinch.scale;wasDrag=true;transform();}else if(pan){const dx=p.x-pan.x,dy=p.y-pan.y;if(Math.hypot(dx,dy)>4){wasDrag=true;if(!stage.hasPointerCapture(e.pointerId))stage.setPointerCapture(e.pointerId);tx=pan.tx+dx;ty=pan.ty+dy;transform();}}});
function endPointer(e){pointers.delete(e.pointerId);if(stage.hasPointerCapture(e.pointerId))stage.releasePointerCapture(e.pointerId);pinch=null;pan=null;if(pointers.size===1){const [id,p]=[...pointers.entries()][0];pan={id,x:p.x,y:p.y,tx,ty};}setTimeout(()=>{if(!pointers.size)wasDrag=false;},0);}
stage.addEventListener('pointerup',endPointer);stage.addEventListener('pointercancel',endPointer);stage.addEventListener('pointerleave',e=>{if(!stage.hasPointerCapture(e.pointerId))endPointer(e);});
stage.addEventListener('keydown',e=>{if(e.target.closest('button,input,select'))return;if(e.key==='+'||e.key==='='){e.preventDefault();zoom(1.25);}if(e.key==='-'){e.preventDefault();zoom(.8);}const delta={ArrowLeft:[40,0],ArrowRight:[-40,0],ArrowUp:[0,40],ArrowDown:[0,-40]}[e.key];if(delta){e.preventDefault();tx+=delta[0];ty+=delta[1];transform();}});
let previousStageSize={width:stage.clientWidth,height:stage.clientHeight};
const resizeObserver=new ResizeObserver(()=>{const width=stage.clientWidth,height=stage.clientHeight;tx+=(width-previousStageSize.width)/2;ty+=(height-previousStageSize.height)/2;previousStageSize={width,height};transform();});
resizeObserver.observe(stage);
translate();const focusFrame=requestAnimationFrame(()=>focusMachine(selected));

// Read-only hook for the browser verification suite (scripts/verify-layout-studio-browser.cjs).
const hook={data:DATA,hues:()=>[...hueOrder],state:()=>({building,mode,selected,scale,tx,ty,lang,draft:copy(draft),machineCount:DATA.machines.length,setup:copy(setupBatch),range:[...range],armed:armed&&copy(armed),puzzle:puzzleOn(),violations:puzzleViolations.count})};
window.__layoutStudio=hook;

return {
 setLang(next){if(!messages[next]||next===lang)return;lang=next;translate();},
 destroy(){document.removeEventListener('pointermove',onDragMove);document.removeEventListener('pointerup',onDragEnd);document.removeEventListener('pointercancel',onDragCancel);document.removeEventListener('keydown',onPuzzleKey);resizeObserver.disconnect();cancelAnimationFrame(focusFrame);clearTimeout(toastTimer);if(window.__layoutStudio===hook)delete window.__layoutStudio;},
};
}
