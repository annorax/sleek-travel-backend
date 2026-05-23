// Unit tests for src/auth.ts pure helpers.
//
// These cover password hashing/verification and OTP verification — the
// behaviors that don't require the rest of the GraphQL pipeline. Network-
// driven helpers (sendEmail*, sendPhone*) are exercised through the
// integration tests instead.

import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    hashPassword,
    comparePassword,
    verifyPhoneNumber,
    verifyEmailAddress,
    createLoginAndToken,
    expireAccessToken,
} from '../../src/auth';
import type { User } from '../../src/generated/prisma/client';
import { sign } from 'jsonwebtoken';
import { prisma, resetDatabase, seedUser } from '../helpers/db';

const fakeUser = (overrides: Partial<User> = {}): User => ({
    id: 1,
    name: 'X',
    email: 'x@example.com',
    phoneNumber: '+10000000000',
    password: 'irrelevant',
    role: 'NORMAL',
    otp: 42,
    otpCreatedAt: new Date(),
    emailVerified: null,
    phoneNumberVerified: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
} as User);

describe('hashPassword / comparePassword', () => {
    test('produces a salted hash that round-trips', async () => {
        const hash = await hashPassword('correct-horse-battery-staple');
        assert.ok(hash.includes('.'), 'hash should be "<hash>.<salt>"');
        assert.equal(await comparePassword(hash, 'correct-horse-battery-staple'), true);
    });

    test('rejects an incorrect password', async () => {
        const hash = await hashPassword('secret');
        assert.equal(await comparePassword(hash, 'wrong'), false);
    });

    test('produces different hashes for the same input (salting works)', async () => {
        const [a, b] = await Promise.all([hashPassword('same'), hashPassword('same')]);
        assert.notEqual(a, b);
        assert.equal(await comparePassword(a, 'same'), true);
        assert.equal(await comparePassword(b, 'same'), true);
    });

    test('handles empty and unicode passwords', async () => {
        const empty = await hashPassword('');
        assert.equal(await comparePassword(empty, ''), true);
        assert.equal(await comparePassword(empty, ' '), false);

        const unicode = '🔐 пароль パスワード';
        const uhash = await hashPassword(unicode);
        assert.equal(await comparePassword(uhash, unicode), true);
        assert.equal(await comparePassword(uhash, unicode + ' '), false);
    });

    test('handles very long passwords', async () => {
        const long = 'a'.repeat(10_000);
        const hash = await hashPassword(long);
        assert.equal(await comparePassword(hash, long), true);
    });
});

describe('verifyPhoneNumber', () => {
    test('accepts a matching, unexpired OTP', () => {
        const user = fakeUser({ otp: 654321, otpCreatedAt: new Date() });
        // No assertion needed — function throws on failure, returns undefined on success.
        verifyPhoneNumber(user, '654321');
    });

    test('rejects an OTP older than the expiration window', () => {
        const user = fakeUser({
            otp: 111111,
            // 10 minutes ago — well beyond the 5-minute window.
            otpCreatedAt: new Date(Date.now() - 10 * 60 * 1000),
        });
        assert.throws(() => verifyPhoneNumber(user, '111111'), /OTP expired/);
    });

    test('rejects a mismatched OTP', () => {
        const user = fakeUser({ otp: 222222, otpCreatedAt: new Date() });
        assert.throws(() => verifyPhoneNumber(user, '999999'), /OTP mismatch/);
    });

    test('rejects non-numeric OTP input by treating as mismatch', () => {
        const user = fakeUser({ otp: 123, otpCreatedAt: new Date() });
        assert.throws(() => verifyPhoneNumber(user, 'abc'), /OTP mismatch/);
    });
});

describe('verifyEmailAddress (JWT)', () => {
    test('returns the userId encoded in a valid token (coerced to Int)', () => {
        // createToken signs userId as a String; verifyEmailAddress must coerce
        // back to a number so Prisma's strict typing on the Int id accepts it.
        const token = sign(
            { userId: '42' },
            process.env.TOKEN_SECRET!,
            { expiresIn: '1 hour' },
        );
        const userId = verifyEmailAddress(token);
        assert.equal(userId, 42);
        assert.equal(typeof userId, 'number');
    });

    test('throws on tampered token', () => {
        const token = sign({ userId: '7' }, 'a-different-secret', { expiresIn: '1 hour' });
        assert.throws(() => verifyEmailAddress(token), /invalid signature|invalid token|jwt/i);
    });

    test('throws on expired token', () => {
        const token = sign({ userId: '7' }, process.env.TOKEN_SECRET!, { expiresIn: -1 });
        assert.throws(() => verifyEmailAddress(token), /expired/i);
    });

    test('throws on malformed token', () => {
        assert.throws(() => verifyEmailAddress('not-a-jwt'), /jwt|malformed|invalid/i);
    });
});

describe('createLoginAndToken / expireAccessToken', () => {
    beforeEach(resetDatabase);

    test('persists an access token and a login record', async () => {
        const { user } = await seedUser();
        const token = await createLoginAndToken(prisma, '203.0.113.7', user.id, true);

        const stored = await prisma.accessToken.findUnique({ where: { value: token } });
        assert.ok(stored, 'access token should be persisted');
        assert.equal(stored.userId, user.id);
        assert.equal(stored.expired, false);

        const logins = await prisma.login.findMany({ where: { userId: user.id } });
        assert.equal(logins.length, 1);
        assert.equal(logins[0].tokenValue, token);
        assert.equal(logins[0].explicit, true);
        assert.equal(logins[0].ipAddress, '203.0.113.7');
    });

    test('omits ipAddress when null is passed', async () => {
        const { user } = await seedUser();
        await createLoginAndToken(prisma, null, user.id, false);
        const logins = await prisma.login.findMany({ where: { userId: user.id } });
        assert.equal(logins.length, 1);
        assert.equal(logins[0].ipAddress, null);
        assert.equal(logins[0].explicit, false);
    });

    test('generates URL-safe base64 tokens that look opaque', async () => {
        const { user } = await seedUser();
        const t1 = await createLoginAndToken(prisma, null, user.id, true);
        const t2 = await createLoginAndToken(prisma, null, user.id, true);
        assert.notEqual(t1, t2);
        // base64url alphabet: A-Z a-z 0-9 - _
        assert.match(t1, /^[A-Za-z0-9_-]+$/);
        assert.match(t2, /^[A-Za-z0-9_-]+$/);
    });

    test('expireAccessToken flips the expired flag', async () => {
        const { user } = await seedUser();
        const token = await createLoginAndToken(prisma, null, user.id, true);
        await expireAccessToken(prisma, token);
        const stored = await prisma.accessToken.findUnique({ where: { value: token } });
        assert.equal(stored?.expired, true);
    });
});
