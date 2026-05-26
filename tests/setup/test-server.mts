// Long-running test server for the frontend integration test harness.
//
// Invoked via `npm run test:server`. The npm script supplies:
//   --import tsx                       — TypeScript loader
//   --import ./tests/setup/global.mts  — env defaults + nodemailer/SMS mocks
//   --experimental-test-module-mocks   — required for mock.module() in global.mts
// so by the time this script runs, the test environment (env vars, mocks) is
// in place. The script then boots its own PGlite instance, applies migrations,
// sets DATABASE_URL, and finally starts an Express app combining the
// production GraphQL endpoint with the /__test__ control router.
//
// Imports of src/* happen AFTER DATABASE_URL is set, because src/builder.ts
// reads it at module load to construct the Prisma adapter. The mocks
// installed by global.mts intercept src/auth.ts's top-level
// createTransport() / new PinpointSMSVoiceV2Client() calls the same way they
// do for unit tests.
//
// Stdout contract:
//   "TEST_SERVER_LISTENING url=http://127.0.0.1:<port>\n"   once ready
//   "TEST_SERVER_SHUTDOWN signal=<sig>\n"                   on graceful exit
// The spawning process reads stdout until the LISTENING line to discover
// the URL, then signals the process group to terminate when done.

import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..');

const db = await PGlite.create();
const dbServer = new PGLiteSocketServer({
    db,
    host: '127.0.0.1',
    port: 0,
    maxConnections: 100,
});
await dbServer.start();
const dbPort = Number(dbServer.getServerConn().split(':').pop());

const migrationsRoot = resolve(PROJECT_ROOT, 'prisma', 'migrations');
const migrationDirs = (await readdir(migrationsRoot, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
for (const dir of migrationDirs) {
    const sql = await readFile(resolve(migrationsRoot, dir, 'migration.sql'), 'utf8');
    await db.exec(sql);
}

process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${dbPort}/postgres`;

const { default: express } = await import('express');
const { createApp } = await import('../../src/app');
const { createTestControlRouter } = await import('../server/router');

const app = createApp();
app.use(express.json());
app.use('/__test__', createTestControlRouter());

const httpServer = app.listen(0, '127.0.0.1', () => {
    const address = httpServer.address();
    if (address === null || typeof address === 'string') {
        throw new Error('Unexpected server address');
    }
    process.stdout.write(`TEST_SERVER_LISTENING url=http://127.0.0.1:${address.port}\n`);
});

let shuttingDown = false;
const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stdout.write(`TEST_SERVER_SHUTDOWN signal=${signal}\n`);
    httpServer.close();
    try { await dbServer.stop(); } catch { /* ignore */ }
    try { await db.close(); } catch { /* ignore */ }
    process.exit(0);
};

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
