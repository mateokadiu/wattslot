'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { PLAN_TEXT } from '@/content/plan';
import type { Locale } from '@/lib/i18n';
import {
  disablePush,
  enablePush,
  onPushChanged,
  type PushState,
  pushState,
  pushSupport,
} from '@/lib/push';

// "Notify me on this device": turns notifications for saved plans on or off for this browser.
// Shows nothing where notifications can't work, and the Home Screen hint on iPhone and iPad.

type Note = 'denied' | 'error' | 'too-many' | null;

export function NotifyControl({ locale }: { locale: Locale }) {
  const p = PLAN_TEXT[locale];
  const [state, setState] = useState<PushState | 'ios-install' | null>(null);
  const [note, setNote] = useState<Note>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (pushSupport() === 'ios-install') {
      setState('ios-install');
      return;
    }
    const check = () => {
      pushState().then(setState);
    };
    check();
    return onPushChanged(check);
  }, []);

  if (state === null || state === 'unavailable') return null;
  if (state === 'ios-install') return <p className="text-xs text-[var(--muted)]">{p.iosHint}</p>;
  if (state === 'denied') return <p className="text-xs text-[var(--muted)]">{p.notifyDenied}</p>;

  if (state === 'on') {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <p role="status" style={{ color: 'var(--accent)' }}>
          ✓ {p.notifyOn}
        </p>
        <Button
          type="button"
          variant="outline"
          className="h-9 rounded-lg"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await disablePush();
            setState('off');
            setBusy(false);
          }}
        >
          {p.notifyTurnOff}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        className="h-10 rounded-lg"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setNote(null);
          const result = await enablePush();
          setBusy(false);
          if (result === 'on') setState('on');
          else if (result === 'off') setState('unavailable');
          else
            setNote(result === 'denied' ? 'denied' : result === 'too-many' ? 'too-many' : 'error');
        }}
      >
        {p.notify}
      </Button>
      {note && (
        <p role="alert" className="text-xs">
          {note === 'denied'
            ? p.notifyDenied
            : note === 'too-many'
              ? p.tooManyDevices
              : p.notifyError}
        </p>
      )}
    </div>
  );
}
