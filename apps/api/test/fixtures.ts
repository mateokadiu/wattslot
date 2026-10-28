import { readFileSync } from 'node:fs';

export const fixtureText = (name: string): string =>
  readFileSync(new URL(`../../../fixtures/eds/${name}`, import.meta.url), 'utf8');

export const fixture = (name: string): unknown => JSON.parse(fixtureText(name));
