/** Base class so callers can catch every client failure in one place. */
export class EdsError extends Error {
  constructor(
    message: string,
    readonly dataset: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** HTTP 429. EDS rate limits are per dataset and unpublished; the body says how long to wait. */
export class EdsRateLimitError extends EdsError {
  constructor(
    dataset: string,
    readonly retryAfterSeconds: number,
  ) {
    super(`${dataset}: rate limited, retry in ${retryAfterSeconds}s`, dataset);
  }
}

export class EdsHttpError extends EdsError {
  constructor(
    dataset: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(`${dataset}: HTTP ${status}`, dataset);
  }
}

/** The response didn't match the schema we rely on. Upstream changed; fail loudly. */
export class EdsSchemaError extends EdsError {
  constructor(
    dataset: string,
    readonly issues: readonly string[],
  ) {
    super(`${dataset}: unexpected response shape (${issues.slice(0, 3).join('; ')})`, dataset);
  }
}

/** The API reported more records than it returned. */
export class EdsTruncatedError extends EdsError {
  constructor(
    dataset: string,
    readonly total: number,
    readonly received: number,
  ) {
    super(`${dataset}: received ${received} of ${total} records`, dataset);
  }
}
