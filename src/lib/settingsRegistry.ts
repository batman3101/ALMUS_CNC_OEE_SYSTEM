/**
 * 시스템 설정 계약의 **단일 원장**.
 *
 * ## 왜 이 파일이 따로 있나
 *
 * 설정 키 목록은 지금까지 세 군데에 따로 적혀 있었다 — 탭 컴포넌트의 폼 필드,
 * `systemSettings.ts` 안의 초기화용 하드코딩 레지스트리, 그리고 라이브 DB 의 행. 세 목록은
 * 같이 고쳐지지 않았고, 2026-08-06 감사에서 실제로 갈라진 채 발견됐다:
 *
 * - 초기화 레지스트리는 `d0da963`(2026-07-29) 에서 화면과 서버 양쪽에서 제거된
 *   `shift.shift_a_end` / `shift.shift_b_end` 를 **여전히 들고 있었다.** 초기화를 누르면
 *   서버가 읽지도 않는 키가 되살아난다.
 * - 반대로 같은 변경에서 중요해진 `shift.shift_change_buffer_minutes` 와 알림 탭이 저장하는
 *   `notification.notification_email` 은 **빠져 있었다.** 32개짜리 계약을 30개만 초기화한
 *   것이다. 개수가 우연히 32로 맞아떨어져서 아무도 눈치채지 못했다.
 *
 * 그래서 목록을 하나로 모으고, 그 목록이 곧 계약이 되게 한다. 회귀 검사
 * (`src/lib/__tests__/settingsRegistry.test.ts`)가 32개 키를 **명시적으로 나열해** 대조하므로,
 * 여기서 키를 더하거나 빼면 테스트가 시끄럽게 깨진다.
 *
 * ## 의존성이 없어야 하는 이유
 *
 * React 도 Supabase 도 import 하지 않는다. 브라우저 번들(설정 탭)과 서버 라우트
 * (`/api/system-settings/update`)가 **같은 원장**을 봐야 하는데, 한쪽이라도 서버 전용 모듈에
 * 걸리면 다시 두 벌로 갈라진다. 이 프로젝트는 이미 그 사고를 겪었다 —
 * `DEFAULT_SHIFT_CHANGE_BUFFER_MINUTES` 가 서버 전용 모듈에 갇혀 있어서 설정 화면이 자기
 * 숫자(15분)를 따로 적었고, 전환 유예가 화면 15분 / 서버 10분으로 갈라진 채 운영됐다
 * (적대적 재감사 #9, `shiftDefaults.ts` 참조).
 *
 * ## 왜 API 가 키를 검증해야 하나
 *
 * `update_system_setting` RPC 는 키가 없으면 **행을 새로 INSERT 한다**
 * (`supabase/migrations/20260714040000_role_based_rls.sql`). 즉 오타 한 번, 옛 코드 경로 한 번이
 * 영구 레거시 행이 된다. 라이브 DB 에 현행 계약 밖 활성 키가 11개 쌓인 경로가 정확히 이것이다
 * (`display.theme`, `oee.quality_target`, `ui.language`, ...). 저장 API 는 카테고리·키가 빈
 * 문자열인지만 봤고, 자료형도 범위도 보지 않았다.
 */

import type { SettingCategory, SettingValueType } from '@/types/systemSettings';
import { TOTAL_BREAK_MINUTES } from '@/utils/shiftBreaks';
import { DEFAULT_SHIFT_CHANGE_BUFFER_MINUTES } from './shiftDefaults';

/** select 형 설정이 허용하는 값과 화면 라벨. */
export interface SettingOption {
  readonly label: string;
  readonly value: string;
}

/** 숫자 범위와 필수 여부. `SettingValidationRule` 중 이 원장이 실제로 강제하는 부분만 쓴다. */
export interface SettingRange {
  readonly required?: boolean;
  readonly min?: number;
  readonly max?: number;
}

/**
 * 계약에 든 설정 하나. 현행 32개는 전부 원시값이라 `defaultValue` 를 원시 타입으로 좁힌다 —
 * `unknown` 이면 초기화가 무엇을 쓰는지 타입으로 확인할 수 없다.
 */
export interface SettingEntry {
  readonly category: SettingCategory;
  readonly key: string;
  readonly valueType: SettingValueType;
  readonly defaultValue: string | number | boolean;
  readonly description: string;
  readonly isSystem: boolean;
  readonly validation?: SettingRange;
  readonly options?: readonly SettingOption[];
}

