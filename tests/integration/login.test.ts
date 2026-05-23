// logInUser, logOutUser, validateToken mutations.

import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, seedUser, issueAccessToken, clearOutbox } from '../helpers/db';
import { execute, expectData } from '../helpers/gql';

const LOG_IN = /* GraphQL */ `
    mutation Login($emailOrPhone: String!, $password: String!) {
        logInUser(emailOrPhone: $emailOrPhone, password: $password) {
            error
            token
            user { id email role }
        }
    }
`;

const LOG_OUT = /* GraphQL */ `mutation { logOutUser }`;

const VALIDATE = /* GraphQL */ `
    mutation V($tokenValue: String!) {
        validateToken(tokenValue: $tokenValue) {
            error
            token
            user { id email }
        }
    }
`;

describe('Mutation.logInUser', () => {
    beforeEach(async () => { await resetDatabase(); clearOutbox(); });

    test('returns a token and user for valid credentials by email', async () => {
        const { user, plaintextPassword } = await seedUser();
        const result = await execute<{ logInUser: { token: string | null; error: string | null; user: { id: number; email: string } | null } }>(
            LOG_IN,
            { variables: { emailOrPhone: user.email, password: plaintextPassword }, ipAddress: '203.0.113.5' },
        );
        const data = expectData(result).logInUser;
        assert.equal(data.error, null);
        assert.ok(data.token, 'token should be present');
        assert.equal(data.user?.id, user.id);

        // Token persisted and tied to the right user.
        const stored = await prisma.accessToken.findUniqueOrThrow({ where: { value: data.token! } });
        assert.equal(stored.userId, user.id);
        assert.equal(stored.expired, false);
        const logins = await prisma.login.findMany({ where: { userId: user.id } });
        assert.equal(logins.length, 1);
        assert.equal(logins[0].explicit, true);
        assert.equal(logins[0].ipAddress, '203.0.113.5');
    });

    test('accepts phone number in the emailOrPhone field', async () => {
        const { user, plaintextPassword } = await seedUser({ phoneNumber: '+15551112233' });
        const result = await execute<{ logInUser: { token: string | null; error: string | null } }>(
            LOG_IN,
            { variables: { emailOrPhone: user.phoneNumber, password: plaintextPassword } },
        );
        assert.ok(expectData(result).logInUser.token);
    });

    test('email lookup is case-insensitive', async () => {
        const { user, plaintextPassword } = await seedUser({ email: 'caseuser@example.com' });
        const result = await execute<{ logInUser: { token: string | null } }>(LOG_IN, {
            variables: { emailOrPhone: 'CaseUser@Example.com', password: plaintextPassword },
        });
        assert.ok(expectData(result).logInUser.token);
        assert.ok(user.email === 'caseuser@example.com');
    });

    test('returns user-not-found error for unknown email/phone', async () => {
        const result = await execute<{ logInUser: { error: string | null; token: string | null } }>(
            LOG_IN,
            { variables: { emailOrPhone: 'nobody@example.com', password: 'x' } },
        );
        const data = expectData(result).logInUser;
        assert.equal(data.token, null);
        assert.match(data.error ?? '', /no user account/i);
    });

    test('returns incorrect-password error for wrong password', async () => {
        const { user } = await seedUser();
        const result = await execute<{ logInUser: { error: string | null; token: string | null } }>(
            LOG_IN,
            { variables: { emailOrPhone: user.email, password: 'wrong' } },
        );
        const data = expectData(result).logInUser;
        assert.equal(data.token, null);
        assert.match(data.error ?? '', /incorrect password/i);
    });

    test('blocks login when email is unverified, no token issued', async () => {
        const { user, plaintextPassword } = await seedUser({ emailVerified: null });
        const result = await execute<{ logInUser: { error: string | null; token: string | null; user: { id: number } | null } }>(
            LOG_IN,
            { variables: { emailOrPhone: user.email, password: plaintextPassword } },
        );
        const data = expectData(result).logInUser;
        assert.equal(data.token, null);
        assert.match(data.error ?? '', /unverified email/i);
        // The user is still echoed back so the client can route to a resend flow.
        assert.equal(data.user?.id, user.id);
    });

    test('blocks login when phone is unverified (after email passes)', async () => {
        const { user, plaintextPassword } = await seedUser({ phoneNumberVerified: null });
        const result = await execute<{ logInUser: { error: string | null; token: string | null } }>(
            LOG_IN,
            { variables: { emailOrPhone: user.email, password: plaintextPassword } },
        );
        const data = expectData(result).logInUser;
        assert.equal(data.token, null);
        assert.match(data.error ?? '', /unverified phone/i);
    });
});

