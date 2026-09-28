/** One row of the model-pairing dialog. `savedModelId` is what the server had when the dialog opened. */
export interface PairingRow { forecastModel: string; productModelId: string | null; savedModelId: string | null }

/**
 * What to send to PUT /api/layout-planning/model-mappings.
 * A row whose saved pairing was cleared must be sent with `productModelId: null` — that is how the server deletes
 * it. Dropping such rows left the old pairing on the server and it came back on the next plan (audit BUG-05).
 * Rows that were never paired and are still empty have nothing to say and are left out.
 */
export function mappingItemsToSave(rows: PairingRow[]): Array<{ forecastModel: string; productModelId: string | null }> {
  return rows
    .filter(r => r.productModelId !== null || r.savedModelId !== null)
    .map(r => ({ forecastModel: r.forecastModel, productModelId: r.productModelId }));
}
