import { supabaseAdmin } from '@/lib/supabase-admin';
import { loadForecastCapacityPolicy } from '@/lib/forecast/capacityPolicy';
import { loadForecastCapacitySnapshot } from '@/lib/forecast/capacitySnapshot';
import { loadPoOverrides } from '@/lib/forecast/poOverrideStore';
import { mergePoOverrides } from '@/lib/forecast/poOverrides';
import type { FactoryForecastPreview, ForecastPreview } from '@/types/forecast';

/** The part of a preview that comes from the file. Machines, T/T and the capacity policy are deliberately not here. */
type StoredPreview = Pick<ForecastPreview, 'dates' | 'rows' | 'summary'>;

interface SubmissionRow {
  file_name: string; source_hash: string; parser_version: string; sheet: string; preview: StoredPreview; submitted_at: string; submission_id: string;
}

/**
 * Today's factory state, read fresh every time.
 * The "before" layout is always the live `machines` table — never the state at inspection or submission time —
 * so a stored Forecast re-read after setup work has progressed is simulated against the machines as they are now.
 */
async function liveFactoryState(factoryId: string) {
  const [capacityPolicy, capacitySnapshot] = await Promise.all([loadForecastCapacityPolicy(factoryId), loadForecastCapacitySnapshot(factoryId)]);
  return { capacityPolicy, capacitySnapshot };
}

/**
 * One row per factory: accepting a new Forecast replaces the previous one (user decision 2026-09-29).
 * The database gives every acceptance a new `submission_id` (trigger), and actual-PO edits belong to one id — so a newly
 * accepted file starts without any (user decision 2026-09-29: 새 접수 = 초기화). The returned preview therefore has none.
 */
export async function saveForecastSubmission(factory: { id: string; code: string }, userId: string, fileName: string, preview: ForecastPreview): Promise<FactoryForecastPreview> {
  const stored: StoredPreview = { dates: preview.dates, rows: preview.rows, summary: preview.summary };
  const { data, error } = await supabaseAdmin.from('forecast_submissions').upsert({
    factory_id: factory.id, file_name: fileName, source_hash: preview.sourceHash, parser_version: preview.parserVersion, sheet: preview.sheet,
    preview: stored, submitted_by: userId, submitted_at: new Date().toISOString(),
  }, { onConflict: 'factory_id' }).select('submitted_at, submission_id').single();
  if (error) throw error;
  return {
    ...preview, factory, fileName, ...(await liveFactoryState(factory.id)),
    submission: { submittedAt: data.submitted_at as string, submissionId: data.submission_id as string },
  };
}

export async function loadForecastSubmission(factory: { id: string; code: string }): Promise<FactoryForecastPreview | null> {
  const { data, error } = await supabaseAdmin.from('forecast_submissions')
    .select('file_name, source_hash, parser_version, sheet, preview, submitted_at, submission_id').eq('factory_id', factory.id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as SubmissionRow;
  // A failed lookup must not read as "no actual PO entered": the simulation would silently fall back to the Forecast.
  const [overrides, state] = await Promise.all([loadPoOverrides(factory.id, row.submission_id), liveFactoryState(factory.id)]);
  const preview: ForecastPreview = {
    parserVersion: row.parser_version as ForecastPreview['parserVersion'], sourceHash: row.source_hash, sheet: row.sheet,
    dates: row.preview.dates, rows: mergePoOverrides(row.preview.rows, overrides), summary: row.preview.summary, requiresReview: true, capacityValidated: false,
  };
  return { ...preview, factory, fileName: row.file_name, ...state, submission: { submittedAt: row.submitted_at, submissionId: row.submission_id } };
}
