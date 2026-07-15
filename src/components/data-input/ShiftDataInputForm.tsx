'use client';

import React, { useState, useRef } from 'react';
import {
  Form,
  Input,
  InputNumber,
  Select,
  Button,
  Space,
  Card,
  Row,
  Col,
  Typography,
  Table,
  Modal,
  Popconfirm,
  Tabs,
  Alert,
  Badge,
  DatePicker,
  Descriptions,
  Checkbox,
  App
} from 'antd';
import {
  SaveOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  SunOutlined,
  MoonOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useDataInputTranslation } from '@/hooks/useTranslation';
import { useMachines } from '@/hooks/useMachines';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import type { ShiftProductionData, DowntimeEntry, DailyProductionData } from '@/types/dataInput';
import { DOWNTIME_REASON_KEYS } from '@/types/dataInput';
import { formatMachineLocation } from '@/utils/machineLocation';
import { authFetch } from '@/lib/authFetch';
import {
  buildShiftWindows,
  clipInterval,
  getBusinessDateAt,
  getShiftAt,
  totalMinutes,
} from '@/utils/downtimeIntervals';

const { Text } = Typography;
const { Option } = Select;
const { TextArea } = Input;

// 교대 1회 기본 가동시간 (12시간 = 720분).
// 서버의 @/lib/plannedRuntime 에 같은 값이 있으나, 그 모듈은 supabase-admin(서비스 롤 키)을
// import 하므로 클라이언트 번들로 끌어올 수 없다. 값을 바꿀 때는 양쪽을 함께 수정할 것.
const DEFAULT_OPERATING_MINUTES = 720;

// 기존 생산 기록 타입 정의
interface ExistingProductionRecord {
  record_id: string;
  machine_id: string;
  date: string;
  shift: 'A' | 'B';
  output_qty: number;
  defect_qty: number;
  planned_runtime?: number | null;
  actual_runtime?: number | null;
  availability?: number | null;
  performance?: number | null;
  quality?: number | null;
  oee?: number | null;
  downtime_minutes?: number | null;
}

interface PersistedShiftState {
  shift: 'A' | 'B';
  status: 'WORKING' | 'OFF' | 'HOLIDAY' | 'MISSING';
  version: number;
}

// POST /api/production-records/daily 요청 페이로드 (서버가 OEE 지표를 자체 계산하므로
// 클라이언트는 원시 입력값만 전송한다)
interface ShiftSavePayload {
  actual_production: number;
  defect_quantity: number;
  operating_minutes: number;
  downtime_confirmed: boolean;
}

// day_shift / night_shift 를 생략하면(undefined) 서버는 그 교대를 저장하지도, 삭제하지도 않는다.
// (daily/route.ts -> save_daily_production RPC 의 "ELSIF v_record IS NOT NULL" 분기)
// 입력하지 않은 교대를 0으로 채워 보내면 output_qty=0 / oee=0 인 유령 레코드가 생기므로,
// "입력되지 않은 교대"는 반드시 생략해야 한다.
interface DailyProductionSavePayload {
  machine_id: string;
  date: string;
  day_shift_off: boolean;
  night_shift_off: boolean;
  day_shift?: ShiftSavePayload;
  night_shift?: ShiftSavePayload;
}

type VersionedDowntimeEntry = DowntimeEntry & { version?: number };

// AbortController에 의한 취소 여부 확인
const isAbortError = (error: unknown): boolean =>
  error instanceof Error && error.name === 'AbortError';

interface ShiftDataInputFormProps {
  initialDate?: string;
}

