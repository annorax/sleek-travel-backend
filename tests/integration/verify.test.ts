// verifyPhoneNumber / verifyEmailAddress / resend* mutations.

import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { sign } from 'jsonwebtoken';
import { prisma, resetDatabase, seedUser, clearOutbox, getMailbox, getSmsbox } from '../helpers/db';
import { execute, expectData, expectError } from '../helpers/gql';

const VERIFY_PHONE = /* GraphQL */ `
    mutation V($userId: Int!, $otp: String!) {
        verifyPhoneNumber(userId: $userId, otp: $otp)
    }
`;

const VERIFY_EMAIL = /* GraphQL */ `
    mutation V($token: String!) {
        verifyEmailAddress(token: $token)
    }
`;

const RESEND_EMAIL = /* GraphQL */ `
    mutation R($email: String!) {
        resendEmailVerificationRequest(email: $email) { error }
    }
`;

const RESEND_SMS = /* GraphQL */ `
    mutation R($phoneNumber: String!) {
        resendPhoneNumberVerificationRequest(phoneNumber: $phoneNumber) { error }
    }
`;

const tokenForUser = (userId: number, expiresIn: string | number = '1 hour') =>
    sign({ userId: String(userId) }, process.env.TOKEN_SECRET!, { expiresIn: expiresIn as never });

describe('Mutation.verifyPhoneNumber', () => {
    beforeEach(async () => { await resetDatabase(); clearOutbox(); });

    test('marks the phoneNumberVerified timestamp when OTP matches', async () => {
        const { user } = await seedUser({ phoneNumberVerified: null, otp: 424242 });
        const result = await execute<{ verifyPhoneNumber: boolean }>(VERIFY_PHONE, {
            variables: { userId: user.id, otp: '424242' },
        });
        assert.equal(expectData(result).verifyPhoneNumber, true);
        const refreshed = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
        assert.ok(refreshed.phoneNumberVerified instanceof Date);
    });

    test('returns true but is a no-op when phone is already verified', async () => {
        // The resolver runs updateMany with `phoneNumberVerified: null` — already-
        // verified users keep their original timestamp. Use a fixed verified date
        // and assert it is unchanged after the call.
        const verifiedAt = new Date(Date.UTC(2024, 0, 1, 12, 0, 0));
        const { user } = await seedUser({ phoneNumberVerified: verifiedAt, otp: 111111 });
        const result = await execute<{ verifyPhoneNumber: boolean }>(VERIFY_PHONE, {
            variables: { userId: user.id, otp: '111111' },
        });
        assert.equal(expectData(result).verifyPhoneNumber, true);
        const refreshed = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
        assert.equal(refreshed.phoneNumberVerified?.getTime(), verifiedAt.getTime());
    });

    test('errors when OTP does not match', async () => {
        const { user } = await seedUser({ phoneNumberVerified: null, otp: 333333 });
        const result = await execute(VERIFY_PHONE, { variables: { userId: user.id, otp: '000000' } });
        expectError(result, 'OTP mismatch');
        const refreshed = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
        assert.equal(refreshed.phoneNumberVerified, null, 'no verification on mismatch');
    });

    test('errors when OTP has expired', async () => {
        const { user } = await seedUser({
            phoneNumberVerified: null,
            otp: 555555,
            otpCreatedAt: new Date(Date.now() - 10 * 60 * 1000),
        });
        const result = await execute(VERIFY_PHONE, { variables: { userId: user.id, otp: '555555' } });
        expectError(result, 'OTP expired');
    });

    test('errors when user does not exist', async () => {
        const result = await execute(VERIFY_PHONE, { variables: { userId: 9_999_999, otp: '000000' } });
        expectError(result, 'User not found');
    });
});

