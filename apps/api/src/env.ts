export interface Env {
  DB: D1Database;
  /** `off` pauses the outage overview: no fetching, and the API says it is paused. */
  OUTAGES?: string;
}

export interface AppEnv {
  Bindings: Env;
}
