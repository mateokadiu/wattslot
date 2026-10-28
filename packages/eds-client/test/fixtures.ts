import { readFileSync } from 'node:fs';

export function fixture(name: string): unknown {
  const url = new URL(`../../../fixtures/eds/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8'));
}

export function fixtureText(name: string): string {
  return readFileSync(new URL(`../../../fixtures/eds/${name}`, import.meta.url), 'utf8');
}
