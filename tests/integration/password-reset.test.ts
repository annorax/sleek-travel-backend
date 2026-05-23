// sendPasswordResetLink mutation.

import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDatabase, seedUser, clearOutbox, getMailbox, getSmsbox } from '../helpers/db';
import { execute, expectData, expectError } from '../helpers/gql';

const SEND_LINK = /* GraphQL */ `
    mutation Send($emailOrPhone: String!) {
        sendPasswordResetLink(emailOrPhone: $emailOrPhone)
    }
`;

describe('Mutation.sendPasswordResetLink', () => {
    beforeEach(async () => { await resetDatabase(); clearOutbox(); });

    test('dispatches both email and SMS for a known email address', async () => {
        const { user } = await seedUser({ email: 'reset@example.com' });
        const result = await execute<{ sendPasswordResetLink: boolean }>(SEND_LINK, {
            variables: { emailOrPhone: user.email },
        });
        assert.equal(expectData(result).sendPasswordResetLink, true);

        const mailbox = getMailbox() as Array<{ to?: string; subject?: string; text?: string }>;
        const smsbox = getSmsbox() as Array<{ MessageBody?: string }>;
        assert.equal(mailbox.length, 1);
        assert.match(mailbox[0].subject ?? '', /password reset/i);
        assert.match(mailbox[0].text ?? '', /reset-password\?token=/);
        assert.equal(smsbox.length, 1);
        assert.match(smsbox[0].MessageBody ?? '', /reset-password\?token=/);
    });

    test('also works when looked up by phone number', async () => {
        const { user } = await seedUser({ phoneNumber: '+15553334444' });
        const result = await execute<{ sendPasswordResetLink: boolean }>(SEND_LINK, {
            variables: { emailOrPhone: user.phoneNumber },
        });
        assert.equal(expectData(result).sendPasswordResetLink, true);
    });

    test('errors when no user matches', async () => {
        const result = await execute(SEND_LINK, { variables: { emailOrPhone: 'nobody@example.com' } });
        expectError(result, 'User not found');
    });
});
