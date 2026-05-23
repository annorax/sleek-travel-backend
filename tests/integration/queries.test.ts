// Pagination + ordering behaviors across list queries.

import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, seedUser, issueAccessToken, seedProduct } from '../helpers/db';
import { execute, expectData } from '../helpers/gql';

const LIST_PRODUCTS = /* GraphQL */ `
    query L($take: Int, $skip: Int, $orderBy: [ProductOrderByInput!]) {
        listAllProducts(take: $take, skip: $skip, orderBy: $orderBy) { id name price }
    }
`;
const LIST_ITEMS = /* GraphQL */ `
    query L($take: Int, $skip: Int, $orderBy: [ItemOrderByInput!]) {
        listAllItems(take: $take, skip: $skip, orderBy: $orderBy) { id code }
    }
`;

let token: string;
let adminToken: string;
let userId: number;

beforeEach(async () => {
    await resetDatabase();
    const u = await seedUser({ role: 'NORMAL', email: 'q@example.com' });
    userId = u.user.id;
    token = await issueAccessToken(userId);
    const a = await seedUser({ role: 'ADMIN', email: 'q-admin@example.com' });
    adminToken = await issueAccessToken(a.user.id);
});

describe('pagination on listAllProducts', () => {
    beforeEach(async () => {
        // Seed 5 products with distinct names so ordering tests are deterministic.
        for (const name of ['A', 'B', 'C', 'D', 'E']) {
            await seedProduct({ name, price: name.charCodeAt(0) });
        }
    });

    test('take limits the page size', async () => {
        const result = await execute<{ listAllProducts: Array<{ name: string }> }>(LIST_PRODUCTS, {
            token,
            variables: { take: 2, orderBy: [{ field: 'name', direction: 'asc' }] },
        });
        const names = expectData(result).listAllProducts.map((p) => p.name);
        assert.deepEqual(names, ['A', 'B']);
    });

    test('skip offsets the page', async () => {
        const result = await execute<{ listAllProducts: Array<{ name: string }> }>(LIST_PRODUCTS, {
            token,
            variables: { skip: 2, take: 2, orderBy: [{ field: 'name', direction: 'asc' }] },
        });
        const names = expectData(result).listAllProducts.map((p) => p.name);
        assert.deepEqual(names, ['C', 'D']);
    });

    test('orderBy direction reverses the order', async () => {
        const result = await execute<{ listAllProducts: Array<{ name: string }> }>(LIST_PRODUCTS, {
            token,
            variables: { take: 3, orderBy: [{ field: 'name', direction: 'desc' }] },
        });
        const names = expectData(result).listAllProducts.map((p) => p.name);
        assert.deepEqual(names, ['E', 'D', 'C']);
    });

    test('orderBy direction defaults to asc when omitted', async () => {
        const result = await execute<{ listAllProducts: Array<{ name: string }> }>(LIST_PRODUCTS, {
            token,
            variables: { take: 3, orderBy: [{ field: 'name' }] },
        });
        const names = expectData(result).listAllProducts.map((p) => p.name);
        assert.deepEqual(names, ['A', 'B', 'C']);
    });

    test('multi-key orderBy resolves ties via the next key', async () => {
        // Two products with identical name "Z" but different ids — order
        // them by name asc, then id desc, and the higher id should come first.
        await seedProduct({ name: 'Z' });
        await seedProduct({ name: 'Z' });
        const result = await execute<{ listAllProducts: Array<{ id: number; name: string }> }>(LIST_PRODUCTS, {
            token,
            variables: {
                orderBy: [
                    { field: 'name', direction: 'desc' },
                    { field: 'id', direction: 'desc' },
                ],
                take: 2,
            },
        });
        const zs = expectData(result).listAllProducts;
        assert.equal(zs.length, 2);
        assert.ok(zs[0].name === 'Z' && zs[1].name === 'Z');
        assert.ok(zs[0].id > zs[1].id, 'tie-broken by id desc');
    });

    test('rejects ordering by a field not in the whitelist', async () => {
        const result = await execute(LIST_PRODUCTS, {
            token,
            variables: { orderBy: [{ field: 'notAField', direction: 'asc' }] },
        });
        assert.ok((result.errors?.length ?? 0) > 0,
            'invalid orderBy field should be rejected at the enum level');
    });
});

describe('pagination on listAllItems', () => {
    test('per-user scope plays nicely with pagination', async () => {
        await prisma.item.createMany({
            data: [
                { userId, code: 'I-1', name: '1' },
                { userId, code: 'I-2', name: '2' },
                { userId, code: 'I-3', name: '3' },
            ],
        });
        const result = await execute<{ listAllItems: Array<{ code: string }> }>(LIST_ITEMS, {
            token,
            variables: { take: 2, skip: 1, orderBy: [{ field: 'code', direction: 'asc' }] },
        });
        const codes = expectData(result).listAllItems.map((i) => i.code);
        assert.deepEqual(codes, ['I-2', 'I-3']);
    });

    test('admin sees everyone\'s items even when paginated', async () => {
        const otherUser = await seedUser({ email: 'paginated-other@example.com' });
        await prisma.item.createMany({
            data: [
                { userId, code: 'M-1', name: 'mine' },
                { userId: otherUser.user.id, code: 'O-1', name: 'theirs' },
            ],
        });
        const result = await execute<{ listAllItems: Array<{ code: string }> }>(LIST_ITEMS, {
            token: adminToken,
            variables: { take: 10 },
        });
        const codes = expectData(result).listAllItems.map((i) => i.code).sort();
        assert.deepEqual(codes, ['M-1', 'O-1']);
    });
});