/**
 * 현행 설정 계약 32개. 순서는 설정 화면의 탭 순서(일반·OEE·교대·알림·화면)를 따른다.
 *
 * ⚠️ 기본값에 리터럴을 새로 적기 전에 **그 숫자의 원천이 코드 어딘가에 이미 있는지** 본다.
 *    아래 두 개는 원천에서 가져온다 — 리터럴로 적는 순간 조용히 갈라지기 때문이다.
 */
export const SETTINGS_REGISTRY: readonly SettingEntry[] = [
  // ── 일반 (6) ────────────────────────────────────────────────────────────────
  {
    category: 'general',
    key: 'company_name',
    valueType: 'string',
    defaultValue: 'ALMUS TECH',
    description: '회사명',
    isSystem: true,
    validation: { required: true },
  },
  {
    category: 'general',
    key: 'company_logo_url',
    valueType: 'string',
    defaultValue: '',
    description: '회사 로고 URL',
    isSystem: false,
  },
  {
    category: 'general',
    key: 'timezone',
    valueType: 'string',
    defaultValue: 'Asia/Ho_Chi_Minh',
    description: '시간대 설정',
    isSystem: true,
    options: [
      { label: '서울 (Asia/Seoul)', value: 'Asia/Seoul' },
      { label: '호치민 (Asia/Ho_Chi_Minh)', value: 'Asia/Ho_Chi_Minh' },
      { label: 'UTC', value: 'UTC' },
    ],
  },
  {
    category: 'general',
    key: 'date_format',
    valueType: 'string',
    defaultValue: 'DD/MM/YYYY',
    description: '날짜 형식',
    isSystem: true,
    options: [
      { label: 'DD/MM/YYYY', value: 'DD/MM/YYYY' },
      { label: 'MM/DD/YYYY', value: 'MM/DD/YYYY' },
      { label: 'YYYY-MM-DD', value: 'YYYY-MM-DD' },
      { label: 'YYYY/MM/DD', value: 'YYYY/MM/DD' },
    ],
  },
  {
    category: 'general',
    key: 'time_format',
    valueType: 'string',
    defaultValue: 'HH:mm:ss',
    description: '시간 형식',
    isSystem: true,
    options: [
      { label: '24시간 (HH:mm:ss)', value: 'HH:mm:ss' },
      { label: '24시간 (HH:mm)', value: 'HH:mm' },
      { label: '12시간 (hh:mm:ss A)', value: 'hh:mm:ss A' },
      { label: '12시간 (hh:mm A)', value: 'hh:mm A' },
    ],
  },
  {
    // DB 의 canonical key 는 `default_language` 다. 코드 타입 계약
    // (`AllSystemSettings.general.language`) 과는 `mapDbKeyToCodeKey()` 로 별칭 처리된다.
    // 원장은 **DB 키**를 기준으로 한다 — 저장 API 가 받는 것이 DB 키이기 때문이다.
    // (설정 화면도 저장 직전에 language → default_language 로 바꿔서 보낸다.)
    category: 'general',
    key: 'default_language',
    valueType: 'string',
    defaultValue: 'ko',
    description: '기본 언어',
    isSystem: true,
    options: [
      { label: '한국어', value: 'ko' },
      { label: 'Tiếng Việt', value: 'vi' },
    ],
  },

  // ── OEE (10) ────────────────────────────────────────────────────────────────
  //
  // 목표 4개(target_*)는 알림의 **경고선**이고, 위험선은 지표마다 따로 있다.
  // "목표 미달"과 "위험"은 다른 사건이라 하나의 숫자로 겸할 수 없다.
  //
  // OEE 는 목표·저하·위험 세 값으로 등급 사다리를 만들지만(`src/lib/oeeGrading.ts`),
  // 가동률·성능·품질에는 위험선 설정이 **없었다.** 그래서 알림 API 가 자기 숫자를
  // 하드코딩했고, 관리자가 목표를 바꿔도 알림은 그대로였다(감사 2026-08-06 HIGH-02/03).
  //
  // ⚠️ 위험선을 목표에서 비율로 유추하지 않는다. OEE 의 위험/목표 비(0.6/0.85 ≈ 0.71)를
  //    품질에 적용하면 위험선이 75.7% 가 되는데, 현장에서 품질 75% 를 그제야 위험이라
  //    부르면 이미 늦다. 아래 세 기본값은 유추가 아니라 **하드코딩돼 있던 현장 검증값**
  //    (ALERT_THRESHOLDS: availability 70 / performance 70 / quality 90)을 그대로 옮긴 것이다.
  {
    category: 'oee',
    key: 'target_oee',
    valueType: 'number',
    defaultValue: 0.85,
    description: 'OEE 목표값',
    isSystem: true,
    validation: { required: true, min: 0, max: 1 },
  },
  {
    category: 'oee',
    key: 'target_availability',
    valueType: 'number',
    defaultValue: 0.9,
    description: '가동률 목표값',
    isSystem: true,
    validation: { required: true, min: 0, max: 1 },
  },
  {
    category: 'oee',
    key: 'target_performance',
    valueType: 'number',
    defaultValue: 0.95,
    // 성능만 상한이 2 다. 실적이 tact 기준보다 빠르면 performance 는 1 을 넘고, 그런 설비의
    // 목표를 100% 로만 적게 하면 목표를 표현할 수 없다. 설정 화면의 입력도 0~2 를 허용하므로
    // 여기서 1 로 조이면 **화면이 허용한 저장이 API 에서 400 으로 막힌다.**
    description: '성능 목표값',
    isSystem: true,
    validation: { required: true, min: 0, max: 2 },
  },
  {
    category: 'oee',
    key: 'target_quality',
    valueType: 'number',
    defaultValue: 0.99,
    description: '품질 목표값',
    isSystem: true,
    validation: { required: true, min: 0, max: 1 },
  },
  {
    category: 'oee',
    key: 'low_oee_threshold',
    valueType: 'number',
    defaultValue: 0.6,
    description: 'OEE 저하 임계값',
    isSystem: true,
    validation: { required: true, min: 0, max: 1 },
  },
  {
    category: 'oee',
    key: 'critical_oee_threshold',
    valueType: 'number',
    defaultValue: 0.4,
    description: 'OEE 위험 임계값',
    isSystem: true,
    validation: { required: true, min: 0, max: 1 },
  },
  {
    category: 'oee',
    key: 'critical_availability_threshold',
    valueType: 'number',
    defaultValue: 0.7,
    description: '가동률 위험 임계값',
    isSystem: true,
    validation: { required: true, min: 0, max: 1 },
  },
  {
    category: 'oee',
    key: 'critical_performance_threshold',
    valueType: 'number',
    // 목표(target_performance)는 상한이 2 지만 위험선은 1 이 상한이다. 위험선은 **바닥**이고,
    // "100% 보다 빠른데 위험" 은 표현할 이유가 없는 상태다.
    defaultValue: 0.7,
    description: '성능 위험 임계값',
    isSystem: true,
    validation: { required: true, min: 0, max: 1 },
  },
  {
    category: 'oee',
    key: 'critical_quality_threshold',
    valueType: 'number',
    defaultValue: 0.9,
    description: '품질 위험 임계값',
    isSystem: true,
    validation: { required: true, min: 0, max: 1 },
  },
  {
    category: 'oee',
    key: 'downtime_alert_minutes',
    valueType: 'number',
    // 이 값이 알림의 **경고선**(분)이고 위험선은 그 2배다. 2배라는 관계는 하드코딩돼 있던
    // 경고 60분 / 위험 120분 에서 그대로 가져왔다 — 연결하면서 두 값의 비율까지 바꾸면
    // 알림 양이 왜 달라졌는지 나중에 추적할 수 없다.
    defaultValue: 30,
    description: '다운타임 알림 기준 (분)',
    isSystem: true,
    validation: { required: true, min: 1, max: 480 },
  },

  // ── 교대 (4) ────────────────────────────────────────────────────────────────
  //
  // `shift_a_end` / `shift_b_end` 는 여기 **없다.** 서버는 교대 창을
  // `A = [A시작, B시작)`, `B = [B시작, 다음날 A시작)` 으로 만들고 저장된 종료 시각을 읽지
  // 않는다(`buildShiftWindows`). 초기화가 그 두 키를 되살리면, 서버가 무시하는 값이 관리자가
  // 설정한 것처럼 DB 에 남는다.
  {
    category: 'shift',
    key: 'shift_a_start',
    valueType: 'time',
    defaultValue: '08:00',
    description: 'A교대 시작 시간',
    isSystem: true,
    validation: { required: true },
  },
  {
    category: 'shift',
    key: 'shift_b_start',
    valueType: 'time',
    defaultValue: '20:00',
    description: 'B교대 시작 시간',
    isSystem: true,
    validation: { required: true },
  },
  {
    category: 'shift',
    key: 'break_time_minutes',
    valueType: 'number',
    // ⚠️ 리터럴 60 이었다. 운영값은 110 이고 실시간 휴식 스케줄도 합계 110분 고정인데,
    //    "모든 설정 초기화"가 이 60 을 써 넣으면 `/api/production-progress` 가
    //    `break_config_matches: false` 로 **안전 중단**한다 — 설비 콘솔의 실시간 지표가
    //    전 설비에서 사라진다. 정상 기능처럼 보이는 버튼 하나가 운영 장애를 만드는 것이다
    //    (2026-08-06 감사 HIGH-01).
    //
    //    그래서 숫자를 다시 적지 않고 실시간 계산이 쓰는 바로 그 상수를 가져온다. 두 값이
    //    갈라지려면 이제 `shiftBreaks.ts` 를 고치는 수밖에 없고, 그러면 양쪽이 같이 움직인다.
    defaultValue: TOTAL_BREAK_MINUTES,
    description: '교대별 휴식 시간 (분)',
    isSystem: true,
    // 범위는 설정 화면의 입력 범위(0~240)와 같게 둔다. 실시간 계산이 지원하는 값은 사실상
    // TOTAL_BREAK_MINUTES 하나뿐이지만, 그 제약을 여기서 강제하면 계획가동시간만 쓰는
    // 저장까지 막힌다 — 지원 범위 표시는 화면의 몫이다(감사 HIGH-04).
    validation: { required: true, min: 0, max: 240 },
  },
  {
    category: 'shift',
    key: 'shift_change_buffer_minutes',
    valueType: 'number',
    // 화면과 서버가 같은 상수를 봐야 한다(적대적 재감사 #9). 여기서 10 을 다시 적으면
    // `shiftDefaults.ts` 와 갈라질 수 있는 세 번째 자리가 생긴다.
    defaultValue: DEFAULT_SHIFT_CHANGE_BUFFER_MINUTES,
    description: '교대 전환 유예 (분)',
    isSystem: true,
    validation: { required: true, min: 0, max: 60 },
  },

  // ── 알림 (5) ────────────────────────────────────────────────────────────────
  {
    category: 'notification',
    key: 'email_notifications_enabled',
    valueType: 'boolean',
    defaultValue: true,
    description: '이메일 알림 활성화',
    isSystem: false,
  },
  {
    category: 'notification',
    key: 'browser_notifications_enabled',
    valueType: 'boolean',
    defaultValue: true,
    description: '브라우저 알림 활성화',
    isSystem: false,
  },
  {
    category: 'notification',
    key: 'sound_notifications_enabled',
    valueType: 'boolean',
    defaultValue: true,
    description: '소리 알림 활성화',
    isSystem: false,
  },
  {
    // 알림 탭이 저장하는 키인데 초기화 레지스트리에는 없었다. 기본값은 빈 문자열이다 —
    // 초기화가 임의의 주소를 만들어 내면 그 주소로 보낼 수 없는 알림을 보낼 수 있는 것처럼
    // 보이게 된다. 주소 형식 검증은 화면이 한다(발송 경로가 생기면 여기로 옮긴다).
    category: 'notification',
    key: 'notification_email',
    valueType: 'string',
    defaultValue: '',
    description: '알림 수신 이메일',
    isSystem: false,
  },
  {
    category: 'notification',
    key: 'alert_check_interval_seconds',
    valueType: 'number',
    defaultValue: 60,
    description: '알림 확인 간격 (초)',
    isSystem: true,
    validation: { required: true, min: 10, max: 300 },
  },

  // ── 화면 (10) ───────────────────────────────────────────────────────────────
  {
    category: 'display',
    key: 'theme_mode',
    valueType: 'string',
    defaultValue: 'light',
    description: '테마 모드',
    isSystem: false,
    options: [
      { label: '라이트 모드', value: 'light' },
      { label: '다크 모드', value: 'dark' },
    ],
  },
  {
    category: 'display',
    key: 'theme_primary_color',
    valueType: 'color',
    defaultValue: '#1890ff',
    description: '주요 테마 색상',
    isSystem: false,
  },
  {
    category: 'display',
    key: 'theme_success_color',
    valueType: 'color',
    defaultValue: '#52c41a',
    description: '성공 색상',
    isSystem: false,
  },
  {
    category: 'display',
    key: 'theme_warning_color',
    valueType: 'color',
    defaultValue: '#faad14',
    description: '경고 색상',
    isSystem: false,
  },
  {
    category: 'display',
    key: 'theme_error_color',
    valueType: 'color',
    defaultValue: '#ff4d4f',
    description: '오류 색상',
    isSystem: false,
  },
  {
    category: 'display',
    key: 'dashboard_refresh_interval_seconds',
    valueType: 'number',
    defaultValue: 30,
    description: '대시보드 새로고침 간격 (초)',
    isSystem: true,
    validation: { required: true, min: 5, max: 300 },
  },
  {
    category: 'display',
    key: 'chart_animation_enabled',
    valueType: 'boolean',
    defaultValue: true,
    description: '차트 애니메이션 활성화',
    isSystem: false,
  },
  {
    category: 'display',
    key: 'compact_mode',
    valueType: 'boolean',
    defaultValue: false,
    description: '컴팩트 모드',
    isSystem: false,
  },
  {
    category: 'display',
    key: 'show_machine_images',
    valueType: 'boolean',
    defaultValue: true,
    description: '설비 이미지 표시',
    isSystem: false,
  },
  {
    category: 'display',
    key: 'sidebar_collapsed',
    valueType: 'boolean',
    defaultValue: false,
    description: '사이드바 접힘 상태',
    isSystem: false,
  },
];

