#!/usr/bin/env node
/**
 * 설정 시나리오 적용기 — "이 설정이 진짜 화면을 바꾸는가" 를 브라우저에서 확인하기 위한 도구.
 *
 *   npm run settings:scenario -- list
 *   npm run settings:scenario -- apply <이름>
 *   npm run settings:scenario -- apply <이름> --dry-run
 *
 * ## 왜 필요한가
 *
 * 2026-08-06 감사가 찾은 결함의 대부분은 **저장은 성공하는데 아무 일도 일어나지 않는** 것이었다.
 * 단위 테스트는 그걸 못 잡는다 — 저장 경로만 보기 때문이다. 유일하게 확실한 확인은 값을 바꿔
 * 놓고 실제 화면을 보는 것인데, 이 앱의 `system_settings` 는 개발용 사본이 아니라 **운영 DB 의
 * 전역 행**이다. 그래서 매번 손으로 값을 바꾸면 "원래 뭐였더라" 가 남는다.
 *
 * 이 스크립트는 그 확인을 **재현 가능한 시나리오**로 만든다. 안전망은 `settings-snapshot.mjs`
 * 가 담당한다. 반드시 이 순서로 쓴다:
 *
 *   npm run settings:snapshot          # ① 지금 상태를 파일로 박제
 *   npm run settings:scenario -- apply oee-grading
 *   (브라우저에서 확인)
 *   npm run settings:restore           # ② 되돌리고 자체 검증까지
 *   npm run settings:diff              # ③ 0 인지 확인
 *
 * ## 시나리오 값을 고른 기준
 *
 * "바뀌었는지 눈으로 구분되는가" 하나다. 현재값과 비슷한 값으로 바꾸면 화면이 바뀌어도
 * 바뀐 줄 모른다 — 그건 검증이 아니라 검증한 기분이다. 그래서 등급이 **한 칸 이상 이동**하는
 * 값을 쓴다.
 */

import { createClient } from '@supabase/supabase-js';

