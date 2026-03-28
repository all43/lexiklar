export interface LexiklarSqlitePlugin {
  /**
   * Open a SQLite database file.
   * On first call, copies the bundled DB from app assets if needed.
   */
  open(options: { path: string; readOnly?: boolean }): Promise<void>;

  /**
   * Execute a SELECT query with optional bind parameters.
   * Returns rows as an array of key-value objects.
   */
  query(options: { sql: string; params?: unknown[] }): Promise<{ rows: Record<string, unknown>[] }>;

  /**
   * Execute one or more SQL statements (INSERT/UPDATE/DELETE/DDL).
   * Used for OTA patches. Runs in a transaction by default.
   */
  execute(options: { sql: string; transaction?: boolean }): Promise<{ changes: number }>;

  /**
   * Close the database connection.
   */
  close(): Promise<void>;

  /**
   * Delete the database file from disk.
   * Must be called after close() and before re-opening.
   */
  deleteDatabase(options: { path: string }): Promise<void>;

  /**
   * Get the full filesystem path where the plugin stores databases.
   * Useful for writing a new DB file via Filesystem plugin.
   */
  getDatabasePath(): Promise<{ path: string }>;
}
