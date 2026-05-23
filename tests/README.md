# Backend test suite

```
npm test           # run all tests, exit when done
npm run test:watch # rerun on file changes
```

121 tests, ~20s on a warm cache, zero external services required.

## Architecture

| Concern | How it's handled | Why |
|---|---|---|
| Test runner | `node:test` (built-in) via `tsx` | No extra framework deps to drift; ships with Node 24. |
| Database | [`@electric-sql/pglite`](https://pglite.dev) exposed over the wire with `pglite-socket` on an ephemeral port; the existing `@prisma/adapter-pg` connects to it unchanged. Migrations are applied from `prisma/migrations/`. | Real Postgres semantics (MONEY, INET, enums, FKs) without Docker or an installed Postgres. The unmodified Prisma adapter is the production code path. |
| Module mocks | `node:test`'s `mock.module()` (requires `--experimental-test-module-mocks`) replaces `nodemailer` and `@aws-sdk/client-pinpoint-sms-voice-v2`. Captured payloads are exposed via `getMailbox()` / `getSmsbox()`. | Outbound email/SMS never hit the network; tests can assert on what would have been sent. |
| GraphQL execution | `graphql-yoga`'s `yoga.fetch()` over a `Request` object built by `tests/helpers/gql.ts`. | Tests go through parsing, validation, scope-auth, and resolvers — i.e. the public contract — so they survive resolver-internal refactors. |
| Test isolation | One PGlite instance in the parent process (via `--test-global-setup=./tests/setup/pglite.mts`); each test file is a separate worker process that resets the database in `beforeEach`. | Workers don't fight over the DB, but tests inside a file are independent. |

## File layout

```
tests/
  setup/
    pglite.mts              # parent-process global setup (loaded via --test-global-setup)
    global.mts              # per-worker setup: env defaults + module mocks (loaded via --import)
  helpers/
    db.ts                   # resetDatabase, seedUser, seedProduct, issueAccessToken, getMailbox/Smsbox
    gql.ts                  # execute(), expectData(), expectError(), exported schema
  unit/
    auth.test.ts            # hashPassword, comparePassword, verifyPhoneNumber, verifyEmailAddress, createLoginAndToken
    util.test.ts            # extractIpAddress
  integration/
    register.test.ts        # Mutation.registerUser
    verify.test.ts          # verifyPhoneNumber, verifyEmailAddress, resend*
    login.test.ts           # logInUser, logOutUser, validateToken
    password-reset.test.ts  # sendPasswordResetLink
    products.test.ts        # createProduct / updateProduct / deleteProduct / listAllProducts + admin gating
    items.test.ts           # createItem / updateItem / deleteItem / listAllItems + ownership scoping
    purchase-orders.test.ts # createPurchaseOrder (nested entries) / updatePurchaseOrder / deletePurchaseOrder / listAllPurchaseOrders
    queries.test.ts         # take / skip / orderBy, multi-key ordering, invalid orderBy fields
  schema/
    introspection.test.ts   # invariants on Query/Mutation/User shape, enum values, input requiredness
```

## Adding a new test file

1. Put it under `tests/unit/`, `tests/integration/`, or `tests/schema/` with a `.test.ts` suffix.
2. Import what you need from the helpers:
   ```ts
   import { describe, test, beforeEach } from 'node:test';
   import assert from 'node:assert/strict';
   import { resetDatabase, seedUser, issueAccessToken, prisma } from '../helpers/db';
   import { execute, expectData, expectError } from '../helpers/gql';
   ```
3. Either `db.ts` or `gql.ts` registers an `after()` that disconnects Prisma, so the worker exits cleanly. Importing at least one of them is enough.

## Non-brittleness notes

These choices intentionally trade tight assertions for long-term stability:

- **Field-narrow GraphQL queries.** Tests only request the fields they assert on, so adding a new field to any type does not break them.
- **Migration directory is read at runtime** in `pglite.mts`. New migrations apply automatically; no list to keep in sync.
- **Truncation introspects `pg_tables`** rather than naming each model — adding a Prisma model does not break `resetDatabase()`.
- **Schema-shape tests are additive.** They check that required types/fields/args exist, not that the schema is character-for-character identical. New types and fields are fine.
- **Money formatting is asserted against a regex** (`/49[.,]95/`) since Postgres `MONEY` rendering is locale-dependent.
- **OTP timestamp rotation is asserted via `>=` ordering**, not equality, because the random regenerated value could collide once in a million.
- **Module mocks preserve the rest of the surface** of `nodemailer` and the AWS SDK — if production code starts using a different export, the mock won't accidentally tighten the API.

## Known limitations

- The mocks rely on the experimental `--experimental-test-module-mocks` flag. The `--no-warnings=ExperimentalWarning` flag silences the runtime warning. When module mocks graduate from experimental, drop both flags.
- Prisma's pg adapter holds connections until `$disconnect()`; the `after()` hook in the helpers handles that. Without it, the worker would hang after tests pass.
