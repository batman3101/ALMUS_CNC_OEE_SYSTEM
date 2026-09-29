import { supabaseAdmin } from '@/lib/supabase-admin';
import { loadForecastCapacityPolicy } from '@/lib/forecast/capacityPolicy';
import { loadForecastCapacitySnapshot } from '@/lib/forecast/capacitySnapshot';
import type { FactoryForecastPreview, ForecastPreview } from '@/types/forecast';

/** The part of a preview that comes from the file. Machines, T/T and the capacity policy are deliberately not here. */
type StoredPreview = Pick<ForecastPreview, 'dates' | 'rows' | 'summary'>;

interface SubmissionRow {
  file_name: string; source_hash: string; parser_version: string; sheet: string; preview: StoredPreview; submitted_at: string;
}

/**
 * Attach today's factory state to a file-derived preview.
 * The "before" layout is always the live `machines` table — never the state at inspection or submission time —
 * so a stored Forecast re-read after setup work has progressed is simulated against the machines as they are now.
 */
async function withLiveFactoryState(factory: { id: string; code: string }, fileName: string, preview: ForecastPreview): Promise<FactoryForecastPreview> {
  const [capacityPolicy, capacitySnapshot] = await Promise.all([loadForecastCapacityPolicy(factory.id), loadForecastCapacitySnapshot(factory.id)]);
  return { ...preview, factory, fileName, capacityPolicy, capacitySnapshot };
}

/** One row per factory: accepting a new Forecast replaces the previous one (user decision 2026-09-29). */
export async function saveForecastSubmission(factory: { id: string; code: string }, userId: string, fileName: string, preview: ForecastPreview): Promise<FactoryForecastPreview> {
  const stored: StoredPreview = { dates: preview.dates, rows: preview.rows, summary: preview.summary };
  const { data, error } = await supabaseAdmin.from('forecast_submissions').upsert({
    factory_id: factory.id, file_name: fileName, source_hash: preview.sourceHash, parser_version: preview.parserVersion, sheet: preview.sheet,
    preview: stored, submitted_by: userId, submitted_at: new Date().toISOString(),
  }, { onConflict: 'factory_id' }).select('submitted_at').single();
  if (error) throw error;
  return { ...(await withLiveFactoryState(factory, fileName, preview)), submission: { submittedAt: data.submitted_at as string } };
}

export async function loadForecastSubmission(factory: { id: string; code: string }): Promise<FactoryForecastPreview | null> {
  const { data, error } = await supabaseAdmin.from('forecast_submissions')
    .select('file_name, source_hash, parser_version, sheet, preview, submitted_at').eq('factory_id', factory.id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as SubmissionRow;
  const preview: ForecastPreview = {
    parserVersion: row.parser_version as ForecastPreview['parserVersion'], sourceHash: row.source_hash, sheet: row.sheet,
    dates: row.preview.dates, rows: row.preview.rows, summary: row.preview.summary, requiresReview: true, capacityValidated: false,
  };
  return { ...(await withLiveFactoryState(factory, row.file_name, preview)), submission: { submittedAt: row.submitted_at } };
}
