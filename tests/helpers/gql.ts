// Helper for executing GraphQL operations against the real built schema.
//
// We deliberately go through GraphQL Yoga so that:
//   - The full request pipeline (parsing, validation, scope-auth) runs.
//   - Tests assert against the public contract — adding internal helpers
//     or renaming resolvers won't break them.
//
// Yoga is invoked via fetch-style; we synthesize Request objects so we can
// attach Authorization headers and a simulated remote address (used by
// extractIpAddress in src/util.ts).

import { after } from 'node:test';
import { createYoga } from 'graphql-yoga';
import { builder, prisma } from '../../src/builder';
import '../../src/schema'; // side-effect: registers all types/resolvers
import { createContext } from '../../src/context';

// Disconnect Prisma when the test file completes so the worker can exit
// cleanly. Mirrors the teardown in tests/helpers/db.ts — registering it
// here too covers test files that import only gql helpers (e.g. schema
// introspection tests).
after(async () => {
    try {
        await prisma.$disconnect();
    } catch {
        /* ignore — process is exiting anyway */
    }
});

const schema = builder.toSchema();

// In production yoga sits behind express, so initialContext.req is the
// Express request that resolvers read via extractIpAddress(). When we call
// yoga.fetch() directly there is no express layer, so we synthesize a
// minimal req shim from the Web Request — preserving the contract resolvers
// depend on while keeping tests free of express boilerplate.
const synthesizeReq = (initialContext: { request?: Request }) => {
    const request = initialContext.request;
    const headers: Record<string, string> = {};
    if (request?.headers) {
        for (const [k, v] of request.headers.entries()) headers[k] = v;
    }
    return { headers, socket: { remoteAddress: undefined as string | undefined } };
};

// Build the yoga instance once and reuse — the schema is immutable.
const yoga = createYoga({
    schema,
    context: (initialContext) =>
        createContext({ ...initialContext, req: synthesizeReq(initialContext) }),
    // Quiet by default; tests assert on responses, not logs.
    logging: false,
    // Yoga normally masks unexpected errors; in tests we want the raw
    // GraphQL error envelope, which includes resolver-thrown messages.
    maskedErrors: false,
});

export type GqlResult<T = unknown> = {
    data?: T | null;
    errors?: Array<{ message: string; path?: ReadonlyArray<string | number>; extensions?: Record<string, unknown> }>;
};

export type ExecuteOptions = {
    variables?: Record<string, unknown>;
    token?: string;
    headers?: Record<string, string>;
    /** Simulated client IP, threaded into context via x-forwarded-for. */
    ipAddress?: string;
};

export async function execute<T = unknown>(
    query: string,
    options: ExecuteOptions = {},
): Promise<GqlResult<T>> {
    const headers: Record<string, string> = {
        'content-type': 'application/json',
        ...(options.headers ?? {}),
    };
    if (options.token) headers['authorization'] = `Bearer ${options.token}`;
    if (options.ipAddress) headers['x-forwarded-for'] = options.ipAddress;

    const request = new Request('http://test.local/graphql', {
        method: 'POST',
        headers,
        body: JSON.stringify({ query, variables: options.variables ?? {} }),
    });

    const response = await yoga.fetch(request);
    const json = (await response.json()) as GqlResult<T>;
    return json;
}

/**
 * Assert no errors and return data. Used in happy-path tests where any
 * GraphQL error is itself a failure of the test.
 */
export function expectData<T>(result: GqlResult<T>): T {
    if (result.errors && result.errors.length > 0) {
        throw new Error(
            `Expected successful GraphQL result but got errors:\n${result.errors
                .map((e) => `  - ${e.message}`)
                .join('\n')}`,
        );
    }
    if (result.data === null || result.data === undefined) {
        throw new Error('Expected GraphQL data, got null/undefined');
    }
    return result.data;
}

/** Assert that the result contains an error with a message matching the given substring. */
export function expectError(result: GqlResult<unknown>, messageSubstring: string): void {
    const errors = result.errors ?? [];
    const match = errors.some((e) => e.message.includes(messageSubstring));
    if (!match) {
        throw new Error(
            `Expected GraphQL error containing "${messageSubstring}" but got:\n${
                errors.length === 0 ? '  (no errors)' : errors.map((e) => `  - ${e.message}`).join('\n')
            }`,
        );
    }
}

export { schema };
