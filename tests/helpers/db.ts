// Helpers for resetting and seeding the test database.
//
// The truncate helper introspects information_schema so it works regardless
// of how many tables the Prisma schema currently has — adding a new model
// will not break tests.

import { after } from 'node:test';
import { prisma } from '../../src/builder';
import { hashPassword } from '../../src/auth';

export { prisma };

// Disconnect Prisma when the test file finishes so the worker process can
// exit cleanly. Registered at module load — any file that imports this
// helper gets the teardown for free. PGlite itself is torn down once,
// across all files, by tests/setup/pglite.mts's globalTeardown.
after(async () => {
    try {
        await prisma.$disconnect();
    } catch {
        /* ignore — process is exiting anyway */
    }
});

let cachedTableNames: string[] | null = null;

async function getApplicationTables(): Promise<string[]> {
    if (cachedTableNames) return cachedTableNames;
    const rows = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(
        `SELECT tablename FROM pg_tables
         WHERE schemaname = 'public'
           AND tablename NOT LIKE '_prisma_%'`,
    );
    cachedTableNames = rows.map((r) => r.tablename);
    return cachedTableNames;
}

/**
 * Wipe every application table and reset identity sequences so that
 * autoincrement IDs are predictable across test runs.
 */
export async function resetDatabase(): Promise<void> {
    const tables = await getApplicationTables();
    if (tables.length === 0) return;
    const quoted = tables.map((t) => `"${t}"`).join(', ');
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
}

// ── Convenience seed helpers ──────────────────────────────────────────────────

export type SeedUserOptions = {
    name?: string;
    email?: string;
    phoneNumber?: string;
    password?: string;
    role?: 'NORMAL' | 'ADMIN';
    emailVerified?: Date | null;
    phoneNumberVerified?: Date | null;
    otp?: number;
    otpCreatedAt?: Date;
};

const counters = { user: 0 };

export async function seedUser(opts: SeedUserOptions = {}) {
    counters.user += 1;
    const idx = counters.user;
    const now = new Date();
    const password = opts.password ?? 'correct-horse-battery-staple';
    const hashed = await hashPassword(password);
    const user = await prisma.user.create({
        data: {
            name: opts.name ?? `Test User ${idx}`,
            email: (opts.email ?? `user${idx}@example.com`).toLowerCase(),
            phoneNumber: opts.phoneNumber ?? `+100000000${String(idx).padStart(2, '0')}`,
            password: hashed,
            role: opts.role ?? 'NORMAL',
            emailVerified: opts.emailVerified === undefined ? now : opts.emailVerified,
            phoneNumberVerified:
                opts.phoneNumberVerified === undefined ? now : opts.phoneNumberVerified,
            otp: opts.otp ?? 123456,
            otpCreatedAt: opts.otpCreatedAt ?? now,
        },
    });
    return { user, plaintextPassword: password };
}

export async function issueAccessToken(userId: number, value?: string) {
    const tokenValue = value ?? `test-token-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    await prisma.accessToken.create({ data: { value: tokenValue, userId } });
    return tokenValue;
}

export async function seedProduct(overrides: Partial<{
    name: string;
    currency: 'EUR';
    price: number;
    brand: string;
    upc: string;
}> = {}) {
    const now = new Date();
    return prisma.product.create({
        data: {
            name: overrides.name ?? `Product ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            currency: overrides.currency ?? 'EUR',
            price: overrides.price ?? 9.99,
            brand: overrides.brand,
            upc: overrides.upc,
            updatedAt: now,
        },
    });
}

export function getMailbox() {
    return (globalThis as unknown as { __TEST_MAILBOX__: unknown[] }).__TEST_MAILBOX__;
}

export function getSmsbox() {
    return (globalThis as unknown as { __TEST_SMSBOX__: unknown[] }).__TEST_SMSBOX__;
}

export function clearOutbox() {
    const mailbox = getMailbox();
    const smsbox = getSmsbox();
    mailbox.length = 0;
    smsbox.length = 0;
}
