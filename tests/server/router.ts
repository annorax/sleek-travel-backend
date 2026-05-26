// HTTP control surface for the frontend integration test harness.
//
// Mounted at /__test__ by tests/setup/test-server.mts, which runs under
// NODE_ENV=test with PGlite + the nodemailer/SMS mocks already active. The
// router itself also refuses requests when NODE_ENV !== 'test', so a
// misconfigured deploy that accidentally imports this module still cannot
// expose the endpoints.
//
// Endpoints:
//   POST /__test__/reset              wipe DB + clear captured email/SMS
//   POST /__test__/seed/user          create a user (body matches SeedUserOptions)
//   POST /__test__/seed/product       create a product
//   POST /__test__/access-token       issue an access token for a userId
//   GET  /__test__/mailbox            captured outbound email
//   GET  /__test__/smsbox             captured outbound SMS
//   POST /__test__/outbox/clear       clear captured email + SMS only

import { Router } from 'express';
import {
    resetDatabase,
    seedUser,
    seedProduct,
    issueAccessToken,
    getMailbox,
    getSmsbox,
    clearOutbox,
} from '../helpers/db';

export function createTestControlRouter(): Router {
    const router = Router();

    router.use((_req, res, next) => {
        if (process.env.NODE_ENV !== 'test') {
            res.status(404).end();
            return;
        }
        next();
    });

    router.post('/reset', async (_req, res) => {
        await resetDatabase();
        clearOutbox();
        res.json({ ok: true });
    });

    router.post('/seed/user', async (req, res) => {
        const { user, plaintextPassword } = await seedUser(req.body ?? {});
        res.json({ user, password: plaintextPassword });
    });

    router.post('/seed/product', async (req, res) => {
        const product = await seedProduct(req.body ?? {});
        res.json({ product });
    });

    router.post('/access-token', async (req, res) => {
        const userId = Number(req.body?.userId);
        if (!Number.isInteger(userId) || userId <= 0) {
            res.status(400).json({ error: 'userId (positive integer) required' });
            return;
        }
        const value = await issueAccessToken(userId, req.body?.value);
        res.json({ value });
    });

    router.get('/mailbox', (_req, res) => {
        res.json(getMailbox() ?? []);
    });

    router.get('/smsbox', (_req, res) => {
        res.json(getSmsbox() ?? []);
    });

    router.post('/outbox/clear', (_req, res) => {
        clearOutbox();
        res.json({ ok: true });
    });

    return router;
}
