import * as XLSX from 'xlsx';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 모델 정보 화면의 모든 모델·공정을 엑셀로 내보낸다 (사용자 요청 2026-09-29: 화면을 전체적으로 점검하려고).
 *
 * - **DB 에서 새로 읽는다.** 화면 상태(models/processes)를 재사용하지 않는다: '공정 관리'를 누르면 화면의 processes 가 그 모델의
 *   공정만 남아, 다른 모델의 '공정 수'가 0 으로 보인다. 그 상태를 그대로 내보내면 파일이 틀린다.
 * - **화면과 같은 범위(활성 모델)만** 낸다. 삭제한 모델은 is_active=false 로 남아 있지만 화면에 없다 - 파일이 화면과 어긋나면
 *   점검이 성립하지 않는다. 그 모델 소속 공정도 함께 뺀다(모델 시트에 없는 모델의 공정이 공정 시트에 있으면 안 된다).
 * - 읽기는 화면과 같은 클라이언트(RLS: 지금 선택한 공장)로 한다. 서버 API 를 새로 만들지 않는다.
 * - 값은 **저장된 그대로** 낸다. 화면은 캐비티를 count || 1 로 보이지만, 점검용 파일이 0 을 1 로 고쳐 보이면 결함이 숨는다.
 * - 이 라이브러리(xlsx 0.20.3)는 자동 필터는 쓰지만 첫 행 고정은 쓰지 못한다(파일을 풀어 확인).
 */

