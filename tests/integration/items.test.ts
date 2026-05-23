// Item CRUD mutations + listAllItems with ownership scoping.

import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, seedUser, issueAccessToken, seedProduct } from '../helpers/db';
import { execute, expectData, expectError } from '../helpers/gql';

const CREATE = /* GraphQL */ `
    mutation Create($input: CreateItemInput!) {
        createItem(input: $input) { id code name }
    }
`;
const UPDATE = /* GraphQL */ `
    mutation Update($id: Int!, $input: UpdateItemInput!) {
        updateItem(id: $id, input: $input) { id name }
    }
`;
const DELETE = /* GraphQL */ `mutation D($id: Int!) { deleteItem(id: $id) }`;
const LIST = /* GraphQL */ `query L { listAllItems { id code user { id } } }`;

let adminToken: string;
let adminUserId: number;
let normalToken: string;
let normalUserId: number;
let otherNormalUserId: number;

beforeEach(async () => {
    await resetDatabase();
    const a = await seedUser({ role: 'ADMIN', email: 'admin@example.com' });
    adminUserId = a.user.id;
    adminToken = await issueAccessToken(adminUserId);
    const n = await seedUser({ role: 'NORMAL', email: 'normal@example.com' });
    normalUserId = n.user.id;
    normalToken = await issueAccessToken(normalUserId);
    const o = await seedUser({ role: 'NORMAL', email: 'other@example.com' });
    otherNormalUserId = o.user.id;
});

describe('Mutation.createItem', () => {
    test('admin creates an item for any user', async () => {
        const result = await execute<{ createItem: { id: number; code: string } }>(CREATE, {
            token: adminToken,
            variables: { input: { userId: normalUserId, code: 'C-001', name: 'Suitcase' } },
        });
        const created = expectData(result).createItem;
        assert.equal(created.code, 'C-001');
        const stored = await prisma.item.findUniqueOrThrow({ where: { id: created.id } });
        assert.equal(stored.userId, normalUserId);
    });

    test('non-admin cannot create items (admin scope required)', async () => {
        const result = await execute(CREATE, {
            token: normalToken,
            variables: { input: { userId: normalUserId, code: 'C-002', name: 'Backpack' } },
        });
        expectError(result, 'Unauthorized');
    });

    test('rejects duplicate item code', async () => {
        await execute(CREATE, {
            token: adminToken,
            variables: { input: { userId: normalUserId, code: 'DUP', name: 'A' } },
        });
        const result = await execute(CREATE, {
            token: adminToken,
            variables: { input: { userId: normalUserId, code: 'DUP', name: 'B' } },
        });
        assert.ok((result.errors?.length ?? 0) > 0, 'duplicate code should be rejected');
    });

    test('rejects unknown userId at the foreign-key level', async () => {
        const result = await execute(CREATE, {
            token: adminToken,
            variables: { input: { userId: 9999999, code: 'C-FK', name: 'Bag' } },
        });
        assert.ok((result.errors?.length ?? 0) > 0);
    });

    test('accepts optional productId linking to an existing product', async () => {
        const product = await seedProduct();
        const result = await execute<{ createItem: { id: number } }>(CREATE, {
            token: adminToken,
            variables: {
                input: {
                    userId: normalUserId,
                    code: 'C-LINK',
                    name: 'Linked',
                    productId: product.id,
                    weightInKgs: 2.5,
                },
            },
        });
        const stored = await prisma.item.findUniqueOrThrow({
            where: { id: expectData(result).createItem.id },
            include: { product: true },
        });
        assert.equal(stored.product?.id, product.id);
        assert.equal(stored.weightInKgs, 2.5);
    });
});

describe('Mutation.updateItem', () => {
    test('admin updates only the specified fields', async () => {
        const item = await prisma.item.create({
            data: { userId: normalUserId, code: 'U-1', name: 'Old' },
        });
        await execute(UPDATE, {
            token: adminToken,
            variables: { id: item.id, input: { name: 'New', weightInKgs: 1.5 } },
        });
        const stored = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
        assert.equal(stored.name, 'New');
        assert.equal(stored.weightInKgs, 1.5);
        assert.equal(stored.code, 'U-1', 'code is not exposed in UpdateItemInput, must remain unchanged');
    });

    test('non-admin cannot update items', async () => {
        const item = await prisma.item.create({
            data: { userId: normalUserId, code: 'U-2', name: 'Mine' },
        });
        const result = await execute(UPDATE, {
            token: normalToken,
            variables: { id: item.id, input: { name: 'Hacked' } },
        });
        expectError(result, 'Unauthorized');
    });

    test('errors on unknown id', async () => {
        const result = await execute(UPDATE, {
            token: adminToken,
            variables: { id: 9999999, input: { name: 'x' } },
        });
        assert.ok((result.errors?.length ?? 0) > 0);
    });
});

describe('Mutation.deleteItem', () => {
    test('admin deletes', async () => {
        const item = await prisma.item.create({
            data: { userId: normalUserId, code: 'D-1', name: 'X' },
        });
        const result = await execute<{ deleteItem: boolean }>(DELETE, {
            token: adminToken,
            variables: { id: item.id },
        });
        assert.equal(expectData(result).deleteItem, true);
        assert.equal(await prisma.item.findUnique({ where: { id: item.id } }), null);
    });

    test('non-admin cannot delete', async () => {
        const item = await prisma.item.create({
            data: { userId: normalUserId, code: 'D-2', name: 'X' },
        });
        const result = await execute(DELETE, {
            token: normalToken,
            variables: { id: item.id },
        });
        expectError(result, 'Unauthorized');
    });
});

describe('Query.listAllItems ownership scoping', () => {
    test('a normal user only sees their own items', async () => {
        await prisma.item.create({ data: { userId: normalUserId, code: 'N-1', name: 'mine-1' } });
        await prisma.item.create({ data: { userId: normalUserId, code: 'N-2', name: 'mine-2' } });
        await prisma.item.create({ data: { userId: otherNormalUserId, code: 'O-1', name: 'theirs' } });

        const result = await execute<{ listAllItems: Array<{ id: number; code: string; user: { id: number } }> }>(
            LIST,
            { token: normalToken },
        );
        const items = expectData(result).listAllItems;
        assert.equal(items.length, 2);
        assert.ok(items.every((i) => i.user.id === normalUserId));
        const codes = items.map((i) => i.code).sort();
        assert.deepEqual(codes, ['N-1', 'N-2']);
    });

    test('an admin sees every user\'s items', async () => {
        await prisma.item.create({ data: { userId: normalUserId, code: 'N-3', name: 'a' } });
        await prisma.item.create({ data: { userId: otherNormalUserId, code: 'O-2', name: 'b' } });
        await prisma.item.create({ data: { userId: adminUserId, code: 'A-1', name: 'c' } });
        const result = await execute<{ listAllItems: Array<{ code: string }> }>(LIST, { token: adminToken });
        const codes = expectData(result).listAllItems.map((i) => i.code).sort();
        assert.deepEqual(codes, ['A-1', 'N-3', 'O-2']);
    });

    test('requires authentication', async () => {
        const result = await execute(LIST);
        expectError(result, 'Unauthorized');
    });
});
