// D1-compatible wrapper over a synchronous SQLite handle (node:sqlite DatabaseSync in dev and tests).
// Only the subset of the D1 API this app uses is implemented.

export interface SqliteStatementLike {
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): { changes?: number | bigint; lastInsertRowid?: number | bigint };
  get(...params: unknown[]): unknown;
}

export interface SqliteLike {
  prepare(sql: string): SqliteStatementLike;
  exec(sql: string): void;
}

type Row = Record<string, unknown>;

/** SQLite does not bind booleans or undefined; map them the way D1 does. */
function coerce(v: unknown): unknown {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

const READ_RE = /^\s*(select|with|pragma)\b/i;

class Statement implements D1PreparedStatement {
  constructor(
    private readonly sqlite: SqliteLike,
    readonly sql: string,
    readonly params: unknown[] = [],
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    return new Statement(this.sqlite, this.sql, values.map(coerce));
  }

  async first<T = unknown>(colName?: string): Promise<T | null> {
    const row = this.sqlite.prepare(this.sql).get(...this.params) as Row | undefined;
    if (!row) return null;
    if (colName !== undefined) return (row[colName] ?? null) as T;
    return row as T;
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    return execute<T>(this.sqlite, this.sql, this.params);
  }

  async run<T = unknown>(): Promise<D1Result<T>> {
    return execute<T>(this.sqlite, this.sql, this.params);
  }
}

function execute<T>(sqlite: SqliteLike, sql: string, params: unknown[]): D1Result<T> {
  const stmt = sqlite.prepare(sql);
  if (READ_RE.test(sql)) {
    return { results: stmt.all(...params) as T[], success: true, meta: {} };
  }
  const info = stmt.run(...params);
  return {
    results: [],
    success: true,
    meta: {
      changes: Number(info.changes ?? 0),
      last_row_id: Number(info.lastInsertRowid ?? 0),
    },
  };
}

class SqliteD1 implements D1Database {
  constructor(private readonly sqlite: SqliteLike) {}

  prepare(query: string): D1PreparedStatement {
    return new Statement(this.sqlite, query);
  }

  /** Runs the statements in one transaction, like D1 batch(). */
  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    this.sqlite.exec('BEGIN');
    try {
      const out: D1Result<T>[] = [];
      for (const s of statements) {
        const st = s as Statement;
        out.push(execute<T>(this.sqlite, st.sql, st.params));
      }
      this.sqlite.exec('COMMIT');
      return out;
    } catch (err) {
      this.sqlite.exec('ROLLBACK');
      throw err;
    }
  }

  async exec(query: string): Promise<unknown> {
    this.sqlite.exec(query);
    return { count: 0, duration: 0 };
  }
}

export function createD1(sqlite: SqliteLike): D1Database {
  return new SqliteD1(sqlite);
}