export interface ExportModelRow {
  id: string;
  model_name: string;
  description: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface ExportProcessRow {
  id: string;
  model_id: string;
  process_name: string;
  process_order: number;
  tact_time_seconds: number;
  cavity_count: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface ExportCounts { models: number; processes: number; excludedProcesses: number }

/** 엑셀에 찍히는 문구의 번역 키(modelInfo 네임스페이스). 한 곳에 모아 두면 ko/vi 양쪽에 다 있는지 테스트로 지킬 수 있다. */
export const EXPORT_LABEL_KEYS = {
  sheetModels: 'export.sheetModels',
  sheetProcesses: 'export.sheetProcesses',
  sheetInfo: 'export.sheetInfo',
  model: '컬럼.모델명',
  description: '컬럼.설명',
  processCount: '컬럼.공정수',
  createdAt: '컬럼.등록일',
  updatedAt: 'export.updatedAt',
  order: '컬럼.순서',
  process: '컬럼.공정명',
  tactTime: 'export.tactTime',
  cavity: '컬럼.캐비티수',
  infoItem: 'export.infoItem',
  infoValue: 'export.infoValue',
  infoFactory: 'export.infoFactory',
  infoExportedAt: 'export.infoExportedAt',
  infoModelCount: 'export.infoModelCount',
  infoProcessCount: 'export.infoProcessCount',
  infoExcluded: 'export.infoExcluded',
  infoScope: 'export.infoScope',
  infoScopeValue: 'export.infoScopeValue',
  infoTactUnit: 'export.infoTactUnit',
  infoTactUnitValue: 'export.infoTactUnitValue',
  infoCavity: 'export.infoCavity',
  infoCavityValue: 'export.infoCavityValue',
} as const;

export type ExportLabels = { [K in keyof typeof EXPORT_LABEL_KEYS]: string };
export type Translate = (key: string) => string;

export const exportLabels = (t: Translate): ExportLabels =>
  Object.fromEntries(Object.entries(EXPORT_LABEL_KEYS).map(([name, key]) => [name, t(key)])) as ExportLabels;

const pad = (n: number) => String(n).padStart(2, '0');

/** 사용자 화면의 시간대 기준 'YYYY-MM-DD HH:mm'. 비어 있으면 빈 칸, 읽을 수 없는 값은 원문 그대로(가리지 않는다). */
export function formatLocalDateTime(value: string | Date | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 읽기 상한. 이보다 많으면 일부만 읽은 것이므로 조용히 내보내지 않고 멈춘다(아래 잘림 검사). */
const READ_LIMIT = 10_000;

export class ModelInfoExportError extends Error {
  constructor(readonly reason: 'truncated') {
    super(reason);
    this.name = 'ModelInfoExportError';
  }
}

/**
 * 활성 모델과 (공장의) 모든 공정을 읽는다. 돌려받은 행이 전체 행 수보다 적으면 서버가 잘라서 준 것이다 -
 * PostgREST 는 200 으로 조용히 자르므로, 개수를 함께 받아 눈에 보이게 만든다. 개수를 못 받은 경우도 확인할 수 없으므로 멈춘다.
 */
export async function loadModelInfoForExport(client: SupabaseClient): Promise<{ models: ExportModelRow[]; processes: ExportProcessRow[] }> {
  const [models, processes] = await Promise.all([
    client.from('product_models')
      .select('id, model_name, description, created_at, updated_at', { count: 'exact' })
      .eq('is_active', true).order('model_name').limit(READ_LIMIT),
    client.from('model_processes')
      .select('id, model_id, process_name, process_order, tact_time_seconds, cavity_count, created_at, updated_at', { count: 'exact' })
      .order('process_order').limit(READ_LIMIT),
  ]);
  if (models.error) throw models.error;
  if (processes.error) throw processes.error;
  for (const page of [models, processes]) {
    if (page.count === null || (page.data?.length ?? 0) < page.count) throw new ModelInfoExportError('truncated');
  }
  return { models: (models.data ?? []) as ExportModelRow[], processes: (processes.data ?? []) as ExportProcessRow[] };
}

type Cell = string | number;

const byName = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** 엑셀 시트 이름 제약(31자·금지 문자)을 지킨다. */
const sheetName = (label: string) => label.replace(/[\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Sheet';

function sheetFrom(rows: Cell[][], widths: number[], filter: boolean): XLSX.WorkSheet {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = widths.map(wch => ({ wch }));
  if (filter) sheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: rows[0].length - 1 } }) };
  return sheet;
}

export interface BuildInput {
  models: readonly ExportModelRow[];
  processes: readonly ExportProcessRow[];
  labels: ExportLabels;
  factoryCode: string | null | undefined;
  exportedAt: Date;
}

/** 모델 시트 · 공정 시트 · 출력 정보 시트. 모델은 이름순(숫자는 크기순), 공정은 모델 안에서 순서대로. */
export function buildModelInfoWorkbook({ models, processes, labels, factoryCode, exportedAt }: BuildInput): { workbook: XLSX.WorkBook; counts: ExportCounts } {
  const sortedModels = [...models].sort((a, b) => byName.compare(a.model_name, b.model_name) || a.id.localeCompare(b.id));
  const known = new Set(sortedModels.map(model => model.id));
  const processesOf = new Map<string, ExportProcessRow[]>();
  let excluded = 0;
  for (const process of processes) {
    if (!known.has(process.model_id)) { excluded += 1; continue; }
    processesOf.set(process.model_id, [...(processesOf.get(process.model_id) ?? []), process]);
  }
  for (const list of processesOf.values()) {
    list.sort((a, b) => a.process_order - b.process_order || byName.compare(a.process_name, b.process_name) || a.id.localeCompare(b.id));
  }

  const modelRows: Cell[][] = sortedModels.map(model => [
    model.model_name, model.description ?? '', processesOf.get(model.id)?.length ?? 0,
    formatLocalDateTime(model.created_at), formatLocalDateTime(model.updated_at),
  ]);
  const processRows: Cell[][] = sortedModels.flatMap(model => (processesOf.get(model.id) ?? []).map(process => [
    model.model_name, process.process_order, process.process_name, process.tact_time_seconds, process.cavity_count,
    formatLocalDateTime(process.created_at), formatLocalDateTime(process.updated_at),
  ]));
  const counts: ExportCounts = { models: modelRows.length, processes: processRows.length, excludedProcesses: excluded };

  // 어느 공장의, 언제 읽은, 어떤 범위의 파일인지 - 파일만 남았을 때도 해석할 수 있게 한다.
  const info: Cell[][] = [
    [labels.infoItem, labels.infoValue],
    [labels.infoFactory, factoryCode || '-'],
    [labels.infoExportedAt, formatLocalDateTime(exportedAt)],
    [labels.infoModelCount, counts.models],
    [labels.infoProcessCount, counts.processes],
    [labels.infoExcluded, counts.excludedProcesses],
    [labels.infoScope, labels.infoScopeValue],
    [labels.infoTactUnit, labels.infoTactUnitValue],
    [labels.infoCavity, labels.infoCavityValue],
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheetFrom(
    [[labels.model, labels.description, labels.processCount, labels.createdAt, labels.updatedAt], ...modelRows], [26, 44, 12, 18, 18], true,
  ), sheetName(labels.sheetModels));
  XLSX.utils.book_append_sheet(workbook, sheetFrom(
    [[labels.model, labels.order, labels.process, labels.tactTime, labels.cavity, labels.createdAt, labels.updatedAt], ...processRows], [26, 8, 22, 18, 12, 18, 18], true,
  ), sheetName(labels.sheetProcesses));
  XLSX.utils.book_append_sheet(workbook, sheetFrom(info, [30, 70], false), sheetName(labels.sheetInfo));
  return { workbook, counts };
}

/** model-info_ALT_2026-09-29.xlsx - 공장 코드가 없으면 그 조각은 뺀다(짐작해서 채우지 않는다). */
export function modelInfoExportFilename(factoryCode: string | null | undefined, date: Date): string {
  const code = (factoryCode ?? '').replace(/[^A-Za-z0-9_-]/g, '');
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return ['model-info', code, day].filter(Boolean).join('_') + '.xlsx';
}

/** 읽기 → 만들기 → 내려받기. 화면이 동적 import 로 부른다 - xlsx 가 모델 정보 화면의 첫 로딩에 실리지 않게 한다. */
export async function exportModelInfo({ client, t, factoryCode, now = new Date() }: {
  client: SupabaseClient; t: Translate; factoryCode: string | null | undefined; now?: Date;
}): Promise<ExportCounts> {
  const { models, processes } = await loadModelInfoForExport(client);
  const { workbook, counts } = buildModelInfoWorkbook({ models, processes, labels: exportLabels(t), factoryCode, exportedAt: now });
  XLSX.writeFile(workbook, modelInfoExportFilename(factoryCode, now));
  return counts;
}
