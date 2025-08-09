import { OEECalculator, OEECache, RealTimeOEECalculator } from '../oeeCalculator';
import { ProductionRecord, MachineLog, ErrorCodes } from '@/types';

describe('OEECalculator', () => {
  describe('calculateAvailability', () => {
    it('정상적인 가동률 계산', () => {
      const availability = OEECalculator.calculateAvailability(480, 600); // 8시간 / 10시간
      expect(availability).toBe(0.8);
    });

    it('100%를 초과하는 경우 1로 제한', () => {
      const availability = OEECalculator.calculateAvailability(700, 600);
      expect(availability).toBe(1);
    });

    it('음수 결과는 0으로 제한', () => {
      const availability = OEECalculator.calculateAvailability(-100, 600);
      expect(availability).toBe(0);
    });

    it('계획 가동시간이 0 이하인 경우 에러 발생', () => {
      expect(() => {
        OEECalculator.calculateAvailability(480, 0);
      }).toThrow();
    });
  });

  describe('calculatePerformance', () => {
    it('정상적인 성능 계산', () => {
      const performance = OEECalculator.calculatePerformance(400, 480); // 이론 400분 / 실제 480분
      expect(performance).toBeCloseTo(0.833, 3);
    });

    it('실제 가동시간이 0인 경우 0 반환', () => {
      const performance = OEECalculator.calculatePerformance(400, 0);
      expect(performance).toBe(0);
    });

    it('100%를 초과하는 경우 1로 제한', () => {
      const performance = OEECalculator.calculatePerformance(600, 400);
      expect(performance).toBe(1);
    });
  });

  describe('calculateQuality', () => {
    it('정상적인 품질 계산', () => {
      const quality = OEECalculator.calculateQuality(1000, 50); // 1000개 생산, 50개 불량
      expect(quality).toBe(0.95);
    });

    it('생산 수량이 0인 경우 0 반환', () => {
      const quality = OEECalculator.calculateQuality(0, 0);
      expect(quality).toBe(0);
    });

    it('불량 수량이 음수인 경우 에러 발생', () => {
      expect(() => {
        OEECalculator.calculateQuality(1000, -10);
      }).toThrow();
    });

    it('불량 수량이 생산 수량보다 많은 경우 0 반환', () => {
      const quality = OEECalculator.calculateQuality(100, 150);
      expect(quality).toBe(0);
    });
  });

  describe('calculateOEE', () => {
    it('정상적인 OEE 계산', () => {
      const oee = OEECalculator.calculateOEE(0.8, 0.9, 0.95);
      expect(oee).toBeCloseTo(0.684, 3);
    });

    it('하나라도 0이면 OEE는 0', () => {
      const oee = OEECalculator.calculateOEE(0, 0.9, 0.95);
      expect(oee).toBe(0);
    });
  });

  describe('calculateOEEFromRecord', () => {
    it('생산 실적으로부터 OEE 계산', () => {
      const record: ProductionRecord = {
        record_id: '1',
        machine_id: 'machine1',
        date: '2024-01-01',
        shift: 'A',
        planned_runtime: 600,
        actual_runtime: 480,
        ideal_runtime: 400,
        output_qty: 1000,
        defect_qty: 50,
        created_at: '2024-01-01T00:00:00Z'
      };

      const metrics = OEECalculator.calculateOEEFromRecord(record);
      
      expect(metrics.availability).toBe(0.8);
      expect(metrics.performance).toBeCloseTo(0.833, 3);
      expect(metrics.quality).toBe(0.95);
      expect(metrics.oee).toBeCloseTo(0.633, 3);
    });
  });

  describe('calculateActualRuntimeFromLogs', () => {
    it('정상 가동 로그로부터 실제 가동시간 계산', () => {
      const logs: MachineLog[] = [
        {
          log_id: '1',
          machine_id: 'machine1',
          state: 'NORMAL_OPERATION',
          start_time: '2024-01-01T08:00:00Z',
          end_time: '2024-01-01T10:00:00Z',
          duration: 120,
          operator_id: 'user1',
          created_at: '2024-01-01T08:00:00Z'
        },
        {
          log_id: '2',
          machine_id: 'machine1',
          state: 'MAINTENANCE',
          start_time: '2024-01-01T10:00:00Z',
          end_time: '2024-01-01T11:00:00Z',
          duration: 60,
          operator_id: 'user1',
          created_at: '2024-01-01T10:00:00Z'
        },
        {
          log_id: '3',
          machine_id: 'machine1',
          state: 'NORMAL_OPERATION',
          start_time: '2024-01-01T11:00:00Z',
          end_time: '2024-01-01T13:00:00Z',
          duration: 120,
          operator_id: 'user1',
          created_at: '2024-01-01T11:00:00Z'
        }
      ];

      const startTime = new Date('2024-01-01T08:00:00Z');
      const endTime = new Date('2024-01-01T13:00:00Z');
      
      const actualRuntime = OEECalculator.calculateActualRuntimeFromLogs(logs, startTime, endTime);
      expect(actualRuntime).toBe(240); // 2시간 + 2시간 = 240분
    });

    it('기간을 벗어나는 로그는 제외', () => {
      const logs: MachineLog[] = [
        {
          log_id: '1',
          machine_id: 'machine1',
          state: 'NORMAL_OPERATION',
          start_time: '2024-01-01T07:00:00Z', // 시작 시간 이전
          end_time: '2024-01-01T09:00:00Z',
          duration: 120,
          operator_id: 'user1',
          created_at: '2024-01-01T07:00:00Z'
        }
      ];

      const startTime = new Date('2024-01-01T08:00:00Z');
      const endTime = new Date('2024-01-01T10:00:00Z');
      
      const actualRuntime = OEECalculator.calculateActualRuntimeFromLogs(logs, startTime, endTime);
      expect(actualRuntime).toBe(60); // 08:00-09:00만 계산
    });
  });

  describe('calculateIdealRuntime', () => {
    it('이론 생산시간 계산', () => {
      const idealRuntime = OEECalculator.calculateIdealRuntime(1000, 30); // 1000개, 30초 택트타임
      expect(idealRuntime).toBe(500); // 30000초 = 500분
    });

    it('택트 타임이 0 이하인 경우 에러 발생', () => {
      expect(() => {
        OEECalculator.calculateIdealRuntime(1000, 0);
      }).toThrow();
    });
  });

  describe('calculatePlannedRuntime', () => {
    it('기본 계획 가동시간 계산', () => {
      const plannedRuntime = OEECalculator.calculatePlannedRuntime();
      expect(plannedRuntime).toBe(660); // 12시간 - 1시간 휴식 = 660분
    });

    it('커스텀 교대 시간과 휴식 시간', () => {
      const plannedRuntime = OEECalculator.calculatePlannedRuntime(8, 30);
      expect(plannedRuntime).toBe(450); // 8시간 - 30분 휴식 = 450분
    });
  });
});

