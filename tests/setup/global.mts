// Per-worker test setup. Loaded via `node --import ./tests/setup/global.mts`
// in every test process before any source file is imported.
//
// Responsibilities:
//   1. Populate the env vars src/auth.ts and src/builder.ts read at module load
//      (TOKEN_SECRET, SMTP_*, CLIENT_BASE_URL). DATABASE_URL is supplied by
//      the parent process via tests/setup/pglite.mts and inherited by workers.
//   2. Neutralize outbound side effects (email + SMS) using node:test's
//      mock.module(). Runs before src/auth.ts imports nodemailer / the AWS
//      SDK so the top-level createTransport()/new PinpointSMSVoiceV2Client()
//      pick up the mocks. Both stubs append to globalThis-exposed arrays
//      that tests/helpers/db.ts surfaces via getMailbox()/getSmsbox().

import { mock } from 'node:test';

process.env.NODE_ENV ??= 'test';
process.env.TOKEN_SECRET ??= 'test-token-secret-do-not-use-in-prod';
process.env.SMTP_ENDPOINT_URL ??= 'smtp.test.invalid';
process.env.SMTP_ENDPOINT_PORT ??= '465';
process.env.SMTP_USERNAME ??= 'test';
process.env.SMTP_PASSWORD ??= 'test';
process.env.CLIENT_BASE_URL ??= 'http://localhost:0';

type CapturedMail = {
    from?: string;
    to?: string;
    subject?: string;
    text?: string;
    html?: string;
};
type CapturedSms = {
    DestinationPhoneNumber?: string;
    OriginationIdentity?: string;
    MessageBody?: string;
};

const mailbox: CapturedMail[] = [];
const smsbox: CapturedSms[] = [];

const g = globalThis as unknown as {
    __TEST_MAILBOX__: CapturedMail[];
    __TEST_SMSBOX__: CapturedSms[];
};
g.__TEST_MAILBOX__ = mailbox;
g.__TEST_SMSBOX__ = smsbox;

const createMockTransport = () => ({
    sendMail: async (mail: CapturedMail) => {
        mailbox.push(mail);
        return { messageId: `test-${mailbox.length}` };
    },
    verify: async () => true,
    close: () => {},
});

// Preserve unrelated nodemailer exports so future production code that uses
// a different export doesn't suddenly break tests.
const realNodemailer = (await import('nodemailer')) as unknown as Record<string, unknown>;
const realNodemailerDefault = (realNodemailer.default ?? {}) as Record<string, unknown>;
mock.module('nodemailer', {
    namedExports: {
        ...realNodemailer,
        createTransport: createMockTransport,
    },
    defaultExport: {
        ...realNodemailerDefault,
        createTransport: createMockTransport,
    },
});

const realPinpoint = (await import('@aws-sdk/client-pinpoint-sms-voice-v2')) as unknown as Record<
    string,
    unknown
>;
class MockPinpointClient {
    async send(command: unknown) {
        const input = (command as { input?: CapturedSms })?.input ?? {};
        smsbox.push(input);
        return { MessageId: `sms-${smsbox.length}` };
    }
    destroy() {}
}
mock.module('@aws-sdk/client-pinpoint-sms-voice-v2', {
    namedExports: {
        ...realPinpoint,
        PinpointSMSVoiceV2Client: MockPinpointClient,
    },
});
