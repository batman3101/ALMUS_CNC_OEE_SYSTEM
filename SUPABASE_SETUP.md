# Supabase 설정 가이드

CNC OEE 모니터링 시스템의 Supabase 데이터베이스 설정 방법입니다.

## 📋 필요한 파일

- `supabase-setup.sql` - 메인 데이터베이스 스키마 및 보안 정책
- `supabase-post-setup.sql` - 샘플 데이터 및 초기 설정

## 🚀 설정 단계

### 1단계: 메인 스키마 설정

1. **Supabase 대시보드** → **SQL Editor**로 이동
2. `supabase-setup.sql` 파일의 내용을 복사하여 붙여넣기
3. **Run** 버튼 클릭하여 실행

이 단계에서 다음이 생성됩니다:
- 모든 테이블 (user_profiles, machines, machine_logs, production_records, audit_log)
- RLS 정책 (역할별 접근 제어)
- 인덱스 (성능 최적화)
- 트리거 및 함수 (자동화)
- 뷰 (데이터 조회 편의성)

### 2단계: 관리자 계정 생성

1. **Supabase 대시보드** → **Authentication** → **Users**로 이동
2. **Add user** 버튼 클릭
3. 관리자 이메일과 비밀번호 입력
4. 생성된 사용자의 **User UID** 복사

### 3단계: 초기 데이터 설정

1. `supabase-post-setup.sql` 파일 열기
2. 주석 처리된 부분에서 `your-admin-user-id-here`를 실제 User UID로 변경
3. 필요한 사용자 계정 정보 수정
4. **SQL Editor**에서 수정된 내용 실행

## 📊 생성되는 테이블 구조

### user_profiles
- 사용자 프로필 및 역할 관리
- 역할: admin, engineer, operator
- 담당 설비 배정 기능

### machines
- 설비 마스터 데이터
- 위치, 모델, Tact Time 정보

### machine_logs
- 설비 상태 로그
- 7가지 상태 지원
- 시간 중복 방지

### production_records
- 생산 실적 데이터
- OEE 지표 계산
- 교대별 관리

### audit_log
- 감사 로그
- 중요 변경사항 추적

## 🔒 보안 정책 (RLS)

### 관리자 (admin)
- 모든 데이터 접근 및 관리
- 사용자 계정 생성/수정/삭제
- 설비 마스터 데이터 관리

### 엔지니어 (engineer)
- 모든 설비 데이터 조회
- 설비 정보 수정
- 모든 생산 실적 분석

### 운영자 (operator)
- 담당 설비만 접근
- 본인 입력 데이터만 수정
- 본인 프로필 조회/수정

## 🔧 유틸리티 함수

### get_machine_current_state(machine_id)
설비의 현재 상태 조회

### calculate_oee(machine_id, date, shift)
OEE 지표 실시간 계산

## 📈 뷰

### machine_current_status
모든 설비의 현재 상태 요약

### daily_oee_summary
일일 OEE 요약 데이터

## ⚠️ 주의사항

1. **확장 설치**: `uuid-ossp`와 `btree_gist` 확장이 자동으로 설치됩니다
2. **시간 중복 방지**: 같은 설비의 로그 시간이 겹치지 않도록 제약조건이 설정됩니다
3. **자동 트리거**: 데이터 수정 시간, 운영자 ID 등이 자동으로 설정됩니다

## 🔍 설정 확인

설정이 완료되면 다음 쿼리로 확인할 수 있습니다:

```sql
-- 테이블 확인
SELECT tablename FROM pg_tables WHERE schemaname = 'public';

-- RLS 정책 확인
SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public';

-- 함수 확인
SELECT routine_name FROM information_schema.routines WHERE routine_schema = 'public';
```

## 🆘 문제 해결

### GIST 인덱스 에러
만약 GIST 관련 에러가 발생하면 PostgreSQL 확장이 제대로 설치되지 않은 것입니다. Supabase에서는 자동으로 처리되므로 일반적으로 문제없이 실행됩니다.

### RLS 정책 에러
사용자 프로필이 없는 상태에서 다른 테이블에 접근하려고 하면 에러가 발생할 수 있습니다. 먼저 관리자 계정의 프로필을 생성해야 합니다.

## 📞 지원

설정 중 문제가 발생하면 다음을 확인해주세요:
1. Supabase 프로젝트가 활성화되어 있는지
2. SQL 실행 권한이 있는지
3. 환경변수가 올바르게 설정되어 있는지