describe('OEECache', () => {
  beforeEach(() => {
    OEECache.clear();
  });

  it('캐시 저장 및 조회', () => {
    const testData = {
      availability: 0.8,
      performance: 0.9,
      quality: 0.95,
      oee: 0.684,
      actual_runtime: 480,
      planned_runtime: 600,
      ideal_runtime: 400,
      output_qty: 1000,
      defect_qty: 50
    };

    OEECache.set('test_key', testData);
    const cached = OEECache.get('test_key');
    
    expect(cached).toEqual(testData);
  });

  it('존재하지 않는 키 조회시 null 반환', () => {
    const cached = OEECache.get('nonexistent_key');
    expect(cached).toBeNull();
  });

  it('캐시 삭제', () => {
    const testData = {
      availability: 0.8,
      performance: 0.9,
      quality: 0.95,
      oee: 0.684,
      actual_runtime: 480,
      planned_runtime: 600,
      ideal_runtime: 400,
      output_qty: 1000,
      defect_qty: 50
    };

    OEECache.set('test_key', testData);
    OEECache.delete('test_key');
    
    const cached = OEECache.get('test_key');
    expect(cached).toBeNull();
  });

  it('전체 캐시 삭제', () => {
    const testData = {
      availability: 0.8,
      performance: 0.9,
      quality: 0.95,
      oee: 0.684,
      actual_runtime: 480,
      planned_runtime: 600,
      ideal_runtime: 400,
      output_qty: 1000,
      defect_qty: 50
    };

    OEECache.set('test_key1', testData);
    OEECache.set('test_key2', testData);
    OEECache.clear();
    
    expect(OEECache.get('test_key1')).toBeNull();
    expect(OEECache.get('test_key2')).toBeNull();
  });
});

describe('RealTimeOEECalculator', () => {
  beforeEach(() => {
    OEECache.clear();
  });

  it('실시간 OEE 계산', () => {
    const machineLogs: MachineLog[] = [
      {
        log_id: '1',
        machine_id: 'machine1',
        state: 'NORMAL_OPERATION',
        start_time: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(), // 4시간 전
        end_time: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2시간 전
        duration: 120,
        operator_id: 'user1',
        created_at: new Date().toISOString()
      }
    ];

    const productionRecord = {
      output_qty: 400,
      defect_qty: 20
    };

    const metrics = RealTimeOEECalculator.calculateRealTimeOEE(
      'machine1',
      machineLogs,
      productionRecord,
      30
    );

    expect(metrics).toBeDefined();
    expect(metrics.availability).toBeGreaterThanOrEqual(0);
    expect(metrics.performance).toBeGreaterThanOrEqual(0);
    expect(metrics.quality).toBeGreaterThanOrEqual(0);
    expect(metrics.oee).toBeGreaterThanOrEqual(0);
  });
});