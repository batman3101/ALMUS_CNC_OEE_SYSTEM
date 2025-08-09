# 생산 실적 입력 시스템

CNC OEE 모니터링 시스템의 생산 실적 입력 기능을 제공하는 컴포넌트들입니다.

## 주요 컴포넌트

### 1. ProductionRecordInput
생산 수량과 불량 수량을 입력하는 모달 컴포넌트입니다.

**주요 기능:**
- 생산 수량, 불량 수량 입력
- Zod를 사용한 데이터 유효성 검증
- Tact Time 기반 추정 생산량 제공
- 불량 수량이 생산 수량을 초과하지 않도록 검증

**사용 예시:**
```tsx
<ProductionRecordInput
  visible={showModal}
  onClose={() => setShowModal(false)}
  machine={selectedMachine}
  shift="A"
  date="2024-01-01"
  onSubmit={handleSubmit}
  estimatedOutput={120}
/>
```

### 2. ShiftEndNotification
교대 종료 시 자동으로 생산 실적 입력을 유도하는 알림 시스템입니다.

**주요 기능:**
- 교대 종료 15분 전 자동 알림
- 담당 설비별 생산 실적 입력 관리
- Tact Time 기반 추정 생산량 계산
- 나중에 입력하기 기능 (10분 후 재알림)

**사용 예시:**
```tsx
<ShiftEndNotification
  machines={userMachines}
  onProductionRecordSubmit={handleRecordSubmit}
/>
```

### 3. ProductionManager
생산 실적 관리를 위한 통합 컴포넌트입니다.

**주요 기능:**
- 수동 생산 실적 입력
- 교대 정보 표시
- 교대 종료 알림 통합 관리

## 관련 훅(Hooks)

### useProductionRecords
생산 실적 데이터 관리를 위한 커스텀 훅입니다.

**제공 기능:**
- `createProductionRecord`: 생산 실적 생성
- `getProductionRecords`: 생산 실적 조회
- `calculateEstimatedOutput`: Tact Time 기반 추정 생산량 계산

### useShiftNotification
교대 알림 관리를 위한 커스텀 훅입니다.

**제공 기능:**
- 교대 종료 시간 감지
- 알림 상태 관리
- 설비별 완료 상태 추적

## 유틸리티 함수

### shiftUtils.ts
교대 시간 계산 관련 유틸리티 함수들입니다.

**주요 함수:**
- `getCurrentShiftInfo`: 현재 교대 정보 반환
- `shouldShowShiftEndNotification`: 교대 종료 알림 필요 여부 확인
- `getTimeUntilShiftEnd`: 교대 종료까지 남은 시간 계산
- `calculateActualRuntime`: 실제 가동 시간 계산

## 교대 시간 정의

- **A조**: 08:00 - 20:00 (12시간)
- **B조**: 20:00 - 08:00 (다음날, 12시간)

## 데이터 검증

Zod 스키마를 사용하여 다음 규칙을 적용합니다:

```typescript
const productionInputSchema = z.object({
  output_qty: z.number().min(0, '생산 수량은 0 이상이어야 합니다'),
  defect_qty: z.number().min(0, '불량 수량은 0 이상이어야 합니다'),
}).refine((data) => data.defect_qty <= data.output_qty, {
  message: '불량 수량은 생산 수량보다 클 수 없습니다',
  path: ['defect_qty'],
});
```

## 테스트

Jest와 React Testing Library를 사용하여 단위 테스트를 작성했습니다.

테스트 실행:
```bash
npm test -- --testPathPattern=production
```

## 향후 개선사항

1. Supabase 실시간 구독을 통한 자동 데이터 동기화
2. 생산 실적 히스토리 조회 기능
3. 교대별 생산 목표 대비 실적 비교
4. 모바일 최적화된 입력 인터페이스
5. 오프라인 모드에서의 데이터 임시 저장