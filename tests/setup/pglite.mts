// Test-runner global setup: boots a single PGlite + socket server in the
// parent process and tears it down once all test files finish. The
// connection URL is exported via process.env.DATABASE_URL so each forked
// test worker inherits it and the unchanged @prisma/adapter-pg can connect.
//
// Loaded via `node --test-global-setup ./tests/setup/pglite.mts`.

import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..');

let server: PGLiteSocketServer | null = null;
let db: PGlite | null = null;

export async function globalSetup(): Promise<void> {
    db = await PGlite.create();
    server = new PGLiteSocketServer({
        db,
        host: '127.0.0.1',
        port: 0,
        // Each test worker is a separate process opening its own pool;
        // keep this comfortably above Prisma's default pool size.
        maxConnections: 100,
    });
    await server.start();
    const port = Number(server.getServerConn().split(':').pop());

    // Apply migrations in lexicographic order — same order Prisma applies them.
    // Iterating the directory keeps this future-proof against new migrations.
    const migrationsRoot = resolve(PROJECT_ROOT, 'prisma', 'migrations');
    const migrationDirs = (await readdir(migrationsRoot, { withFileTypes: true }))
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort();
    for (const dir of migrationDirs) {
        const sql = await readFile(resolve(migrationsRoot, dir, 'migration.sql'), 'utf8');
        await db.exec(sql);
    }

    // Critical: workers inherit env at fork time. Set this BEFORE they start.
    process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`;
}

export async function globalTeardown(): Promise<void> {
    if (server) {
        try { await server.stop(); } catch { /* ignore */ }
    }
    if (db) {
        try { await db.close(); } catch { /* ignore */ }
    }
}