const ShiftDataInputForm: React.FC<ShiftDataInputFormProps> = ({ initialDate }) => {
  const { t } = useDataInputTranslation();
  const { machines, loading: machinesLoading, error: machinesError } = useMachines();
  const { message, modal } = App.useApp();
  const {
    getShiftTimes,
    getCompanyInfo,
    isLoading: settingsLoading,
  } = useSystemSettings();

  // 시스템 설정에서 휴식 시간 가져오기 (getSetting 반환 타입이 느슨하므로 숫자로 정규화)
  const shiftSettings = getShiftTimes();
  const parsedBreakTime = Number(shiftSettings.breakTime);
  const breakTimeMinutes: number = Number.isFinite(parsedBreakTime) && parsedBreakTime >= 0
    ? parsedBreakTime
    : 60;
  const businessTimezone = getCompanyInfo().timezone;
  const resolveInitialClock = React.useCallback(() => {
    try {
      return {
        date: initialDate ?? getBusinessDateAt(Date.now(), businessTimezone, shiftSettings.shiftA.start),
        shift: getShiftAt(
          Date.now(),
          businessTimezone,
          shiftSettings.shiftA.start,
          shiftSettings.shiftB.start
        ) === 'A' ? 'DAY' as const : 'NIGHT' as const,
      };
    } catch {
      return {
        date: initialDate ?? dayjs().format('YYYY-MM-DD'),
        shift: 'DAY' as const,
      };
    }
  }, [
    businessTimezone,
    initialDate,
    shiftSettings.shiftA.start,
    shiftSettings.shiftB.start,
  ]);
  const initialClock = resolveInitialClock();

  // 저장된 planned_runtime 으로부터 원래 입력 가동시간을 역산한다.
  // 서버는 planned_runtime = operating_minutes - break_time_minutes 로만 저장하고
  // operating_minutes 자체는 보존하지 않으므로, 재저장 시 원래 값을 복원하려면 역산이 필요하다.
  // (역산하지 않으면 단축 가동일 기록을 다시 저장할 때 기본값 720분으로 되돌아간다)
  // planned_runtime 이 비어 있는 레거시 레코드는 역산이 불가능하므로 기본값을 사용한다.
  const recoverOperatingMinutes = (plannedRuntime: number | null | undefined): number => {
    if (typeof plannedRuntime !== 'number' || !Number.isFinite(plannedRuntime) || plannedRuntime < 0) {
      return DEFAULT_OPERATING_MINUTES;
    }
    return plannedRuntime + breakTimeMinutes;
  };

  // 폼 상태
  const [selectedMachineId, setSelectedMachineId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(initialClock.date);
  const [activeShift, setActiveShift] = useState<'DAY' | 'NIGHT'>(initialClock.shift);
  const [loading, setLoading] = useState(false);
  const [loadingDowntime, setLoadingDowntime] = useState(false);
  const [loadingSelectionData, setLoadingSelectionData] = useState(false);

  // 기존 생산 기록 관련 상태
  const [existingDayRecord, setExistingDayRecord] = useState<ExistingProductionRecord | null>(null);
  const [existingNightRecord, setExistingNightRecord] = useState<ExistingProductionRecord | null>(null);
  const [loadingExistingRecords, setLoadingExistingRecords] = useState(false);
  const [productionRecordsLoadFailed, setProductionRecordsLoadFailed] = useState(false);
  
  // 교대조별 기본 가동시간 (분 단위)
  const [dayShiftOperatingMinutes, setDayShiftOperatingMinutes] = useState<number>(DEFAULT_OPERATING_MINUTES);
  const [nightShiftOperatingMinutes, setNightShiftOperatingMinutes] = useState<number>(DEFAULT_OPERATING_MINUTES);
  
  // 교대조별 휴무 상태
  const [dayShiftOff, setDayShiftOff] = useState<boolean>(false);
  const [nightShiftOff, setNightShiftOff] = useState<boolean>(false);
  const [dayShiftWorkingConfirmed, setDayShiftWorkingConfirmed] = useState(false);
  const [nightShiftWorkingConfirmed, setNightShiftWorkingConfirmed] = useState(false);
  const [dayZeroDowntimeConfirmed, setDayZeroDowntimeConfirmed] = useState(false);
  const [nightZeroDowntimeConfirmed, setNightZeroDowntimeConfirmed] = useState(false);
  const initialClockAppliedRef = useRef(false);

  React.useEffect(() => {
    if (initialDate || settingsLoading || initialClockAppliedRef.current) return;
    const clock = resolveInitialClock();
    setSelectedDate(clock.date);
    setActiveShift(clock.shift);
    initialClockAppliedRef.current = true;
  }, [
    initialDate,
    resolveInitialClock,
    settingsLoading,
  ]);
  
  // 설비 관련 데이터 상태
  const [machineDetails, setMachineDetails] = useState<{
    productionModel: { model_name: string } | null;
    currentProcess: { process_name: string; tact_time_seconds: number; cavity_count?: number } | null;
    loading: boolean;
    error: string | null;
  }>({
    productionModel: null,
    currentProcess: null,
    loading: false,
    error: null
  });
  
  // 교대별 데이터
  const [dayShiftData, setDayShiftData] = useState<ShiftProductionData>({
    shift: 'DAY',
    shift_name: t('shift.dayShift'),
    start_time: '08:00',
    end_time: '20:00',
    operator_name: '',
    actual_production: 0,
    defect_quantity: 0,
    good_quantity: 0,
    downtime_entries: [],
    total_downtime_minutes: 0
  });
  
  const [nightShiftData, setNightShiftData] = useState<ShiftProductionData>({
    shift: 'NIGHT',
    shift_name: t('shift.nightShift'),
    start_time: '20:00',
    end_time: '08:00',
    operator_name: '',
    actual_production: 0,
    defect_quantity: 0,
    good_quantity: 0,
    downtime_entries: [],
    total_downtime_minutes: 0
  });

  // 비가동 시간 모달 상태
  const [downtimeModalVisible, setDowntimeModalVisible] = useState(false);
  const [downtimeSubmitting, setDowntimeSubmitting] = useState(false);
  const [downtimeForm] = Form.useForm();
  const downtimeCreateIdRef = useRef<string | null>(null);

  // 비가동 조회 실패 여부 (교대별).
  //
  // 조회 실패는 화면에 드러낸다. 다만 생산 저장 API가 DB의 비가동 원본을 직접 다시
  // 집계하므로 생산수량 입력은 막지 않는다. 서버 조회까지 실패하면 런타임/OEE를 NULL로
  // 저장해 잘못된 가동률 100%가 만들어지지 않는다.
  const [downtimeLoadFailed, setDowntimeLoadFailed] = useState<{ DAY: boolean; NIGHT: boolean }>({
    DAY: false,
    NIGHT: false
  });

  // 설비/날짜 변경 시 오래된(stale) 응답이 최신 상태를 덮어쓰지 않도록 하는 요청 순번 가드
  const loadRequestIdRef = useRef(0);

  // 저장 진행 중 재진입 방지.
  // 비가동 0분 확인 모달을 기다리는 동안에는 loading 상태가 아직 false 라서 저장 버튼이 계속
  // 눌리고, 클릭할 때마다 확인 모달이 새로 쌓인다.
  const savingRef = useRef(false);

  // 비가동 사유 목록 (번역 키 사용)
  const downtimeReasons = DOWNTIME_REASON_KEYS;

  // 사유 번역 헬퍼
  const translateReason = (reasonKey: string): string => {
    return t(`downtime.reasons.${reasonKey}` as 'downtime.reasons.equipmentFailure');
  };

  // 기존 생산 기록 로드 함수
  // requestId/signal은 설비/날짜를 빠르게 전환할 때 이전 요청의 응답이 최신 상태를 덮어쓰는 것을 방지한다 (F6)
  const loadExistingProductionRecords = async (
    machineId: string,
    date: string,
    requestId?: number,
    signal?: AbortSignal
  ) => {
    const isStale = () => requestId !== undefined && requestId !== loadRequestIdRef.current;

    try {
      setLoadingExistingRecords(true);

      const response = await authFetch(
        `/api/production-records?machine_id=${machineId}&startDate=${date}&endDate=${date}`,
        { signal }
      );

      if (isStale()) return;

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();

      if (isStale()) return;
      setProductionRecordsLoadFailed(false);

      const shiftStates = Array.isArray(result.shift_states)
        ? result.shift_states as PersistedShiftState[]
        : [];
      const dayState = shiftStates.find(state => state.shift === 'A');
      const nightState = shiftStates.find(state => state.shift === 'B');
      setDayShiftOff(dayState?.status === 'OFF' || dayState?.status === 'HOLIDAY');
      setNightShiftOff(nightState?.status === 'OFF' || nightState?.status === 'HOLIDAY');

      if (result.records && result.records.length > 0) {
        // 주간조(A)와 야간조(B) 기록 분리
        const dayRecord = result.records.find((r: ExistingProductionRecord) => r.shift === 'A');
        const nightRecord = result.records.find((r: ExistingProductionRecord) => r.shift === 'B');

        setExistingDayRecord(dayRecord || null);
        setExistingNightRecord(nightRecord || null);
        setDayShiftWorkingConfirmed(Boolean(dayRecord) || dayState?.status === 'WORKING');
        setNightShiftWorkingConfirmed(Boolean(nightRecord) || nightState?.status === 'WORKING');
        setDayZeroDowntimeConfirmed(dayRecord?.downtime_minutes === 0);
        setNightZeroDowntimeConfirmed(nightRecord?.downtime_minutes === 0);

        // 기존 데이터가 있으면 폼에 반영, 없으면 이전 설비/날짜의 값이 남아있지 않도록 0으로 초기화 (F1)
        if (dayRecord) {
          setDayShiftData(prev => ({
            ...prev,
            actual_production: dayRecord.output_qty || 0,
            defect_quantity: dayRecord.defect_qty || 0,
            good_quantity: Math.max(0, (dayRecord.output_qty || 0) - (dayRecord.defect_qty || 0))
          }));
          setDayShiftOperatingMinutes(recoverOperatingMinutes(dayRecord.planned_runtime));
        } else {
          setDayShiftData(prev => ({
            ...prev,
            actual_production: 0,
            defect_quantity: 0,
            good_quantity: 0
          }));
        }

        if (nightRecord) {
          setNightShiftData(prev => ({
            ...prev,
            actual_production: nightRecord.output_qty || 0,
            defect_quantity: nightRecord.defect_qty || 0,
            good_quantity: Math.max(0, (nightRecord.output_qty || 0) - (nightRecord.defect_qty || 0))
          }));
          setNightShiftOperatingMinutes(recoverOperatingMinutes(nightRecord.planned_runtime));
        } else {
          setNightShiftData(prev => ({
            ...prev,
            actual_production: 0,
            defect_quantity: 0,
            good_quantity: 0
          }));
        }

        if (dayRecord || nightRecord) {
          message.info(t('messages.existingRecordLoaded'));
        }
      } else {
        // 기존 기록 없음 - 이전 설비/날짜에서 남아있는 수량도 함께 초기화 (F1)
        setExistingDayRecord(null);
        setExistingNightRecord(null);
        setDayShiftWorkingConfirmed(dayState?.status === 'WORKING');
        setNightShiftWorkingConfirmed(nightState?.status === 'WORKING');
        setDayZeroDowntimeConfirmed(false);
        setNightZeroDowntimeConfirmed(false);
        setDayShiftData(prev => ({
          ...prev,
          actual_production: 0,
          defect_quantity: 0,
          good_quantity: 0
        }));
        setNightShiftData(prev => ({
          ...prev,
          actual_production: 0,
          defect_quantity: 0,
          good_quantity: 0
        }));
      }
    } catch (error) {
      if (isAbortError(error) || isStale()) return;
      console.error('Error loading existing production records:', error);
      setExistingDayRecord(null);
      setExistingNightRecord(null);
      setDayZeroDowntimeConfirmed(false);
      setNightZeroDowntimeConfirmed(false);
      setProductionRecordsLoadFailed(true);
    } finally {
      if (!isStale()) {
        setLoadingExistingRecords(false);
      }
    }
  };

  // 생산 기록 삭제 함수
  const handleDeleteRecord = async (recordId: string, shiftType: 'DAY' | 'NIGHT') => {
    modal.confirm({
      title: t('messages.confirmDelete'),
      content: t('messages.confirmDeleteDescription'),
      okText: t('editMode.deleteRecord'),
      cancelText: t('downtime.cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          setLoading(true);
          const response = await authFetch(`/api/production-records/${recordId}`, {
            method: 'DELETE'
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const result = await response.json();

          if (result.success) {
            message.success(t('messages.recordDeleteSuccess'));

            // 삭제된 교대조 상태 초기화
            if (shiftType === 'DAY') {
              setExistingDayRecord(null);
              setDayShiftData(prev => ({
                ...prev,
                actual_production: 0,
                defect_quantity: 0,
                good_quantity: 0
              }));
            } else {
              setExistingNightRecord(null);
              setNightShiftData(prev => ({
                ...prev,
                actual_production: 0,
                defect_quantity: 0,
                good_quantity: 0
              }));
            }
          }
        } catch (error) {
          console.error('Error deleting production record:', error);
          message.error(t('messages.recordDeleteFailed'));
        } finally {
          setLoading(false);
        }
      }
    });
  };

  // 설비 선택 및 날짜 변경 시 기존 생산 기록 및 비가동 데이터 로드
  React.useEffect(() => {
    if (!selectedMachineId || !selectedDate) {
      ++loadRequestIdRef.current;
      setLoadingSelectionData(false);
      return;
    }

    // 이 effect 실행에 대한 고유 요청 순번 발급 + 이전 요청 취소 (F6)
    const requestId = ++loadRequestIdRef.current;
    const controller = new AbortController();

    // 설비/날짜가 바뀌는 즉시 이전 선택의 저장 근거를 모두 지운다. 조회가 끝날 때까지
    // 이전 수량/record id가 잠깐 보이거나 저장 payload에 섞여서는 안 된다.
    setLoadingSelectionData(true);
    setExistingDayRecord(null);
    setExistingNightRecord(null);
    setDayShiftOff(false);
    setNightShiftOff(false);
    setDayShiftWorkingConfirmed(false);
    setNightShiftWorkingConfirmed(false);
    setDayZeroDowntimeConfirmed(false);
    setNightZeroDowntimeConfirmed(false);
    setDayShiftOperatingMinutes(DEFAULT_OPERATING_MINUTES);
    setNightShiftOperatingMinutes(DEFAULT_OPERATING_MINUTES);
    setDayShiftData(prev => ({
      ...prev,
      actual_production: 0,
      defect_quantity: 0,
      good_quantity: 0,
      downtime_entries: [],
      total_downtime_minutes: 0
    }));
    setNightShiftData(prev => ({
      ...prev,
      actual_production: 0,
      defect_quantity: 0,
      good_quantity: 0,
      downtime_entries: [],
      total_downtime_minutes: 0
    }));
    setDowntimeLoadFailed({ DAY: false, NIGHT: false });
    setProductionRecordsLoadFailed(false);

    // 기존 생산 기록 로드
    void Promise.all([
      loadExistingProductionRecords(selectedMachineId, selectedDate, requestId, controller.signal),
      loadDowntimeEntries(selectedMachineId, selectedDate, 'DAY', requestId, controller.signal),
      loadDowntimeEntries(selectedMachineId, selectedDate, 'NIGHT', requestId, controller.signal)
    ]).finally(() => {
      if (requestId === loadRequestIdRef.current) {
        setLoadingSelectionData(false);
      }
    });

    return () => {
      controller.abort();
    };
  }, [selectedMachineId, selectedDate]);

  // 현재 교대 데이터 가져오기
  const getCurrentShiftData = (): ShiftProductionData => {
    return activeShift === 'DAY' ? dayShiftData : nightShiftData;
  };

  // 현재 교대 데이터 업데이트
  const updateCurrentShiftData = (updates: Partial<ShiftProductionData>) => {
    if (activeShift === 'DAY') {
      setDayShiftData(prev => ({ ...prev, ...updates }));
    } else {
      setNightShiftData(prev => ({ ...prev, ...updates }));
    }
  };

  // 선택된 설비 정보 가져오기
  const getSelectedMachine = () => {
    return machines.find(m => m.id === selectedMachineId);
  };

  // 설비의 생산 모델 정보 가져오기
  const getMachineProductionModel = async (machineId: string) => {
    const machine = machines.find(m => m.id === machineId);
    if (!machine?.production_model_id) {
      throw new Error(t('messages.noProductionModel'));
    }

    const response = await authFetch(`/api/product-models/${machine.production_model_id}`);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: '' }));
      throw new Error(errorData.message || `HTTP ${response.status}`);
    }

    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error || 'API request failed');
    }

    return data.model;
  };

  // 설비의 현재 공정 정보 가져오기
  const getMachineCurrentProcess = async (machineId: string) => {
    const machine = machines.find(m => m.id === machineId);
    if (!machine?.current_process_id) {
      throw new Error(t('messages.noProcess'));
    }

    const response = await authFetch(`/api/model-processes/${machine.current_process_id}`);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: '' }));
      throw new Error(errorData.message || `HTTP ${response.status}`);
    }

    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error || 'API request failed');
    }

    return data.process;
  };

  // 계획 가동시간 = max(0, 가동시간 - 휴식시간)
  // 서버(/api/production-records/daily → src/lib/plannedRuntime.ts)가 저장하는 planned_runtime 과 동일한 정의
  const calculatePlannedRuntime = (operatingMinutes: number): number =>
    Math.max(0, operatingMinutes - breakTimeMinutes);

  // 기준 생산량(CAPA) 계산 (분 단위 입력, 휴식 시간 차감 적용, 캐비티 수 반영) (F2)
  const calculateCapacity = (
    tactTimeSeconds: number,
    operatingMinutes: number,
    breakMinutes: number = 0,
    cavityCount: number = 1
  ) => {
    if (!tactTimeSeconds || !operatingMinutes) return 0;
    // 실제 작업 가능 시간 = 가동시간 - 휴식시간
    const actualOperatingMinutes = Math.max(0, operatingMinutes - breakMinutes);
    return Math.floor((actualOperatingMinutes * 60) / tactTimeSeconds) * Math.max(1, cavityCount);
  };

  // 설비 선택 핸들러
  const handleMachineSelect = async (machineId: string) => {
    setSelectedMachineId(machineId);
    
    // 이전 데이터 초기화
    setMachineDetails({
      productionModel: null,
      currentProcess: null,
      loading: false,
      error: null
    });

    // 선택된 설비 정보 확인
    const selectedMachine = machines.find(m => m.id === machineId);
    if (selectedMachine) {
      console.log('Selected machine:', selectedMachine);
      
      // 로딩 시작
      setMachineDetails(prev => ({ ...prev, loading: true, error: null }));
      
      try {
        // 생산 모델 및 공정 정보 가져오기
        const promises = [];
        
        // 생산 모델 정보 가져오기
        if (selectedMachine.production_model_id) {
          promises.push(getMachineProductionModel(machineId));
        } else {
          promises.push(Promise.resolve(null));
        }
        
        // 공정 정보 가져오기
        if (selectedMachine.current_process_id) {
          promises.push(getMachineCurrentProcess(machineId));
        } else {
          promises.push(Promise.resolve(null));
        }

        const [productionModel, currentProcess] = await Promise.all(promises);

        console.log('Production model:', productionModel);
        console.log('Current process:', currentProcess);

        // 상태 업데이트
        setMachineDetails({
          productionModel,
          currentProcess,
          loading: false,
          error: null
        });

        // 성공 메시지
        if (productionModel && currentProcess) {
          message.success(t('messages.machineInfoLoadSuccess'));
        } else {
          message.warning(t('messages.machineInfoPartialWarning'));
        }

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : t('messages.machineInfoLoadFailed');
        console.error('Error loading machine details:', error);
        setMachineDetails(prev => ({
          ...prev,
          loading: false,
          error: errorMessage
        }));

        message.error(`${t('messages.machineInfoLoadFailed')}: ${errorMessage}`);
      }
    }
  };

  // 생산량 변경 핸들러
  const handleProductionChange = (field: 'actual_production' | 'defect_quantity', value: number) => {
    const currentData = getCurrentShiftData();
    const updates: Partial<ShiftProductionData> = { [field]: value };
    
    if (field === 'actual_production' || field === 'defect_quantity') {
      const actualProduction = field === 'actual_production' ? value : currentData.actual_production;
      const defectQuantity = field === 'defect_quantity' ? value : currentData.defect_quantity;
      updates.good_quantity = Math.max(0, actualProduction - defectQuantity);
    }
    
    updateCurrentShiftData(updates);
  };

  // 비가동 데이터 로드
  // requestId/signal은 설비/날짜를 빠르게 전환할 때 이전 요청의 응답이 최신 상태를 덮어쓰는 것을 방지한다 (F6)
  const loadDowntimeEntries = async (
    machineId: string,
    date: string,
    shift: 'DAY' | 'NIGHT',
    requestId?: number,
    signal?: AbortSignal
  ) => {
    const isStale = () => requestId !== undefined && requestId !== loadRequestIdRef.current;

    try {
      setLoadingDowntime(true);
      const shiftCode = shift === 'DAY' ? 'A' : 'B';

      const response = await authFetch(
        `/api/downtime-entries?machine_id=${machineId}&date=${date}&shift=${shiftCode}`,
        { signal }
      );

      if (isStale()) return;

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();

      if (isStale()) return;

      if (!result.success) {
        throw new Error(result.error || 'Failed to load downtime entries');
      }

      const entries: DowntimeEntry[] = result.data || [];
      const totalDowntime = entries.reduce(
        (sum, entry) => sum + downtimeMinutesForShift(entry, date, shift),
        0
      );

      // 해당 교대의 데이터에 반영
      if (shift === 'DAY') {
        setDayShiftData(prev => ({
          ...prev,
          downtime_entries: entries,
          total_downtime_minutes: totalDowntime
        }));
      } else {
        setNightShiftData(prev => ({
          ...prev,
          downtime_entries: entries,
          total_downtime_minutes: totalDowntime
        }));
      }

      // 조회에 성공했으므로 이전 실패 표시를 해제한다
      setDowntimeLoadFailed(prev => (prev[shift] ? { ...prev, [shift]: false } : prev));

      console.log(`Loaded ${entries.length} downtime entries for ${shift} shift`);
    } catch (error) {
      if (isAbortError(error) || isStale()) return;
      console.error('Error loading downtime entries:', error);

      // 화면 합계는 신뢰할 수 없으므로 실패를 표시한다. 생산 저장 시에는 이 값을 보내지
      // 않고 서버가 DB 원본을 다시 읽으므로 생산수량 입력 자체는 계속 가능하다.
      setDowntimeLoadFailed(prev => ({ ...prev, [shift]: true }));
      message.error(t('downtime.loadFailed'));

      if (shift === 'DAY') {
        setDayShiftData(prev => ({
          ...prev,
          downtime_entries: [],
          total_downtime_minutes: 0
        }));
      } else {
        setNightShiftData(prev => ({
          ...prev,
          downtime_entries: [],
          total_downtime_minutes: 0
        }));
      }
    } finally {
      if (!isStale()) {
        setLoadingDowntime(false);
      }
    }
  };

  const downtimeMinutesAt = (entry: DowntimeEntry, now = dayjs()): number => {
    const start = dayjs(entry.start_time);
    const end = entry.end_time ? dayjs(entry.end_time) : now;
    if (!start.isValid() || !end.isValid() || !end.isAfter(start)) return 0;
    return Math.max(0, Math.round(end.diff(start, 'minute', true)));
  };

  const downtimeMinutesForShift = (
    entry: DowntimeEntry,
    date: string,
    shift: 'DAY' | 'NIGHT',
    now = Date.now()
  ): number => {
    const start = new Date(entry.start_time).getTime();
    const end = entry.end_time ? new Date(entry.end_time).getTime() : now;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;

    try {
      const windows = buildShiftWindows({
        startDate: date,
        endDate: date,
        timezone: businessTimezone,
        shiftAStart: shiftSettings.shiftA.start,
        shiftBStart: shiftSettings.shiftB.start,
        requestedShifts: [shift === 'DAY' ? 'A' : 'B']
      });
      return totalMinutes(clipInterval({ start, end }, windows));
    } catch {
      // 설정값이 일시적으로 잘못된 경우에도 원본 사건을 숨기지는 않는다.
      return downtimeMinutesAt(entry, dayjs(now));
    }
  };

  const replaceDowntimeEntry = (savedEntry: VersionedDowntimeEntry) => {
    const replace = (
      previous: ShiftProductionData,
      shift: 'DAY' | 'NIGHT'
    ): ShiftProductionData => {
      const downtimeEntries = previous.downtime_entries.map(entry =>
        entry.id === savedEntry.id ? savedEntry : entry
      );
      return {
        ...previous,
        downtime_entries: downtimeEntries,
        total_downtime_minutes: downtimeEntries.reduce(
          (sum, entry) => sum + downtimeMinutesForShift(
            entry,
            selectedDate,
            shift
          ),
          0
        )
      };
    };
    // 교대 경계를 넘는 같은 사건이 양쪽 목록에 보일 수 있으므로 ID 기준으로 모두 갱신한다.
    setDayShiftData(previous => replace(previous, 'DAY'));
    setNightShiftData(previous => replace(previous, 'NIGHT'));
  };

  // 비가동은 생산 실적과 독립된 원본 사건이다. 입력 즉시 고유 ID로 저장하며,
  // 생산실적 저장/휴무 처리 payload에 다시 실어 전체 목록을 교체하지 않는다.
  const addDowntimeEntry = async (values: { start_time: string; end_time?: string; reason: string; description?: string }) => {
    if (!selectedMachineId) {
      message.error(t('messages.selectMachineFirst'));
      return;
    }

    // 기존 생산실적과 두 교대의 비가동 조회가 모두 끝나기 전에는 어떤 저장도 허용하지 않는다.
    if (loadingSelectionData || loadingExistingRecords || loadingDowntime) {
      return;
    }

    // 이중 클릭으로 동일한 비가동 기록이 두 번 저장되는 것을 방지 (F7)
    if (downtimeSubmitting) {
      return;
    }

    try {
      setDowntimeSubmitting(true);
      // DatePicker 값은 브라우저의 로컬 zone을 갖는다. 표시된 벽시계 값을 회사
      // 시간대로 해석해야 다른 시간대의 단말에서도 같은 실제 시각으로 저장된다.
      const startTime = dayjs(values.start_time).tz(businessTimezone, true);
      const endTime = values.end_time
        ? dayjs(values.end_time).tz(businessTimezone, true)
        : null;
      if (!startTime.isValid() || (endTime && (!endTime.isValid() || !endTime.isAfter(startTime)))) {
        throw new Error('비가동 종료 시각은 시작 시각보다 늦어야 합니다.');
      }

      const activeData = activeShift === 'DAY' ? dayShiftData : nightShiftData;
      const candidateEnd = endTime?.valueOf() ?? Number.POSITIVE_INFINITY;
      const overlapsExisting = activeData.downtime_entries.some(entry => {
        const existingStart = dayjs(entry.start_time).valueOf();
        const existingEnd = entry.end_time
          ? dayjs(entry.end_time).valueOf()
          : Number.POSITIVE_INFINITY;
        return startTime.valueOf() < existingEnd && candidateEnd > existingStart;
      });
      if (overlapsExisting) throw new Error('같은 교대의 비가동 시간이 서로 겹칩니다.');

      const clientEntryId = downtimeCreateIdRef.current ?? crypto.randomUUID();
      downtimeCreateIdRef.current = clientEntryId;

      const response = await authFetch('/api/downtime-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: clientEntryId,
          machine_id: selectedMachineId,
          date: selectedDate,
          shift: activeShift === 'DAY' ? 'A' : 'B',
          start_time: startTime.toISOString(),
          end_time: endTime?.toISOString() ?? null,
          reason: values.reason,
          description: values.description || ''
        })
      });

      const result = await response.json().catch(() => ({ success: false, error: `HTTP ${response.status}` }));
      if (!response.ok || !result.success || !result.data?.id) {
        throw new Error(result.error || `HTTP ${response.status}`);
      }

      const entry = result.data as VersionedDowntimeEntry;
      downtimeCreateIdRef.current = null;
      const appendEntry = (previous: ShiftProductionData): ShiftProductionData => {
        const downtimeEntries = [...previous.downtime_entries, entry];
        return {
          ...previous,
          downtime_entries: downtimeEntries,
          total_downtime_minutes: downtimeEntries.reduce(
            (sum, item) => sum + downtimeMinutesForShift(item, selectedDate, activeShift),
            0
          )
        };
      };
      if (activeShift === 'DAY') {
        setDayShiftData(appendEntry);
        setDayZeroDowntimeConfirmed(false);
      } else {
        setNightShiftData(appendEntry);
        setNightZeroDowntimeConfirmed(false);
      }

      message.success(t('messages.downtimeAdded'));
      setDowntimeModalVisible(false);
      downtimeForm.resetFields();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error adding downtime entry:', error);
      message.error(`${t('messages.saveFailed')}: ${errorMessage}`);
      void loadDowntimeEntries(selectedMachineId, selectedDate, activeShift);
    } finally {
      setDowntimeSubmitting(false);
    }
  };

  const closeDowntimeEntry = async (entry: VersionedDowntimeEntry) => {
    if (!entry.id || entry.end_time || downtimeSubmitting) return;

    try {
      setDowntimeSubmitting(true);
      const response = await authFetch(`/api/downtime-entries/${entry.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          end_time: dayjs().toISOString(),
          expected_version: entry.version
        })
      });
      const result = await response.json().catch(() => ({ success: false, error: `HTTP ${response.status}` }));
      if (!response.ok || !result.success || !result.data?.id) {
        throw new Error(result.error || `HTTP ${response.status}`);
      }
      replaceDowntimeEntry(result.data as VersionedDowntimeEntry);
      message.success(t('messages.downtimeAdded'));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      message.error(`${t('messages.saveFailed')}: ${errorMessage}`);
      if (selectedMachineId) {
        void loadDowntimeEntries(selectedMachineId, selectedDate, activeShift);
      }
    } finally {
      setDowntimeSubmitting(false);
    }
  };

  // 한 행의 ID와 마지막 version을 조건으로 삭제한다. 다른 사용자가 먼저 수정했다면
  // 서버가 409를 반환하므로 최신 목록을 다시 읽기 전에는 조용히 삭제되지 않는다.
  const removeDowntimeEntry = async (entry: VersionedDowntimeEntry) => {
    if (!selectedMachineId || !entry.id || downtimeSubmitting) return;

    try {
      setDowntimeSubmitting(true);
      const response = await authFetch(`/api/downtime-entries/${entry.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expected_version: entry.version })
      });
      const result = await response.json().catch(() => ({ success: false, error: `HTTP ${response.status}` }));
      if (!response.ok || !result.success) {
        throw new Error(result.error || `HTTP ${response.status}`);
      }

      const removeEntry = (
        previous: ShiftProductionData,
        shift: 'DAY' | 'NIGHT'
      ): ShiftProductionData => {
        const downtimeEntries = previous.downtime_entries.filter(item => item.id !== entry.id);
        return {
          ...previous,
          downtime_entries: downtimeEntries,
          total_downtime_minutes: downtimeEntries.reduce(
            (sum, item) => sum + downtimeMinutesForShift(item, selectedDate, shift),
            0
          )
        };
      };
      setDayShiftData(previous => removeEntry(previous, 'DAY'));
      setNightShiftData(previous => removeEntry(previous, 'NIGHT'));
      setDayZeroDowntimeConfirmed(false);
      setNightZeroDowntimeConfirmed(false);
      message.success(t('messages.downtimeDeleted'));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      message.error(`${t('messages.saveFailed')}: ${errorMessage}`);
      void loadDowntimeEntries(selectedMachineId, selectedDate, activeShift);
    } finally {
      setDowntimeSubmitting(false);
    }
  };

  // 일일 데이터 계산
  const calculateDailyData = (): DailyProductionData => {
    // 휴무가 아닌 교대조의 데이터만 합산
    const totalProduction = 
      (!dayShiftOff ? dayShiftData.actual_production : 0) + 
      (!nightShiftOff ? nightShiftData.actual_production : 0);
    const totalDefects = 
      (!dayShiftOff ? dayShiftData.defect_quantity : 0) + 
      (!nightShiftOff ? nightShiftData.defect_quantity : 0);
    const totalGoodQuantity = 
      (!dayShiftOff ? dayShiftData.good_quantity : 0) + 
      (!nightShiftOff ? nightShiftData.good_quantity : 0);
    const totalDowntime = 
      (!dayShiftOff ? dayShiftData.total_downtime_minutes : 0) + 
      (!nightShiftOff ? nightShiftData.total_downtime_minutes : 0);

    // 기준 생산량(CAPA) = Tact Time * 교대조별 가동시간 (휴식 시간 차감, 캐비티 수 반영) (F2)
    const tactTimeSeconds = machineDetails.currentProcess?.tact_time_seconds;
    const cavityCount = machineDetails.currentProcess?.cavity_count || 1;
    // 화면에 표시되는 교대별 CAPA(공정 미설정 시 0으로 표시되는 것 포함)를 각각 계산 후 합산하여,
    // 일일 합계 CAPA 표시값과 항상 일치시킨다 (F3)
    const dayCapacity = !dayShiftOff && tactTimeSeconds
      ? calculateCapacity(tactTimeSeconds, dayShiftOperatingMinutes, breakTimeMinutes, cavityCount)
      : 0;
    const nightCapacity = !nightShiftOff && tactTimeSeconds
      ? calculateCapacity(tactTimeSeconds, nightShiftOperatingMinutes, breakTimeMinutes, cavityCount)
      : 0;
    const plannedCapacity = dayCapacity + nightCapacity;

    // OEE 계산 (휴무 교대조 제외) - 서버가 저장하는 값과 동일한 정의를 사용한다.
    //   계획 가동시간 = 가동시간 - 휴식시간
    //   실 가동시간   = max(0, 계획 가동시간 - 비가동시간)
    //   성능          = 이론 가동시간(생산량 기준) / 실 가동시간
    const dayPlannedRuntime = !dayShiftOff ? calculatePlannedRuntime(dayShiftOperatingMinutes) : 0;
    const nightPlannedRuntime = !nightShiftOff ? calculatePlannedRuntime(nightShiftOperatingMinutes) : 0;
    const dayActualRuntime = Math.max(
      0,
      dayPlannedRuntime - (!dayShiftOff ? dayShiftData.total_downtime_minutes : 0)
    );
    const nightActualRuntime = Math.max(
      0,
      nightPlannedRuntime - (!nightShiftOff ? nightShiftData.total_downtime_minutes : 0)
    );

    const plannedOperatingTime = dayPlannedRuntime + nightPlannedRuntime; // 분 단위
    const actualOperatingTime = dayActualRuntime + nightActualRuntime;
    const idealRuntime = tactTimeSeconds
      ? (totalProduction / Math.max(1, cavityCount)) * tactTimeSeconds / 60
      : 0;

    const availability = plannedOperatingTime > 0 ? actualOperatingTime / plannedOperatingTime : 0;
    const performance = actualOperatingTime > 0 ? Math.min(1, idealRuntime / actualOperatingTime) : 0;
    const quality = totalProduction > 0 ? totalGoodQuantity / totalProduction : 1;
    const oee = availability * performance * quality;

    return {
      machine_id: selectedMachineId || '',
      date: selectedDate,
      day_shift: dayShiftData,
      day_shift_off: dayShiftOff,
      night_shift: nightShiftData,
      night_shift_off: nightShiftOff,
      total_production: totalProduction,
      total_defects: totalDefects,
      total_good_quantity: totalGoodQuantity,
      total_downtime_minutes: totalDowntime,
      planned_capacity: plannedCapacity,
      availability: Math.max(0, Math.min(1, availability)),
      performance: Math.max(0, Math.min(1, performance)),
      quality: Math.max(0, Math.min(1, quality)),
      oee: Math.max(0, Math.min(1, oee))
    };
  };

  // 교대별 불량 수량이 생산 수량을 초과하는지 검증 (F4)
  const isDayQuantityInvalid = !dayShiftOff && dayShiftData.defect_quantity > dayShiftData.actual_production;
  const isNightQuantityInvalid = !nightShiftOff && nightShiftData.defect_quantity > nightShiftData.actual_production;

  /**
   * 이 교대를 서버로 전송할지 판정한다.
   *
   * false 를 반환하면 페이로드에서 해당 교대가 생략되고, 서버는 그 교대를 건드리지 않는다
   * (신규 저장도, 기존 기록 삭제도 하지 않음).
   *
   * 이 판정이 필요한 이유: 폼은 항상 주간/야간 두 교대의 state 를 들고 있으므로, 사용자가
   * 주간만 입력해도 야간이 0 으로 함께 전송되어 output_qty=0 / oee=0 인 유령 레코드가 생긴다.
   * (실제로 2026-07-13 하루에만 야간조 314건이 이렇게 생성되어 그날 평균 OEE 를 0 으로 끌어내렸다)
   *
   * @param shiftData     해당 교대의 폼 입력값
   * @param isOff         해당 교대가 '휴무'로 체크되었는지 (휴무는 별도 처리되므로 여기서 판정 불필요)
   * @param existingRecord 이미 저장되어 있는 기록 (없으면 null)
   */
  const shouldSubmitShift = (
    shiftData: ShiftProductionData,
    isOff: boolean,
    existingRecord: ExistingProductionRecord | null,
    workingZeroConfirmed: boolean
  ): boolean => {
    // 휴무는 서버가 기존 기록을 삭제해야 하므로 반드시 전송한다.
    if (isOff) return true;

    // 이미 저장된 기록이 있으면 사용자가 수정 중이므로 항상 전송한다.
    // (0으로 정정하는 경우도 정당한 수정이다)
    if (existingRecord) return true;

    // 신규 생산 입력인데 수량을 건드리지 않았으면 전송하지 않는다.
    // 비가동은 생산실적과 독립된 사건이며 이미 별도 API로 저장되므로, 비가동만
    // 있다는 이유로 output=0 생산 레코드나 WORKING 교대 상태를 만들지 않는다.
    return (
      shiftData.actual_production > 0 ||
      shiftData.defect_quantity > 0 ||
      workingZeroConfirmed
    );
  };

  // 데이터 저장
  const handleSave = async () => {
    // 확인 모달을 기다리는 동안에는 loading 이 아직 false 라 저장 버튼이 계속 눌린다.
    // 그대로 두면 클릭할 때마다 확인 모달이 새로 쌓이고, 각각이 저장을 시도한다.
    if (savingRef.current) {
      return;
    }

    if (!selectedMachineId) {
      message.error(t('messages.selectMachine'));
      return;
    }

    // 저장 전 교차 검증: 불량 수량이 생산 수량보다 클 수 없음 (F4)
    if (isDayQuantityInvalid || isNightQuantityInvalid) {
      message.error(t('recordList.editModal.defectExceedsOutput'));
      return;
    }

    // 기존 생산 기록 조회 실패를 "기록 없음"으로 취급하면 다른 교대를 저장하는 순간
    // 실패한 교대의 기존 데이터가 삭제될 수 있다. 전체 조회가 성공하기 전에는 저장하지 않는다.
    if (productionRecordsLoadFailed) {
      message.error(t('recordList.loadFailedBlockSave'));
      return;
    }

    savingRef.current = true;

    try {
      setLoading(true);

      // MANDATORY API CONTRACT: 서버가 availability/performance/quality/oee/planned_capacity를
      // 자체 계산하므로, 클라이언트가 계산한 지표는 전송하지 않고 원시 입력값만 보낸다.
      const payload: DailyProductionSavePayload = {
        machine_id: selectedMachineId,
        date: selectedDate,
        day_shift_off: dayShiftOff,
        night_shift_off: nightShiftOff,
        // 입력되지 않은 교대는 아예 생략한다 (0으로 채워 보내면 유령 레코드가 생김)
        ...(shouldSubmitShift(dayShiftData, dayShiftOff, existingDayRecord, dayShiftWorkingConfirmed) && {
          day_shift: {
            actual_production: dayShiftData.actual_production,
            defect_quantity: dayShiftData.defect_quantity,
            operating_minutes: dayShiftOperatingMinutes,
            downtime_confirmed: dayShiftData.total_downtime_minutes > 0 || dayZeroDowntimeConfirmed,
          }
        }),
        ...(shouldSubmitShift(nightShiftData, nightShiftOff, existingNightRecord, nightShiftWorkingConfirmed) && {
          night_shift: {
            actual_production: nightShiftData.actual_production,
            defect_quantity: nightShiftData.defect_quantity,
            operating_minutes: nightShiftOperatingMinutes,
            downtime_confirmed: nightShiftData.total_downtime_minutes > 0 || nightZeroDowntimeConfirmed,
          }
        })
      };

      console.log('Saving daily production data:', payload);

      const response = await authFetch('/api/production-records/daily', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const result = await response.json();

      // 삭제된 교대 기록이 있으면 메시지에 함께 안내 (F5)
      const deletedCount = Array.isArray(result.deleted_shifts) ? result.deleted_shifts.length : 0;
      const deletedSuffix = deletedCount > 0
        ? t('messages.deletedShiftsSuffix', { count: deletedCount })
        : '';

      if (result.is_holiday || result.records_saved === 0) {
        // 실제로 저장된 기록이 없는 경우 (양쪽 교대 모두 휴무 등) 성공 토스트를 띄우지 않는다 (F5)
        message.warning(`${result.message || t('messages.noRecordsSaved')}${deletedSuffix}`);
      } else {
        message.success(`${result.message || t('messages.productionDataSaved')}${deletedSuffix}`);
      }

      // 폼 초기화 (수량뿐 아니라 휴무 여부/가동시간도 초기화하여 다음 입력에 값이 남지 않도록 함) (F1)
      setSelectedMachineId(null);
      setDayShiftOff(false);
      setNightShiftOff(false);
      setDayShiftWorkingConfirmed(false);
      setNightShiftWorkingConfirmed(false);
      setDayZeroDowntimeConfirmed(false);
      setNightZeroDowntimeConfirmed(false);
      setDayShiftOperatingMinutes(720);
      setNightShiftOperatingMinutes(720);
      setDayShiftData({
        shift: 'DAY',
        shift_name: t('shift.dayShift'),
        start_time: '08:00',
        end_time: '20:00',
        operator_name: '',
        actual_production: 0,
        defect_quantity: 0,
        good_quantity: 0,
        downtime_entries: [],
        total_downtime_minutes: 0
      });
      setNightShiftData({
        shift: 'NIGHT',
        shift_name: t('shift.nightShift'),
        start_time: '20:00',
        end_time: '08:00',
        operator_name: '',
        actual_production: 0,
        defect_quantity: 0,
        good_quantity: 0,
        downtime_entries: [],
        total_downtime_minutes: 0
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error saving data:', error);
      message.error(`${t('messages.saveFailed')}: ${errorMessage}`);
    } finally {
      savingRef.current = false;
      setLoading(false);
    }
  };

  // 비가동 시간 테이블 컬럼
  const downtimeColumns = [
    {
      title: t('dataEntry.startTime'),
      dataIndex: 'start_time',
      key: 'start_time',
      render: (time: string) => dayjs(time).format('YYYY-MM-DD HH:mm')
    },
    {
      title: t('dataEntry.endTime'),
      dataIndex: 'end_time',
      key: 'end_time',
      render: (time: string) => time ? dayjs(time).format('YYYY-MM-DD HH:mm') : t('dataEntry.ongoing')
    },
    {
      title: t('dataEntry.downtime'),
      dataIndex: 'duration_minutes',
      key: 'duration_minutes',
      render: (_minutes: number | null, record: DowntimeEntry) => (
        <Space>
          <Text>
            {record.end_time
              ? `${downtimeMinutesAt(record)}${t('schedule.minutes')}`
              : t('dataEntry.ongoing')}
          </Text>
          {record.id && record.created_at && (
            <Badge status="success" text="저장됨" />
          )}
        </Space>
      )
    },
    {
      title: t('dataEntry.reason'),
      dataIndex: 'reason',
      key: 'reason',
      render: (reason: string) => translateReason(reason)
    },
    {
      title: t('dataEntry.work'),
      key: 'actions',
      render: (_: unknown, record: VersionedDowntimeEntry) => (
        <Space>
          {!record.end_time && (
            <Button
              type="link"
              size="small"
              loading={downtimeSubmitting}
              onClick={() => closeDowntimeEntry(record)}
            >
              {t('common.close')}
            </Button>
          )}
          <Popconfirm
            title={t('downtime.deleteConfirm')}
            onConfirm={() => removeDowntimeEntry(record)}
            okText={t('downtime.delete')}
            cancelText={t('downtime.cancel')}
          >
            <Button type="link" danger icon={<DeleteOutlined />} size="small">
              {t('downtime.delete')}
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  const currentShiftData = getCurrentShiftData();
  const dailyData = calculateDailyData();
  const selectedMachine = getSelectedMachine();

  return (
    <div>
      {/* 설비 선택 및 날짜 */}
      <Card title={t('dataInputForm.machineSelection')} size="small" style={{ marginBottom: '16px' }}>
        <Row gutter={[16, 0]} align="middle">
          <Col xs={24} sm={12}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Text strong>{t('dataInputForm.machine')}</Text>
              <Select
                placeholder={t('dataInputForm.machineSelectPlaceholder')}
                loading={machinesLoading}
                onChange={handleMachineSelect}
                value={selectedMachineId}
                style={{ width: '100%' }}
                showSearch
                optionFilterProp="children"
                size="large"
              >
                {machines.map((machine) => (
                  <Option key={machine.id} value={machine.id}>
                    {machine.name}
                    <span style={{ color: '#8c8c8c', fontSize: '12px', marginLeft: '8px' }}>
                      - {formatMachineLocation(machine.location, t)}
                    </span>
                  </Option>
                ))}
              </Select>
              {machinesError && (
                <Alert message={t('messages.machineLoadingError')} type="error" showIcon />
              )}
            </Space>
          </Col>
          <Col xs={24} sm={12}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Text strong>{t('dataInputForm.selectedDate')}</Text>
              <DatePicker
                value={dayjs(selectedDate)}
                onChange={(date) => setSelectedDate(date?.format('YYYY-MM-DD') || dayjs().format('YYYY-MM-DD'))}
                style={{ width: '100%' }}
                size="large"
                format="YYYY-MM-DD"
              />
            </Space>
          </Col>
        </Row>
      </Card>

      {/* 설비 정보 표시 */}
      {selectedMachine && (
        <Card 
          title={t('dataInputForm.machineInfo')} 
          size="small" 
          style={{ marginBottom: '16px' }}
        >
          {machineDetails.error && (
            <Alert
              message={t('messages.machineInfoLoadFailed')}
              description={machineDetails.error}
              type="error"
              showIcon
              style={{ marginBottom: '16px' }}
            />
          )}
          <Descriptions column={2} size="small">
            {/* 왼쪽 컬럼 */}
            <Descriptions.Item label={t('machineInfo.productionModel')} span={1}>
              {machineDetails.loading ? (
                <Text type="secondary">{t('machineInfo.loadingText')}</Text>
              ) : machineDetails.productionModel ? (
                <Text code>{machineDetails.productionModel.model_name}</Text>
              ) : (
                <Text type="secondary">{t('machineInfo.noSetting')}</Text>
              )}
            </Descriptions.Item>
            
            {/* 오른쪽 컬럼 */}
            <Descriptions.Item label={t('shift.dayShiftBaseOperatingTime')} span={1}>
              <Space direction="vertical" size="small" style={{ width: '100%' }}>
                <Space>
                  <InputNumber
                    value={dayShiftOperatingMinutes}
                    onChange={(value) => setDayShiftOperatingMinutes(value ?? DEFAULT_OPERATING_MINUTES)}
                    min={0}
                    max={720}
                    addonAfter={t('common.minutes')}
                    style={{ width: 120 }}
                    disabled={dayShiftOff}
                  />
                  <Checkbox 
                    checked={dayShiftOff} 
                    onChange={(e) => {
                      setDayShiftOff(e.target.checked);
                      if (e.target.checked) {
                        setDayShiftWorkingConfirmed(false);
                        setDayZeroDowntimeConfirmed(false);
                      }
                    }}
                  >
                    {t('common.off')}
                  </Checkbox>
                  <Checkbox
                    checked={dayShiftWorkingConfirmed}
                    disabled={dayShiftOff}
                    onChange={(event) => setDayShiftWorkingConfirmed(event.target.checked)}
                  >
                    {t('shift.workingZeroConfirmed')}
                  </Checkbox>
                  {!dayShiftOff && dayShiftData.total_downtime_minutes === 0 && (
                    <Checkbox
                      checked={dayZeroDowntimeConfirmed}
                      disabled={downtimeLoadFailed.DAY}
                      onChange={(event) => setDayZeroDowntimeConfirmed(event.target.checked)}
                    >
                      {t('downtime.confirmZeroOk')}
                    </Checkbox>
                  )}
                </Space>
                {!dayShiftOff && (
                  <div>
                    <Text type="secondary" style={{ fontSize: '12px' }}>
                      ({Math.floor(dayShiftOperatingMinutes / 60)}{t('common.hours')} {dayShiftOperatingMinutes % 60}{t('common.minutes')} - {t('shift.breakTime')} {breakTimeMinutes}{t('common.minutes')} = {calculatePlannedRuntime(dayShiftOperatingMinutes)}{t('common.minutes')})
                    </Text>
                    <Text strong style={{ color: '#1890ff', marginLeft: 8 }}>
                      CAPA: {machineDetails.currentProcess?.tact_time_seconds
                        ? calculateCapacity(machineDetails.currentProcess.tact_time_seconds, dayShiftOperatingMinutes, breakTimeMinutes, machineDetails.currentProcess.cavity_count || 1)
                        : 0
                      }{t('common.pieces')}
                    </Text>
                  </div>
                )}
                {dayShiftOff && <Text type="secondary"> ({t('common.off')})</Text>}
              </Space>
            </Descriptions.Item>

            <Descriptions.Item label={t('machineInfo.process')} span={1}>
              {machineDetails.loading ? (
                <Text type="secondary">{t('machineInfo.loadingText')}</Text>
              ) : machineDetails.currentProcess ? (
                <Text code>{machineDetails.currentProcess.process_name}</Text>
              ) : (
                <Text type="secondary">{t('machineInfo.noSetting')}</Text>
              )}
            </Descriptions.Item>

            <Descriptions.Item label={t('shift.nightShiftBaseOperatingTime')} span={1}>
              <Space direction="vertical" size="small" style={{ width: '100%' }}>
                <Space>
                  <InputNumber
                    value={nightShiftOperatingMinutes}
                    onChange={(value) => setNightShiftOperatingMinutes(value ?? DEFAULT_OPERATING_MINUTES)}
                    min={0}
                    max={720}
                    addonAfter={t('common.minutes')}
                    style={{ width: 120 }}
                    disabled={nightShiftOff}
                  />
                  <Checkbox 
                    checked={nightShiftOff} 
                    onChange={(e) => {
                      setNightShiftOff(e.target.checked);
                      if (e.target.checked) {
                        setNightShiftWorkingConfirmed(false);
                        setNightZeroDowntimeConfirmed(false);
                      }
                    }}
                  >
                    {t('common.off')}
                  </Checkbox>
                  <Checkbox
                    checked={nightShiftWorkingConfirmed}
                    disabled={nightShiftOff}
                    onChange={(event) => setNightShiftWorkingConfirmed(event.target.checked)}
                  >
                    {t('shift.workingZeroConfirmed')}
                  </Checkbox>
                  {!nightShiftOff && nightShiftData.total_downtime_minutes === 0 && (
                    <Checkbox
                      checked={nightZeroDowntimeConfirmed}
                      disabled={downtimeLoadFailed.NIGHT}
                      onChange={(event) => setNightZeroDowntimeConfirmed(event.target.checked)}
                    >
                      {t('downtime.confirmZeroOk')}
                    </Checkbox>
                  )}
                </Space>
                {!nightShiftOff && (
                  <div>
                    <Text type="secondary" style={{ fontSize: '12px' }}>
                      ({Math.floor(nightShiftOperatingMinutes / 60)}{t('common.hours')} {nightShiftOperatingMinutes % 60}{t('common.minutes')} - {t('shift.breakTime')} {breakTimeMinutes}{t('common.minutes')} = {calculatePlannedRuntime(nightShiftOperatingMinutes)}{t('common.minutes')})
                    </Text>
                    <Text strong style={{ color: '#1890ff', marginLeft: 8 }}>
                      CAPA: {machineDetails.currentProcess?.tact_time_seconds
                        ? calculateCapacity(machineDetails.currentProcess.tact_time_seconds, nightShiftOperatingMinutes, breakTimeMinutes, machineDetails.currentProcess.cavity_count || 1)
                        : 0
                      }{t('common.pieces')}
                    </Text>
                  </div>
                )}
                {nightShiftOff && <Text type="secondary"> ({t('common.off')})</Text>}
              </Space>
            </Descriptions.Item>

            <Descriptions.Item label="Tact Time" span={1}>
              {machineDetails.loading ? (
                <Text type="secondary">{t('machineInfo.loadingText')}</Text>
              ) : machineDetails.currentProcess?.tact_time_seconds ? (
                <Text code>{machineDetails.currentProcess.tact_time_seconds}{t('common.seconds')}</Text>
              ) : (
                <Text type="secondary">{t('machineInfo.noSetting')}</Text>
              )}
            </Descriptions.Item>

            <Descriptions.Item label={t('schedule.dailyTotalCapa')} span={1}>
              <Text strong style={{ color: '#52c41a', fontSize: '16px' }}>
                {/* 화면에 표시되는 두 교대별 CAPA의 합과 항상 일치하도록 dailyData.planned_capacity를 그대로 사용 (F3) */}
                {dailyData.planned_capacity}{t('common.pieces')}
              </Text>
            </Descriptions.Item>

            <Descriptions.Item label={t('machineInfo.machineStatus')} span={2}>
              <Badge 
                status={selectedMachine.current_state === 'NORMAL_OPERATION' ? 'processing' : 'error'} 
                text={selectedMachine.current_state === 'NORMAL_OPERATION' ? t('machineInfo.normalOperation') : t('machineInfo.abnormal')}
              />
            </Descriptions.Item>
          </Descriptions>
        </Card>
      )}

      {/* 기존 생산 기록 알림 */}
      {selectedMachineId && (existingDayRecord || existingNightRecord) && (
        <Alert
          message={t('editMode.existingRecordFound')}
          description={
            <div>
              <Text>{t('editMode.existingRecordDescription')}</Text>
              <div style={{ marginTop: 8 }}>
                {existingDayRecord && (
                  <div style={{ marginBottom: 4 }}>
                    <Text type="secondary">{t('editMode.dayShiftRecordId')}: </Text>
                    <Text code>{existingDayRecord.record_id}</Text>
                    <Button
                      type="link"
                      danger
                      size="small"
                      icon={<DeleteOutlined />}
                      onClick={() => handleDeleteRecord(existingDayRecord.record_id, 'DAY')}
                      loading={loading}
                      style={{ marginLeft: 8 }}
                    >
                      {t('editMode.deleteRecord')}
                    </Button>
                  </div>
                )}
                {existingNightRecord && (
                  <div>
                    <Text type="secondary">{t('editMode.nightShiftRecordId')}: </Text>
                    <Text code>{existingNightRecord.record_id}</Text>
                    <Button
                      type="link"
                      danger
                      size="small"
                      icon={<DeleteOutlined />}
                      onClick={() => handleDeleteRecord(existingNightRecord.record_id, 'NIGHT')}
                      loading={loading}
                      style={{ marginLeft: 8 }}
                    >
                      {t('editMode.deleteRecord')}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          }
          type="warning"
          showIcon
          style={{ marginBottom: '16px' }}
        />
      )}

      {/* 기존 생산 기록 조회 실패 경고 (저장 차단) */}
      {selectedMachineId && productionRecordsLoadFailed && (
        <Alert
          message={t('recordList.loadFailedTitle')}
          description={t('recordList.loadFailedDescription')}
          type="error"
          showIcon
          style={{ marginBottom: '16px' }}
        />
      )}

      {/* 비가동 조회 실패 경고 (저장 차단) */}
      {selectedMachineId && (downtimeLoadFailed.DAY || downtimeLoadFailed.NIGHT) && (
        <Alert
          message={t('downtime.loadFailedTitle')}
          description={t('downtime.loadFailedDescription')}
          type="error"
          showIcon
          style={{ marginBottom: '16px' }}
          action={
            <Button
              size="small"
              danger
              onClick={() => {
                const requestId = ++loadRequestIdRef.current;
                if (downtimeLoadFailed.DAY) {
                  loadDowntimeEntries(selectedMachineId, selectedDate, 'DAY', requestId);
                }
                if (downtimeLoadFailed.NIGHT) {
                  loadDowntimeEntries(selectedMachineId, selectedDate, 'NIGHT', requestId);
                }
              }}
            >
              {t('downtime.retryLoad')}
            </Button>
          }
        />
      )}

      {/* 기존 기록 로딩 표시 */}
      {loadingExistingRecords && (
        <Alert
          message={t('recordList.checkingExistingRecords')}
          type="info"
          showIcon
          style={{ marginBottom: '16px' }}
        />
      )}

      {/* 교대별 데이터 입력 */}
      {selectedMachineId && (
        <Card
          title={t('dataEntry.shiftDataInput')}
          size="small"
          style={{ marginBottom: '16px' }}
        >
          <Tabs 
            activeKey={activeShift} 
            onChange={(key) => setActiveShift(key as 'DAY' | 'NIGHT')}
            items={[
              {
                key: 'DAY',
                label: (
                  <span>
                    <SunOutlined />
                    {t('shift.dayShiftTime')}
                    {dayShiftOff && (
                      <Badge status="default" text={t('common.off')} style={{ marginLeft: 8 }} />
                    )}
                    {!dayShiftOff && dayShiftData.actual_production > 0 && (
                      <Badge count={dayShiftData.actual_production} style={{ marginLeft: 8 }} />
                    )}
                  </span>
                ),
                children: (
                  <div style={{ opacity: dayShiftOff ? 0.5 : 1 }}>
                    {dayShiftOff && (
                      <Alert
                        message={t('shift.dayShiftOff')}
                        description={t('shift.dayShiftOffDescription')}
                        type="info"
                        showIcon
                        style={{ marginBottom: 16 }}
                      />
                    )}
                    <Row gutter={[16, 16]}>
                      <Col xs={24}>
                        <Space direction="vertical" style={{ width: '100%' }}>
                          <Text strong>{t('dataEntry.actualProduction')}</Text>
                          <InputNumber
                            style={{ width: '100%' }}
                            placeholder="480"
                            value={dayShiftData.actual_production}
                            onChange={(value) => handleProductionChange('actual_production', value || 0)}
                            addonAfter={t('common.pieces')}
                            disabled={dayShiftOff}
                            min={0}
                            precision={0}
                          />
                        </Space>
                      </Col>
                    </Row>

                    <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
                      <Col xs={24} sm={12}>
                        <Space direction="vertical" style={{ width: '100%' }}>
                          <Text strong>{t('dataEntry.defects')}</Text>
                          <InputNumber
                            style={{ width: '100%' }}
                            placeholder="5"
                            value={dayShiftData.defect_quantity}
                            onChange={(value) => handleProductionChange('defect_quantity', value || 0)}
                            addonAfter={t('common.pieces')}
                            disabled={dayShiftOff}
                            min={0}
                            precision={0}
                            status={isDayQuantityInvalid ? 'error' : undefined}
                          />
                          {isDayQuantityInvalid && (
                            <Text type="danger" style={{ fontSize: 12 }}>
                              {t('recordList.editModal.defectExceedsOutput')}
                            </Text>
                          )}
                        </Space>
                      </Col>
                      <Col xs={24} sm={12}>
                        <Space direction="vertical" style={{ width: '100%' }}>
                          <Text strong>{t('dataEntry.goodQuantity')}</Text>
                          <InputNumber
                            style={{ width: '100%' }}
                            value={dayShiftData.good_quantity}
                            addonAfter={t('common.pieces')}
                            readOnly
                            disabled={dayShiftOff}
                          />
                        </Space>
                      </Col>
                    </Row>
                  </div>
                )
              },
              {
                key: 'NIGHT',
                label: (
                  <span>
                    <MoonOutlined />
                    {t('shift.nightShiftTime')}
                    {nightShiftOff && (
                      <Badge status="default" text={t('common.off')} style={{ marginLeft: 8 }} />
                    )}
                    {!nightShiftOff && nightShiftData.actual_production > 0 && (
                      <Badge count={nightShiftData.actual_production} style={{ marginLeft: 8 }} />
                    )}
                  </span>
                ),
                children: (
                  <div style={{ opacity: nightShiftOff ? 0.5 : 1 }}>
                    {nightShiftOff && (
                      <Alert
                        message={t('shift.nightShiftOff')}
                        description={t('shift.nightShiftOffDescription')}
                        type="info"
                        showIcon
                        style={{ marginBottom: 16 }}
                      />
                    )}
                    <Row gutter={[16, 16]}>
                      <Col xs={24}>
                        <Space direction="vertical" style={{ width: '100%' }}>
                          <Text strong>{t('dataEntry.actualProduction')}</Text>
                          <InputNumber
                            style={{ width: '100%' }}
                            placeholder="480"
                            value={nightShiftData.actual_production}
                            onChange={(value) => handleProductionChange('actual_production', value || 0)}
                            addonAfter={t('common.pieces')}
                            disabled={nightShiftOff}
                            min={0}
                            precision={0}
                          />
                        </Space>
                      </Col>
                    </Row>

                    <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
                      <Col xs={24} sm={12}>
                        <Space direction="vertical" style={{ width: '100%' }}>
                          <Text strong>{t('dataEntry.defects')}</Text>
                          <InputNumber
                            style={{ width: '100%' }}
                            placeholder="5"
                            value={nightShiftData.defect_quantity}
                            onChange={(value) => handleProductionChange('defect_quantity', value || 0)}
                            addonAfter={t('common.pieces')}
                            disabled={nightShiftOff}
                            min={0}
                            precision={0}
                            status={isNightQuantityInvalid ? 'error' : undefined}
                          />
                          {isNightQuantityInvalid && (
                            <Text type="danger" style={{ fontSize: 12 }}>
                              {t('recordList.editModal.defectExceedsOutput')}
                            </Text>
                          )}
                        </Space>
                      </Col>
                      <Col xs={24} sm={12}>
                        <Space direction="vertical" style={{ width: '100%' }}>
                          <Text strong>{t('dataEntry.goodQuantity')}</Text>
                          <InputNumber
                            style={{ width: '100%' }}
                            value={nightShiftData.good_quantity}
                            addonAfter={t('common.pieces')}
                            readOnly
                            disabled={nightShiftOff}
                          />
                        </Space>
                      </Col>
                    </Row>
                  </div>
                )
              }
            ]}
          />
        </Card>
      )}

      {/* 비가동 시간 */}
      {selectedMachineId && (
        <Card 
          title={`${t('downtime.downtimeTitle')} - ${activeShift === 'DAY' ? t('shift.dayShift') : t('shift.nightShift')}`}
          size="small" 
          style={{ marginBottom: '16px' }}
          extra={
            <Button 
              type="primary" 
              icon={<ClockCircleOutlined />} 
              size="small"
              onClick={() => {
                downtimeCreateIdRef.current = null;
                setDowntimeModalVisible(true);
              }}
            >
              {t('downtime.addDowntime')}
            </Button>
          }
        >
          <Table
            dataSource={currentShiftData.downtime_entries}
            columns={downtimeColumns}
            rowKey={(record) => record.id || `temp-${record.start_time}`}
            size="small"
            pagination={false}
            loading={loadingDowntime}
            locale={{ emptyText: t('downtime.noDowntimeRecords') }}
            summary={() => (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={2}>
                  <Text strong>{t('dataEntry.totalDowntime')}</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={2}>
                  <Text strong>{currentShiftData.total_downtime_minutes}{t('common.minutes')}</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={3} colSpan={2} />
              </Table.Summary.Row>
            )}
          />
        </Card>
      )}

      {/* 일일 요약 */}
      {selectedMachineId && (dayShiftData.actual_production > 0 || nightShiftData.actual_production > 0) && (
        <Card title={t('common.dailySummary')} size="small" style={{ marginBottom: '24px' }}>
          <Row gutter={[16, 16]}>
            <Col xs={12} sm={6}>
              <div style={{ textAlign: 'center' }}>
                <Text type="secondary">{t('dataEntry.production')}</Text>
                <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#1890ff' }}>
                  {dailyData.total_production}{t('common.pieces')}
                </div>
              </div>
            </Col>
            <Col xs={12} sm={6}>
              <div style={{ textAlign: 'center' }}>
                <Text type="secondary">{t('dataEntry.defects')}</Text>
                <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#ff4d4f' }}>
                  {dailyData.total_defects}{t('common.pieces')}
                </div>
              </div>
            </Col>
            <Col xs={12} sm={6}>
              <div style={{ textAlign: 'center' }}>
                <Text type="secondary">{t('dataEntry.totalDowntime')}</Text>
                <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#faad14' }}>
                  {dailyData.total_downtime_minutes}{t('common.minutes')}
                </div>
              </div>
            </Col>
            <Col xs={12} sm={6}>
              <div style={{ textAlign: 'center' }}>
                <Text type="secondary">OEE</Text>
                <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#52c41a' }}>
                  {(dailyData.oee * 100).toFixed(1)}%
                </div>
              </div>
            </Col>
          </Row>
        </Card>
      )}

      {/* 저장 버튼 */}
      {selectedMachineId && (
        <div style={{ textAlign: 'center' }}>
          <Button
            type="primary"
            htmlType="submit"
            loading={loading || loadingSelectionData}
            disabled={loadingSelectionData || loadingExistingRecords || loadingDowntime}
            icon={<SaveOutlined />}
            size="large"
            onClick={handleSave}
          >
            {(existingDayRecord || existingNightRecord)
              ? t('editMode.updateData')
              : t('editMode.newRecord')
            }
          </Button>
        </div>
      )}

      {/* 비가동 시간 추가 모달 */}
      <Modal
        title={`${t('downtime.modalTitle')} - ${activeShift === 'DAY' ? t('shift.dayShift') : t('shift.nightShift')}`}
        open={downtimeModalVisible}
        onCancel={() => {
          setDowntimeModalVisible(false);
          downtimeForm.resetFields();
        }}
        footer={null}
      >
        <Form
          form={downtimeForm}
          layout="vertical"
          onFinish={(values) => {
            // DatePicker의 dayjs 객체를 ISO string으로 변환
            const formattedValues = {
              ...values,
              start_time: values.start_time ? values.start_time.toISOString() : undefined,
              end_time: values.end_time ? values.end_time.toISOString() : undefined
            };
            addDowntimeEntry(formattedValues);
          }}
          initialValues={{
            start_time: dayjs(`${selectedDate} ${activeShift === 'DAY' ? '10:00' : '22:00'}`),
            end_time: null
          }}
        >
          <Form.Item
            name="start_time"
            label={t('downtime.startTimeLabel')}
            rules={[{ required: true, message: t('downtime.selectStartTime') }]}
          >
            <DatePicker
              showTime={{ format: 'HH:mm' }}
              format="YYYY-MM-DD HH:mm"
              style={{ width: '100%' }}
              placeholder={t('downtime.selectStartTime')}
            />
          </Form.Item>

          <Form.Item
            name="end_time"
            label={t('downtime.endTimeLabel')}
          >
            <DatePicker
              showTime={{ format: 'HH:mm' }}
              format="YYYY-MM-DD HH:mm"
              style={{ width: '100%' }}
              placeholder={t('common.defaultTimeNote')}
            />
          </Form.Item>

          <Form.Item
            name="reason"
            label={t('downtime.selectReason')}
            rules={[{ required: true, message: t('downtime.selectReason') }]}
          >
            <Select placeholder={t('downtime.selectReason')}>
              {downtimeReasons.map((reasonKey) => (
                <Option key={reasonKey} value={reasonKey}>
                  {translateReason(reasonKey)}
                </Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            name="description"
            label={t('downtime.detailDescription')}
          >
            <TextArea
              rows={3}
              placeholder={t('downtime.detailPlaceholder')}
            />
          </Form.Item>

          <div style={{ textAlign: 'right' }}>
            <Space>
              <Button
                onClick={() => {
                  setDowntimeModalVisible(false);
                  downtimeForm.resetFields();
                }}
                disabled={downtimeSubmitting}
              >
                {t('downtime.cancel')}
              </Button>
              <Button type="primary" htmlType="submit" loading={downtimeSubmitting} disabled={downtimeSubmitting}>
                {t('downtime.add')}
              </Button>
            </Space>
          </div>
        </Form>
      </Modal>
    </div>
  );
};

export default ShiftDataInputForm;
