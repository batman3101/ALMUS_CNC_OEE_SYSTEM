/** Forecast source values remain distinct until a user resolves input policies. */
export type ForecastValueState = 'number' | 'blank' | 'error' | 'missing_cache' | 'invalid';
export type ForecastIssueCode =
  | 'missing_model' | 'missing_vendor' | 'unsupported_process' | 'duplicate_row'
  | 'blank' | 'error' | 'missing_cache' | 'invalid' | 'fractional';

export interface ForecastQuantity {
  date: string;
  cell: string;
  state: ForecastValueState;
  quantity: number | null;
  formula: boolean;
  error: string | null;
}

export interface ForecastSourceRow {
  sourceRow: number;
  model: string;
  displayModel: string;
  vendor: string;
  processGroup: string;
  processLabel: string;
  /** Same source quantity is needed at each listed process, not divided. */
  processes: Array<'CNC1' | 'CNC2'>;
  issues: ForecastIssueCode[];
  quantities: ForecastQuantity[];
}

export interface ForecastPreview {
  parserVersion: 'almus-v1';
  sourceHash: string;
  sheet: string;
  dates: string[];
  rows: ForecastSourceRow[];
  summary: {
    sourceRows: number;
    excludedRows: number;
    models: number;
    formulaCells: number;
    numericTotal: number;
    states: Record<ForecastValueState, number>;
    fractionalCells: number;
    rowIssues: number;
  };
  requiresReview: true;
  /** Parsing is never approval to remove machines or publish a layout. */
  capacityValidated: false;
}

export interface FactoryForecastPreview extends ForecastPreview {
  factory: { id: string; code: string };
  fileName: string;
  capacityPolicy: ForecastCapacityPolicy;
  capacitySnapshot: ForecastCapacitySnapshot;
}

export type ForecastCapacityPolicy = { status: 'unavailable' } | {
  status: 'available';
  source: 'oee_settings';
  timezone: string;
  shiftAStart: string;
  shiftBStart: string;
  breakMinutes: number;
  separateEfficiencyMultiplier: false;
};

/** CNC0 exists only on some models (e.g. H8); it takes the same quantity as CNC1/CNC2 when present. */
export type ForecastProcess = 'CNC0' | 'CNC1' | 'CNC2';

export interface ForecastSnapshotModel {
  id: string; name: string; isActive: boolean;
  processes: Array<{ id: string; name: string; order: number; tactTimeSeconds: number | null }>;
}
export interface ForecastSnapshotMachine {
  id: string; name: string; location: string; isActive: boolean; modelId: string | null; processId: string | null;
}
/** Read-only factory state taken when the file was inspected; never a layout to apply. */
export type ForecastCapacitySnapshot = { status: 'unavailable' } | {
  status: 'available'; takenAt: string; models: ForecastSnapshotModel[]; machines: ForecastSnapshotMachine[];
};