/** `category.key` 한 줄 표기. 로그·오류 메시지·테스트가 전부 이 표기를 쓴다. */
export function settingContractId(category: string, key: string): string {
  return `${category}.${key}`;
}

const REGISTRY_BY_ID: ReadonlyMap<string, SettingEntry> = new Map(
  SETTINGS_REGISTRY.map(entry => [settingContractId(entry.category, entry.key), entry]),
);

/** 계약 키 전체 (`category.key`). 테스트가 이 목록을 명시적 기대치와 대조한다. */
export const SETTINGS_CONTRACT_IDS: readonly string[] = Array.from(REGISTRY_BY_ID.keys());

/**
 * 원장에서 설정 정의를 찾는다. 인자가 `SettingCategory` 가 아니라 `string` 인 것은 의도적이다 —
 * 호출자 중 하나가 **신뢰할 수 없는 요청 본문**을 그대로 넘기는 저장 API 이기 때문이다.
 */
export function findSettingEntry(category: string, key: string): SettingEntry | undefined {
  return REGISTRY_BY_ID.get(settingContractId(category, key));
}

/** 현행 계약에 속한 키인가. 레거시/오타 키를 거르는 술어다. */
export function isContractKey(category: string, key: string): boolean {
  return REGISTRY_BY_ID.has(settingContractId(category, key));
}

