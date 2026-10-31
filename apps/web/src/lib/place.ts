'use client';

import { useMemo, useSyncExternalStore } from 'react';

// "My place": the price area and grid company a visitor has chosen, kept in this browser only
// (see the privacy page). The live view, the header and the grid company pages share it.

const KEY = 'wattslot:prefs';
const CHANGED = 'wattslot:prefs-changed';

/** Everything the site remembers; the live view also keeps its task and chart mode here. */
export interface StoredPrefs {
  zone?: string;
  gln?: string;
  task?: string;
  mode?: string;
  /** Grid company name, for showing the place without loading the company list. */
  name?: string | null;
  /** True once the visitor picked the area or company themselves (not a default or a shared link). */
  chosen?: boolean;
}

export interface Place {
  zone: string;
  gln: string;
  name: string | null;
}

export function readPrefs(): StoredPrefs {
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as StoredPrefs;
  } catch {
    return {};
  }
}

export function writePrefs(prefs: StoredPrefs): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // private browsing: preferences just aren't remembered
  }
  window.dispatchEvent(new Event(CHANGED));
}

/** Remember a place the visitor chose, keeping their other preferences. */
export function choosePlace(place: Place): void {
  writePrefs({ ...readPrefs(), ...place, chosen: true });
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('storage', onChange);
  window.addEventListener(CHANGED, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(CHANGED, onChange);
  };
}

const snapshot = (): string | null => {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

/** The chosen place, or null (also during server rendering and before the visitor chooses). */
export function usePlace(): Place | null {
  const raw = useSyncExternalStore(subscribe, snapshot, () => null);
  return useMemo(() => {
    if (!raw) return null;
    try {
      const p = JSON.parse(raw) as StoredPrefs;
      return p.chosen && p.zone ? { zone: p.zone, gln: p.gln ?? '', name: p.name ?? null } : null;
    } catch {
      return null;
    }
  }, [raw]);
}
