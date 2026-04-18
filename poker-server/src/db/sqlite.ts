/**
 * SQLite connection + migration runner.
 *
 * Uses `better-sqlite3` — synchronous API, fastest Node SQLite binding,
 * ideal for a single-process server that needs write-through durability
 * for chat + hand messages.
 *
 * WAL mode + FK constraints + NORMAL sync is the standard "server"
 * profile: durable across crashes, ~10× faster than FULL sync, and
 * allows concurrent readers while a writer holds the journal.
 */

import Database from 'better-sqlite3';
import { readFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoped } from '../log.js';

const log = scoped('db');

/** The singleton DB handle. Use `openDb()` once, reuse everywhere. */
export type DB = Database.Database;

let instance: DB | null = null;

/**
 * Open (or reuse) the SQLite connection, run pragmas, and apply any
 * pending migrations from `migrations/*.sql` (sorted lexicographically).
 *
 * Every call with the same path returns the same Database instance.
 */
export function openDb(path: string): DB {
  if (instance) return instance;

  const absPath = resolve(path);
  // Ensure the parent directory exists — better-sqlite3 won't mkdir.
  const parent = dirname(absPath);
  if (!existsSync(parent)) {
    mkdirSync(parent, { recursive: true });
    log.info({ parent }, 'created db parent directory');
  }

  log.info({ path: absPath }, 'opening sqlite');
  const db = new Database(absPath);

  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  runMigrations(db);

  instance = db;
  return db;
}

/** Close the DB. Called from the graceful shutdown handler. */
export function closeDb(): void {
  if (instance) {
    log.info('closing sqlite');
    instance.close();
    instance = null;
  }
}

/**
 * Apply every migration file under `migrations/` that hasn't been run yet.
 * Tracked via the `__migrations` meta table (created on first run).
 */
function runMigrations(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS __migrations (
      name TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const migDir = resolveMigrationsDir();
  const files = listMigrationFiles(migDir);

  const applied = new Set<string>(
    (db.prepare<[], { name: string }>('SELECT name FROM __migrations').all() as { name: string }[])
      .map(r => r.name),
  );

  const insert = db.prepare('INSERT INTO __migrations(name, applied_at) VALUES (?, ?)');
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migDir, file), 'utf8');
    log.info({ file }, 'applying migration');
    db.transaction(() => {
      db.exec(sql);
      insert.run(file, Date.now());
    })();
  }
}

function resolveMigrationsDir(): string {
  // In dev: `poker-server/migrations`. In Docker runtime: `/app/migrations`.
  // Resolve relative to this file's location, then to the project root, then
  // pick whichever exists.
  const here = dirname(fileURLToPath(import.meta.url));

  const candidates = [
    resolve(here, '../../migrations'),   // compiled dist/src/db → ../../migrations
    resolve(here, '../migrations'),      // dev src/db → ../migrations (alt layout)
    resolve(process.cwd(), 'migrations'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error(`migrations directory not found; tried: ${candidates.join(', ')}`);
}

function listMigrationFiles(dir: string): string[] {
  // Only *.sql files, sorted for stable order.
  const files: string[] = readdirSync(dir);
  return files.filter(f => f.endsWith('.sql')).sort();
}