/** 카테고리에 속한 계약 설정들. */
export function settingsForCategory(category: SettingCategory): readonly SettingEntry[] {
  return SETTINGS_REGISTRY.filter(entry => entry.category === category);
}

/**
 * 검증 결과. 성공하면 **해석된 값**을 함께 돌려준다 — 전선 위에서는 숫자도 불리언도 문자열이라
 * (`String(setting_value)`), 검증한 값과 저장한 값이 다른 것이었는지 호출자가 확인할 수 있어야
 * 한다.
 */
export type SettingValidation =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: string };

/** 오류 메시지에 값을 실을 때 쓰는 짧은 표기. 긴 값이 로그를 덮지 않게 자른다. */
function preview(value: unknown): string {
  const text = typeof value === 'string' ? value : String(JSON.stringify(value));
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

const TIME_PATTERN = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
const COLOR_PATTERN = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;

/**
 * 전선 위의 표현을 선언된 자료형으로 해석한다.
 *
 * 저장 경로는 값을 텍스트로 보낸다 — 클라이언트가 `JSON.stringify` 하고 라우트가 다시
 * `String()` 을 씌운 뒤 RPC 가 스스로 종류를 판별한다. 그래서 `number` 설정이 `"110"` 으로,
 * `boolean` 설정이 `"true"` 로 도착한다. 여기서 해석하지 않으면 **모든 저장이 자료형 오류로
 * 거부되거나**, 반대로 자료형 검사를 포기하게 된다.
 */
function interpret(raw: unknown, valueType: SettingValueType): { ok: true; value: unknown } | { ok: false } {
  switch (valueType) {
    case 'number': {
      if (typeof raw === 'number') return Number.isFinite(raw) ? { ok: true, value: raw } : { ok: false };
      if (typeof raw === 'string' && raw.trim() !== '') {
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? { ok: true, value: parsed } : { ok: false };
      }
      return { ok: false };
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return { ok: true, value: raw };
      if (raw === 'true') return { ok: true, value: true };
      if (raw === 'false') return { ok: true, value: false };
      return { ok: false };
    }
    case 'time':
      return typeof raw === 'string' && TIME_PATTERN.test(raw) ? { ok: true, value: raw } : { ok: false };
    case 'color':
      return typeof raw === 'string' && COLOR_PATTERN.test(raw) ? { ok: true, value: raw } : { ok: false };
    case 'json':
      // json 설정은 아직 계약에 없다. 생기면 그때 파싱 규칙을 정한다 — 지금 아무 값이나
      // 통과시키는 규칙을 미리 적어 두면, 나중에 그 규칙이 검토 없이 굳는다.
      return { ok: true, value: raw };
    case 'string':
    default:
      return typeof raw === 'string' ? { ok: true, value: raw } : { ok: false };
  }
}

/** 사람이 읽을 자료형 이름. 오류 메시지가 "무엇을 기대했는지"를 말해야 고칠 수 있다. */
const TYPE_LABEL: Record<SettingValueType, string> = {
  string: '문자열',
  number: '숫자',
  boolean: '참/거짓',
  json: 'JSON',
  color: '색상(#RRGGBB)',
  time: '시각(HH:mm)',
};

/**
 * 키·자료형·범위·선택지를 한 번에 검증한다.
 *
 * 실패 메시지는 **어느 키가 왜 거부됐는지**를 담는다. "설정 업데이트 실패" 같은 메시지는
 * 관리자에게 아무것도 알려주지 않고, 무엇보다 잘못된 키를 계속 보내게 만든다.
 */
export function validateSettingValue(category: string, key: string, raw: unknown): SettingValidation {
  const entry = findSettingEntry(category, key);
  if (!entry) {
    return {
      ok: false,
      error: `현행 설정 계약에 없는 키입니다: ${settingContractId(category, key)}`,
    };
  }

  if (raw === null || raw === undefined) {
    return { ok: false, error: `${settingContractId(category, key)} 값이 비어 있습니다.` };
  }

  const interpreted = interpret(raw, entry.valueType);
  if (!interpreted.ok) {
    return {
      ok: false,
      error:
        `${settingContractId(category, key)} 는 ${TYPE_LABEL[entry.valueType]} 이어야 합니다 ` +
        `(받은 값: ${preview(raw)})`,
    };
  }

  const value = interpreted.value;

  if (entry.validation?.required && typeof value === 'string' && value.trim() === '') {
    return { ok: false, error: `${settingContractId(category, key)} 는 비워 둘 수 없습니다.` };
  }

  if (typeof value === 'number') {
    const { min, max } = entry.validation ?? {};
    if (min !== undefined && value < min) {
      return {
        ok: false,
        error: `${settingContractId(category, key)} 는 ${min} 이상이어야 합니다 (받은 값: ${value})`,
      };
    }
    if (max !== undefined && value > max) {
      return {
        ok: false,
        error: `${settingContractId(category, key)} 는 ${max} 이하여야 합니다 (받은 값: ${value})`,
      };
    }
  }

  if (entry.options && !entry.options.some(option => option.value === value)) {
    return {
      ok: false,
      error:
        `${settingContractId(category, key)} 는 다음 중 하나여야 합니다: ` +
        `${entry.options.map(option => option.value).join(', ')} (받은 값: ${preview(raw)})`,
    };
  }

  return { ok: true, value };
}
