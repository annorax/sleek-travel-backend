// registerUser mutation: happy path, side effects, edge cases.

import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, clearOutbox, getMailbox, getSmsbox } from '../helpers/db';
import { execute, expectData } from '../helpers/gql';
import { comparePassword } from '../../src/auth';

const REGISTER = /* GraphQL */ `
    mutation Register($name: String!, $email: String!, $phoneNumber: String!, $password: String!) {
        registerUser(name: $name, email: $email, phoneNumber: $phoneNumber, password: $password) {
            userId
            error
        }
    }
`;

describe('Mutation.registerUser', () => {
    beforeEach(async () => {
        await resetDatabase();
        clearOutbox();
    });

    test('creates a user record and returns the new id', async () => {
        const result = await execute<{ registerUser: { userId: number | null; error: string | null } }>(
            REGISTER,
            {
                variables: {
                    name: 'Ada Lovelace',
                    email: 'ada@example.com',
                    phoneNumber: '+15551231234',
                    password: 'analytical-engine',
                },
            },
        );
        const { registerUser } = expectData(result);
        assert.ok(typeof registerUser.userId === 'number');
        assert.equal(registerUser.error, null);

        const stored = await prisma.user.findUniqueOrThrow({ where: { id: registerUser.userId! } });
        assert.equal(stored.email, 'ada@example.com');
        assert.equal(stored.name, 'Ada Lovelace');
        assert.equal(stored.phoneNumber, '+15551231234');
        assert.equal(stored.role, 'NORMAL');
        assert.equal(stored.emailVerified, null);
        assert.equal(stored.phoneNumberVerified, null);
        // Password is hashed, not stored as plaintext.
        assert.notEqual(stored.password, 'analytical-engine');
        assert.equal(await comparePassword(stored.password, 'analytical-engine'), true);
        // OTP is set and recent.
        assert.ok(stored.otp >= 0 && stored.otp <= 999999, 'OTP must be in [0, 999999]');
        const ageMs = Date.now() - stored.otpCreatedAt.getTime();
        assert.ok(ageMs >= 0 && ageMs < 5000, `OTP timestamp should be recent, age=${ageMs}ms`);
    });

    test('dispatches a verification email and SMS containing the OTP', async () => {
        await execute(REGISTER, {
            variables: {
                name: 'Grace Hopper',
                email: 'grace@example.com',
                phoneNumber: '+15558675309',
                password: 'cobol4eva',
            },
        });
        const mailbox = getMailbox() as Array<{ to?: string; subject?: string; text?: string }>;
        const smsbox = getSmsbox() as Array<{ DestinationPhoneNumber?: string; MessageBody?: string }>;
        assert.equal(mailbox.length, 1, 'should dispatch exactly one verification email');
        const mail = mailbox[0];
        assert.match(mail.to ?? '', /grace@example\.com/);
        assert.match(mail.subject ?? '', /activation/i);
        assert.match(mail.text ?? '', /verify-email\?token=/);

        assert.equal(smsbox.length, 1, 'should dispatch exactly one verification SMS');
        const sms = smsbox[0];
        assert.equal(sms.DestinationPhoneNumber, '+15558675309');
        const stored = await prisma.user.findUniqueOrThrow({ where: { email: 'grace@example.com' } });
        const otp6 = stored.otp.toString().padStart(6, '0');
        assert.match(sms.MessageBody ?? '', new RegExp(otp6));
    });

    test('stores email lowercased even when input is mixed-case', async () => {
        await execute(REGISTER, {
            variables: {
                name: 'Mixed',
                email: 'MiXeD@Example.COM',
                phoneNumber: '+15550001111',
                password: 'p',
            },
        });
        const user = await prisma.user.findUnique({ where: { email: 'mixed@example.com' } });
        assert.ok(user, 'email should be normalized to lowercase on write');
    });

    test('rejects duplicate email at the database level', async () => {
        await execute(REGISTER, {
            variables: {
                name: 'First',
                email: 'dup@example.com',
                phoneNumber: '+15550002222',
                password: 'pw',
            },
        });
        const second = await execute<{ registerUser: unknown }>(REGISTER, {
            variables: {
                name: 'Second',
                email: 'dup@example.com',
                phoneNumber: '+15550003333',
                password: 'pw',
            },
        });
        assert.ok((second.errors?.length ?? 0) > 0, 'duplicate email should produce a GraphQL error');
    });

    test('rejects duplicate phone number at the database level', async () => {
        await execute(REGISTER, {
            variables: {
                name: 'First',
                email: 'phone1@example.com',
                phoneNumber: '+15554445555',
                password: 'pw',
            },
        });
        const second = await execute<{ registerUser: unknown }>(REGISTER, {
            variables: {
                name: 'Second',
                email: 'phone2@example.com',
                phoneNumber: '+15554445555',
                password: 'pw',
            },
        });
        assert.ok((second.errors?.length ?? 0) > 0, 'duplicate phone number should produce a GraphQL error');
    });

    test('rejects missing required arguments at the GraphQL layer', async () => {
        const result = await execute(REGISTER, {
            variables: {
                name: 'NoEmail',
                phoneNumber: '+15550009999',
                password: 'pw',
                // email omitted
            },
        });
        assert.ok((result.errors?.length ?? 0) > 0, 'missing required arg should be a validation error');
    });
});
