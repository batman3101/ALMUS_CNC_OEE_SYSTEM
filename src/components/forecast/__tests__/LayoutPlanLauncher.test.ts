import { mappingItemsToSave } from '../layoutPlanMappings';

describe('model pairing save (audit BUG-05)', () => {
  it('sends a removal for a pairing that was saved and has been cleared, and skips rows that were never paired', () => {
    expect(mappingItemsToSave([
      { forecastModel: 'AliasA', productModelId: null, savedModelId: 'm-a' },        // cleared → remove on the server
      { forecastModel: 'AliasB', productModelId: 'm-b', savedModelId: null },        // new pairing
      { forecastModel: 'AliasC', productModelId: 'm-c', savedModelId: 'm-old' },     // changed pairing
      { forecastModel: 'AliasD', productModelId: null, savedModelId: null },         // never paired, still empty → nothing to send
    ])).toEqual([
      { forecastModel: 'AliasA', productModelId: null },
      { forecastModel: 'AliasB', productModelId: 'm-b' },
      { forecastModel: 'AliasC', productModelId: 'm-c' },
    ]);
  });
});