try {
  process.loadEnvFile('.env.local');
} catch {
  // CI 등 파일이 없는 환경에서는 이미 주입된 process.env 를 쓴다.
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

function die(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

if (!URL || !SERVICE) {
  die('NEXT_PUBLIC_SUPABASE_URL 과 SUPABASE_SERVICE_ROLE_KEY 가 필요합니다 (.env.local).');
}

const db = createClient(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/**
 * 각 시나리오는 "무엇을 눈으로 확인할 것인가" 를 함께 적는다.
 * 값만 있고 기대가 없으면, 화면을 보고도 뭘 봤는지 말할 수 없다.
 */
const SCENARIOS = {
  'oee-grading': {
    summary: 'OEE 등급 사다리를 위로 밀어 대시보드 색이 바뀌는지 본다',
    expect: [
      '설비 현황·대시보드의 OEE 셀 색이 초록 → 주황/빨강으로 내려간다',
      'OEE 게이지의 등급 문구도 같이 바뀐다 (게이지와 표가 같은 등급을 말해야 한다)',
      '엔지니어 대시보드의 OEE 등급 필터 결과도 같이 움직인다',
    ],
    values: {
      // 목표를 0.95 로 올리면 지금 '우수'(≥0.85)이던 설비 대부분이 한 단계 내려온다.
      'oee.target_oee': 0.95,
      'oee.low_oee_threshold': 0.9,
      'oee.critical_oee_threshold': 0.85,
    },
  },

  'alerts-threshold': {
    // 신규 키 3개는 20260806040000 마이그레이션이 만든다. 미적용이면 행이 없어 여기서 멈춘다 —
    // 그게 맞다. 행이 없는데 "적용했다" 고 말하면 기본값으로 돈 결과를 설정 반영으로 오독한다.
    requiresMigration: '20260806040000_add_alert_critical_thresholds',
    summary: '알림 임계값을 올려 경고·위험 건수가 늘어나는지 본다',
    expect: [
      '관리자 대시보드의 알림 개수가 늘어난다',
      '/api/alerts 응답의 thresholds 가 바뀐 값으로 나온다',
      'metadata.threshold_fallbacks 는 비어 있어야 한다 (비어 있지 않으면 설정이 아니라 기본값으로 돈 것)',
    ],
    values: {
      'oee.target_availability': 0.99,
      'oee.target_performance': 0.99,
      'oee.target_quality': 0.999,
      'oee.critical_availability_threshold': 0.95,
      'oee.critical_performance_threshold': 0.95,
      'oee.critical_quality_threshold': 0.99,
    },
  },

  'alerts-out-of-order': {
    requiresMigration: '20260806040000_add_alert_critical_thresholds',
    summary: '위험선을 경고선보다 높게 넣어, 앱이 조용히 뭉개지 않고 물러나는지 본다',
    expect: [
      '/api/alerts 응답의 metadata.threshold_fallbacks 에 quality:out_of_order 가 나온다',
      '그 지표만 기본값으로 판정되고 나머지 지표는 설정값을 그대로 쓴다',
      '설정 화면에서 같은 값을 저장하려 하면 저장 전에 거부된다 (서버와 화면이 같은 규칙)',
    ],
    values: {
      // 위험(0.995) > 목표(0.99). 그대로 두면 99.5% 미만이 전부 '위험' 이 되고 경고 가지가 죽는다.
      'oee.critical_quality_threshold': 0.995,
    },
  },

  'alert-polling': {
    summary: '알림 확인 간격을 짧게 해 폴링 주기가 실제로 따라가는지 본다',
    expect: [
      '개발자 도구 Network 에서 /api/alerts 호출 간격이 15초로 좁혀진다',
      '설정을 다시 바꾸면 기존 타이머가 사라지고 새 주기로 재무장된다 (호출이 두 배로 늘면 타이머가 샌 것)',
    ],
    values: {
      'notification.alert_check_interval_seconds': 15,
    },
  },

  'display-sidebar': {
    summary: '사이드바 접힘 기본값이 데스크톱 초기 상태에 반영되는지 본다',
    expect: [
      '새로고침하면 데스크톱에서도 사이드바가 접힌 채로 시작한다',
      '접힘 상태에서도 토글 버튼이 보인다 (안 보이면 펼 방법이 없는 일방통행이다)',
      '한 번 펼치면 그 뒤로는 설정이 그 선택을 덮지 않는다',
    ],
    values: {
      'display.sidebar_collapsed': true,
    },
  },
};

function printScenarios() {
  console.log('사용 가능한 시나리오:\n');
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    console.log(`  ${name}`);
    console.log(`      ${scenario.summary}`);
    for (const [key, value] of Object.entries(scenario.values)) {
      console.log(`        ${key} = ${JSON.stringify(value)}`);
    }
    console.log('');
  }
  console.log('먼저 `npm run settings:snapshot`, 확인 뒤 `npm run settings:restore` 를 실행하세요.');
}

async function apply(name, { dryRun }) {
  const scenario = SCENARIOS[name];
  if (!scenario) {
    die(`알 수 없는 시나리오: ${name}\n사용 가능: ${Object.keys(SCENARIOS).join(', ')}`);
  }

  console.log(`시나리오: ${name}`);
  console.log(`  ${scenario.summary}\n`);

  const entries = Object.entries(scenario.values);
  const changes = [];

  for (const [qualified, nextValue] of entries) {
    const [category, ...rest] = qualified.split('.');
    const settingKey = rest.join('.');

    const { data, error } = await db
      .from('system_settings')
      .select('id, setting_value')
      .eq('category', category)
      .eq('setting_key', settingKey)
      .maybeSingle();

    if (error) die(`${qualified} 조회 실패: ${error.message}`);
    if (!data) {
      // 행이 없다는 것은 마이그레이션 미적용이거나 키 오타다. 둘은 다른 사건이므로
      // "없으니 만들자" 로 넘어가지 않는다 — 오타를 새 행으로 굳히면 레거시가 또 쌓인다.
      const hint = scenario.requiresMigration
        ? [
            '',
            `   이 시나리오는 마이그레이션 ${scenario.requiresMigration} 적용을 전제합니다.`,
            '   적용 전에는 앱이 레지스트리 기본값으로 돌고, /api/alerts 응답의',
            '   metadata.threshold_fallbacks 에 "<지표>:missing" 이 실려 나옵니다 — 그 경로를 확인하세요.',
          ].join('\n')
        : '';
      die(`${qualified} 행이 없습니다.${hint}`);
    }

    const current = data.setting_value?.value;
    changes.push({ qualified, id: data.id, from: current, to: nextValue });
  }

  for (const change of changes) {
    console.log(`  ~ ${change.qualified}: ${JSON.stringify(change.from)} → ${JSON.stringify(change.to)}`);
  }

  if (dryRun) {
    console.log('\n(--dry-run: 아무것도 쓰지 않았습니다)');
    return;
  }

  for (const change of changes) {
    const { error } = await db
      .from('system_settings')
      .update({ setting_value: { value: change.to } })
      .eq('id', change.id);
    if (error) {
      // 부분 적용을 성공처럼 보고하지 않는다. 어디까지 갔는지 말해야 되돌릴 수 있다.
      console.error(`❌ ${change.qualified} 적용 실패: ${error.message}`);
      console.error('   일부만 적용된 상태입니다. `npm run settings:restore` 로 되돌리세요.');
      process.exitCode = 1;
      return;
    }
  }

  console.log(`\n✅ ${changes.length}건 적용했습니다.\n`);
  console.log('브라우저에서 확인할 것:');
  for (const line of scenario.expect) console.log(`  - ${line}`);
  console.log('\n확인이 끝나면 반드시: npm run settings:restore');
}

const command = process.argv[2];
const name = process.argv[3];
const dryRun = process.argv.includes('--dry-run');

switch (command) {
  case 'list':
    printScenarios();
    break;
  case 'apply':
    if (!name) die('시나리오 이름이 필요합니다. `npm run settings:scenario -- list` 로 확인하세요.');
    await apply(name, { dryRun });
    break;
  default:
    die(`알 수 없는 명령: ${command ?? '(없음)'}\n사용법: settings-scenario.mjs <list|apply> [이름] [--dry-run]`);
}