describe('Mutation.logOutUser', () => {
    beforeEach(async () => { await resetDatabase(); clearOutbox(); });

    test('expires the access token used to authenticate', async () => {
        const { user } = await seedUser();
        const token = await issueAccessToken(user.id);
        const result = await execute<{ logOutUser: boolean }>(LOG_OUT, { token });
        assert.equal(expectData(result).logOutUser, true);
        const stored = await prisma.accessToken.findUniqueOrThrow({ where: { value: token } });
        assert.equal(stored.expired, true);
    });

    test('requires authentication', async () => {
        const result = await execute(LOG_OUT);
        assert.ok((result.errors?.length ?? 0) > 0, 'unauthenticated logout should error');
        assert.ok(
            result.errors?.some((e) => /unauthor/i.test(e.message)),
            `expected an authorization error, got: ${JSON.stringify(result.errors)}`,
        );
    });

    test('expired tokens are not accepted', async () => {
        const { user } = await seedUser();
        const token = await issueAccessToken(user.id);
        await prisma.accessToken.update({ where: { value: token }, data: { expired: true } });
        const result = await execute(LOG_OUT, { token });
        assert.ok((result.errors?.length ?? 0) > 0, 'expired token should be rejected');
    });
});

describe('Mutation.validateToken', () => {
    beforeEach(async () => { await resetDatabase(); clearOutbox(); });

    test('returns a new token and expires the old one', async () => {
        const { user } = await seedUser();
        const oldToken = await issueAccessToken(user.id);
        const result = await execute<{ validateToken: { token: string | null; error: string | null; user: { id: number } | null } }>(
            VALIDATE,
            { variables: { tokenValue: oldToken } },
        );
        const data = expectData(result).validateToken;
        assert.equal(data.error, null);
        assert.ok(data.token);
        assert.notEqual(data.token, oldToken);
        assert.equal(data.user?.id, user.id);

        const oldStored = await prisma.accessToken.findUniqueOrThrow({ where: { value: oldToken } });
        assert.equal(oldStored.expired, true);
        const newStored = await prisma.accessToken.findUniqueOrThrow({ where: { value: data.token! } });
        assert.equal(newStored.expired, false);
        assert.equal(newStored.userId, user.id);
    });

    test('records the rotation as a non-explicit login', async () => {
        const { user } = await seedUser();
        const oldToken = await issueAccessToken(user.id);
        await execute(VALIDATE, { variables: { tokenValue: oldToken }, ipAddress: '198.51.100.42' });
        const logins = await prisma.login.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } });
        assert.ok(logins.length >= 1);
        const rotation = logins.find((l) => l.tokenValue !== oldToken);
        assert.ok(rotation, 'rotation login should be recorded');
        assert.equal(rotation.explicit, false);
        assert.equal(rotation.ipAddress, '198.51.100.42');
    });

    test('errors when the token is unknown', async () => {
        const result = await execute<{ validateToken: { error: string | null } }>(VALIDATE, {
            variables: { tokenValue: 'no-such-token' },
        });
        assert.match(expectData(result).validateToken.error ?? '', /token not found/i);
    });

    test('errors when the token has been expired', async () => {
        const { user } = await seedUser();
        const token = await issueAccessToken(user.id);
        await prisma.accessToken.update({ where: { value: token }, data: { expired: true } });
        const result = await execute<{ validateToken: { error: string | null } }>(VALIDATE, {
            variables: { tokenValue: token },
        });
        assert.match(expectData(result).validateToken.error ?? '', /token not found/i);
    });
});
