import { calculateCapacity, calculateDailyCapacity } from '../productionCapacity';

describe('existing OEE CAPA contract shared with Forecast', () => {
  it.each([[72, 720, 110, 508], [120, 720, 60, 330], [120, 0, 60, 0], [120, 720, 0, 360], [120, 30, 60, 0]])(
    'T/T %s, operating %s, break %s gives %s pieces', (tt, operating, rest, expected) => {
      expect(calculateCapacity(tt, operating, rest)).toBe(expected);
    });
  it('preserves existing valid input-form outputs across different shifts and T/T', () => {
    for (const tt of [1, 17, 72, 115.2, 576]) for (const operating of [0, 480, 610, 720]) for (const rest of [0, 60, 110]) {
      const legacy = !tt || !operating ? 0 : Math.floor((Math.max(0, operating - rest) * 60) / tt);
      expect(calculateCapacity(tt, operating, rest)).toBe(legacy);
    }
  });
  it('floors each shift before summing; no cavity or efficiency applied twice', () => {
    expect(calculateDailyCapacity(72, [{ operatingMinutes: 720, breakMinutes: 110 }, { operatingMinutes: 720, breakMinutes: 110 }])).toBe(1016);
  });
  it.each([0, -1, NaN, Infinity])('does not invent CAPA from invalid T/T %s', tt => expect(calculateCapacity(tt, 720, 110)).toBe(0));
});
