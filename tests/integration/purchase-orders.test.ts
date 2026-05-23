// PurchaseOrder CRUD with nested PurchaseOrderEntry creation
// and ownership-scoped listAllPurchaseOrders.

import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, seedUser, issueAccessToken, seedProduct } from '../helpers/db';
import { execute, expectData, expectError } from '../helpers/gql';

const CREATE = /* GraphQL */ `
    mutation Create($input: CreatePurchaseOrderInput!) {
        createPurchaseOrder(input: $input) {
            id status price
            user { id }
            entries { quantity unitPrice product { id } }
        }
    }
`;
const UPDATE = /* GraphQL */ `
    mutation Update($id: Int!, $input: UpdatePurchaseOrderInput!) {
        updatePurchaseOrder(id: $id, input: $input) { id status price }
    }
`;
const DELETE = /* GraphQL */ `mutation D($id: Int!) { deletePurchaseOrder(id: $id) }`;
const LIST = /* GraphQL */ `query L { listAllPurchaseOrders { id user { id } } }`;

let adminToken: string;
let adminUserId: number;
let normalToken: string;
let normalUserId: number;
let otherNormalUserId: number;
let productAId: number;
let productBId: number;

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
    productAId = (await seedProduct({ name: 'PA', price: 10 })).id;
    productBId = (await seedProduct({ name: 'PB', price: 20 })).id;
});

describe('Mutation.createPurchaseOrder', () => {
    test('admin creates an order with nested entries', async () => {
        const result = await execute<{
            createPurchaseOrder: {
                id: number;
                status: string;
                price: string;
                user: { id: number };
                entries: Array<{ quantity: number; unitPrice: string; product: { id: number } }>;
            };
        }>(CREATE, {
            token: adminToken,
            variables: {
                input: {
                    userId: normalUserId,
                    price: '40.00',
                    status: 'SUBMITTED',
                    entries: [
                        { productId: productAId, quantity: 2, currency: 'EUR', unitPrice: '10.00' },
                        { productId: productBId, quantity: 1, currency: 'EUR', unitPrice: '20.00' },
                    ],
                },
            },
        });
        const created = expectData(result).createPurchaseOrder;
        assert.equal(created.status, 'SUBMITTED');
        assert.equal(created.user.id, normalUserId);
        assert.equal(created.entries.length, 2);
        const quantities = created.entries.map((e) => e.quantity).sort();
        assert.deepEqual(quantities, [1, 2]);
        const productIds = created.entries.map((e) => e.product.id).sort();
        assert.deepEqual(productIds, [productAId, productBId].sort());

        const stored = await prisma.purchaseOrder.findUniqueOrThrow({
            where: { id: created.id },
            include: { entries: true },
        });
        assert.equal(stored.entries.length, 2);
        assert.equal(Number(stored.price), 40);
    });

    test('non-admin cannot create purchase orders', async () => {
        const result = await execute(CREATE, {
            token: normalToken,
            variables: {
                input: {
                    userId: normalUserId,
                    price: '10.00',
                    status: 'SUBMITTED',
                    entries: [{ productId: productAId, quantity: 1, currency: 'EUR', unitPrice: '10.00' }],
                },
            },
        });
        expectError(result, 'Unauthorized');
    });

    test('rejects an invalid status enum value', async () => {
        const result = await execute(CREATE, {
            token: adminToken,
            variables: {
                input: {
                    userId: normalUserId,
                    price: '10',
                    status: 'CANCELED',
                    entries: [{ productId: productAId, quantity: 1, currency: 'EUR', unitPrice: '10' }],
                },
            },
        });
        assert.ok((result.errors?.length ?? 0) > 0);
    });

    test('accepts an empty entries array', async () => {
        const result = await execute<{ createPurchaseOrder: { id: number; entries: unknown[] } }>(CREATE, {
            token: adminToken,
            variables: {
                input: {
                    userId: normalUserId,
                    price: '0',
                    status: 'SUBMITTED',
                    entries: [],
                },
            },
        });
        const created = expectData(result).createPurchaseOrder;
        assert.equal(created.entries.length, 0);
    });

    test('rejects unknown productId in an entry (foreign key)', async () => {
        const result = await execute(CREATE, {
            token: adminToken,
            variables: {
                input: {
                    userId: normalUserId,
                    price: '10',
                    status: 'SUBMITTED',
                    entries: [{ productId: 9999999, quantity: 1, currency: 'EUR', unitPrice: '10' }],
                },
            },
        });
        assert.ok((result.errors?.length ?? 0) > 0);
    });
});