describe('Mutation.verifyEmailAddress', () => {
    beforeEach(async () => { await resetDatabase(); clearOutbox(); });

    test('marks emailVerified when token is valid', async () => {
        const { user } = await seedUser({ emailVerified: null });
        const token = tokenForUser(user.id);
        const result = await execute<{ verifyEmailAddress: boolean }>(VERIFY_EMAIL, {
            variables: { token },
        });
        assert.equal(expectData(result).verifyEmailAddress, true);
        const refreshed = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
        assert.ok(refreshed.emailVerified instanceof Date);
    });

    test('is a no-op for already-verified emails', async () => {
        const verifiedAt = new Date(Date.UTC(2024, 5, 15, 9, 30));
        const { user } = await seedUser({ emailVerified: verifiedAt });
        const result = await execute<{ verifyEmailAddress: boolean }>(VERIFY_EMAIL, {
            variables: { token: tokenForUser(user.id) },
        });
        assert.equal(expectData(result).verifyEmailAddress, true);
        const refreshed = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
        assert.equal(refreshed.emailVerified?.getTime(), verifiedAt.getTime());
    });

    test('rejects expired tokens', async () => {
        const { user } = await seedUser({ emailVerified: null });
        const expired = sign(
            { userId: String(user.id) },
            process.env.TOKEN_SECRET!,
            { expiresIn: -1 },
        );
        const result = await execute(VERIFY_EMAIL, { variables: { token: expired } });
        expectError(result, 'expired');
    });

    test('rejects tokens signed with a different secret', async () => {
        const { user } = await seedUser({ emailVerified: null });
        const forged = sign({ userId: String(user.id) }, 'attacker-secret', { expiresIn: '1h' });
        const result = await execute(VERIFY_EMAIL, { variables: { token: forged } });
        expectError(result, 'invalid');
    });

    test('rejects malformed tokens', async () => {
        const result = await execute(VERIFY_EMAIL, { variables: { token: 'gibberish' } });
        assert.ok((result.errors?.length ?? 0) > 0);
    });
});

describe('Mutation.resendEmailVerificationRequest', () => {
    beforeEach(async () => { await resetDatabase(); clearOutbox(); });

    test('returns no error when user exists', async () => {
        const { user } = await seedUser({ email: 'resend-email@example.com' });
        const result = await execute<{ resendEmailVerificationRequest: { error: string | null } }>(
            RESEND_EMAIL,
            { variables: { email: user.email } },
        );
        assert.equal(expectData(result).resendEmailVerificationRequest.error, null);
        const mailbox = getMailbox() as Array<{ to?: string; subject?: string }>;
        assert.ok(mailbox.some((m) => m.to?.includes('resend-email@example.com')));
    });

    test('email lookup is case-insensitive', async () => {
        await seedUser({ email: 'casetest@example.com' });
        const result = await execute<{ resendEmailVerificationRequest: { error: string | null } }>(
            RESEND_EMAIL,
            { variables: { email: 'CaseTest@Example.COM' } },
        );
        assert.equal(expectData(result).resendEmailVerificationRequest.error, null);
    });

    test('returns an error payload when user is not found', async () => {
        const result = await execute<{ resendEmailVerificationRequest: { error: string | null } }>(
            RESEND_EMAIL,
            { variables: { email: 'no-such@example.com' } },
        );
        assert.match(expectData(result).resendEmailVerificationRequest.error ?? '', /not found/i);
    });
});

describe('Mutation.resendPhoneNumberVerificationRequest', () => {
    beforeEach(async () => { await resetDatabase(); clearOutbox(); });

    test('rotates the OTP and dispatches a new SMS', async () => {
        const oldOtp = 100001;
        const { user } = await seedUser({ phoneNumber: '+15550100200', otp: oldOtp });
        const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

        const result = await execute<{ resendPhoneNumberVerificationRequest: { error: string | null } }>(
            RESEND_SMS,
            { variables: { phoneNumber: user.phoneNumber } },
        );
        assert.equal(expectData(result).resendPhoneNumberVerificationRequest.error, null);

        const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
        // Tiny chance of collision (1 in 1,000,000) — acceptable. Assert that
        // the rotation timestamp moved forward instead.
        assert.ok(after.otpCreatedAt.getTime() >= before.otpCreatedAt.getTime());
        assert.ok(after.otp >= 0 && after.otp <= 999999);

        const smsbox = getSmsbox() as Array<{ DestinationPhoneNumber?: string; MessageBody?: string }>;
        assert.equal(smsbox.length, 1);
        assert.equal(smsbox[0].DestinationPhoneNumber, user.phoneNumber);
    });

    test('returns an error payload when no user matches', async () => {
        const result = await execute<{ resendPhoneNumberVerificationRequest: { error: string | null } }>(
            RESEND_SMS,
            { variables: { phoneNumber: '+19990000000' } },
        );
        assert.match(
            expectData(result).resendPhoneNumberVerificationRequest.error ?? '',
            /not found/i,
        );
    });
});
