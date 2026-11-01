// A saved plan as an iCalendar file (RFC 5545), made in the browser: one event per run, with a
// reminder when it starts. The calendar feed that follows every plan comes later (PLAN.md §17.7).

export interface IcsEvent {
  /** Stable per plan and run, so importing a newer version replaces the older one. */
  uid: string;
  sequence: number;
  startMs: number;
  endMs: number;
  title: string;
  description: string;
  url: string;
}

const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');

/** Text values escape backslashes, semicolons, commas and newlines (RFC 5545 §3.3.11). */
const text = (value: string) =>
  value.replace(/\\/g, '\\\\').replace(/;/g, ';').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Lines longer than 75 octets fold onto continuation lines that start with a space (§3.1). */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let size = 0;
  for (const char of line) {
    const length = new TextEncoder().encode(char).length;
    if (size + length > (parts.length === 0 ? 75 : 74)) {
      parts.push(current);
      current = '';
      size = 0;
    }
    current += char;
    size += length;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

export function toIcs(events: readonly IcsEvent[], nowMs: number): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//wattslot//plans//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...events.flatMap((e) => [
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `SEQUENCE:${e.sequence}`,
      `DTSTAMP:${stamp(nowMs)}`,
      `DTSTART:${stamp(e.startMs)}`,
      `DTEND:${stamp(e.endMs)}`,
      `SUMMARY:${text(e.title)}`,
      `DESCRIPTION:${text(e.description)}`,
      `URL:${e.url}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'TRIGGER:PT0M',
      `DESCRIPTION:${text(e.title)}`,
      'END:VALARM',
      'END:VEVENT',
    ]),
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

/** Offers the file as a download. */
export function downloadIcs(filename: string, ics: string) {
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