describe('Mutation.updatePurchaseOrder', () => {
    test('admin can transition status', async () => {
        const po = await prisma.purchaseOrder.create({
            data: { userId: normalUserId, status: 'SUBMITTED', price: 10 },
        });
        const result = await execute<{ updatePurchaseOrder: { status: string } }>(UPDATE, {
            token: adminToken,
            variables: { id: po.id, input: { status: 'PAID' } },
        });
        assert.equal(expectData(result).updatePurchaseOrder.status, 'PAID');
    });

    test('non-admin cannot update', async () => {
        const po = await prisma.purchaseOrder.create({
            data: { userId: normalUserId, status: 'SUBMITTED', price: 10 },
        });
        const result = await execute(UPDATE, {
            token: normalToken,
            variables: { id: po.id, input: { status: 'PAID' } },
        });
        expectError(result, 'Unauthorized');
    });
});

describe('Mutation.deletePurchaseOrder', () => {
    test('admin deletes when there are no nested entries', async () => {
        const po = await prisma.purchaseOrder.create({
            data: { userId: normalUserId, status: 'SUBMITTED', price: 0 },
        });
        const result = await execute<{ deletePurchaseOrder: boolean }>(DELETE, {
            token: adminToken,
            variables: { id: po.id },
        });
        assert.equal(expectData(result).deletePurchaseOrder, true);
    });

    test('errors deleting an order with entries (FK restriction)', async () => {
        const po = await prisma.purchaseOrder.create({
            data: {
                userId: normalUserId,
                status: 'SUBMITTED',
                price: 10,
                entries: { create: [{ productId: productAId, quantity: 1, currency: 'EUR', unitPrice: 10 }] },
            },
        });
        const result = await execute(DELETE, { token: adminToken, variables: { id: po.id } });
        assert.ok((result.errors?.length ?? 0) > 0,
            'deleting an order with entries should fail because of the restrict-on-delete FK');
    });
});

describe('Query.listAllPurchaseOrders ownership scoping', () => {
    test('a normal user only sees their own orders', async () => {
        const own = await prisma.purchaseOrder.create({
            data: { userId: normalUserId, status: 'SUBMITTED', price: 10 },
        });
        await prisma.purchaseOrder.create({
            data: { userId: otherNormalUserId, status: 'SUBMITTED', price: 10 },
        });

        const result = await execute<{ listAllPurchaseOrders: Array<{ id: number; user: { id: number } }> }>(
            LIST,
            { token: normalToken },
        );
        const orders = expectData(result).listAllPurchaseOrders;
        assert.equal(orders.length, 1);
        assert.equal(orders[0].id, own.id);
        assert.equal(orders[0].user.id, normalUserId);
    });

    test('an admin sees every user\'s orders', async () => {
        await prisma.purchaseOrder.create({ data: { userId: normalUserId, status: 'SUBMITTED', price: 10 } });
        await prisma.purchaseOrder.create({ data: { userId: otherNormalUserId, status: 'PAID', price: 20 } });
        const result = await execute<{ listAllPurchaseOrders: Array<{ id: number }> }>(LIST, { token: adminToken });
        assert.equal(expectData(result).listAllPurchaseOrders.length, 2);
    });

    test('requires authentication', async () => {
        const result = await execute(LIST);
        expectError(result, 'Unauthorized');
    });
});
