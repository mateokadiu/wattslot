import { describe, expect, it } from 'vitest';
import { toIcs } from '../src/lib/ics';

const event = {
  uid: 'job-1-0@wattslot.mateokadiu.com',
  sequence: 2,
  startMs: Date.UTC(2026, 10, 2, 1, 45),
  endMs: Date.UTC(2026, 10, 2, 3, 45),
  title: 'Kør opvaskemaskinen',
  description: 'Planlagt af wattslot · 1,88 kr.; billigst',
  url: 'https://wattslot.mateokadiu.com/da/',
};

describe('toIcs', () => {
  const ics = toIcs([event], Date.UTC(2026, 10, 1, 20, 0, 5));
  const lines = ics.split('\r\n');

  it('writes a calendar with CRLF line endings and UTC times', () => {
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(lines).toContain('DTSTART:20261102T014500Z');
    expect(lines).toContain('DTEND:20261102T034500Z');
    expect(lines).toContain('DTSTAMP:20261101T200005Z');
    expect(lines).toContain('SEQUENCE:2');
    expect(lines).toContain('TRIGGER:PT0M');
  });

  it('escapes commas and semicolons in text', () => {
    expect(ics).toContain('DESCRIPTION:Planlagt af wattslot · 1\\,88 kr.; billigst');
  });

  it('folds lines longer than 75 octets', () => {
    const long = toIcs([{ ...event, description: 'æ'.repeat(60) }], 0);
    for (const line of long.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(long).toContain('\r\n æ');
  });
});
