// Admin-only Product CRUD mutations + the public listAllProducts query.

import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, seedUser, issueAccessToken, seedProduct } from '../helpers/db';
import { execute, expectData, expectError } from '../helpers/gql';

const CREATE = /* GraphQL */ `
    mutation Create($input: CreateProductInput!) {
        createProduct(input: $input) {
            id name upc brand currency price
        }
    }
`;
const UPDATE = /* GraphQL */ `
    mutation Update($id: Int!, $input: UpdateProductInput!) {
        updateProduct(id: $id, input: $input) {
            id name brand price
        }
    }
`;
const DELETE = /* GraphQL */ `mutation D($id: Int!) { deleteProduct(id: $id) }`;
const LIST = /* GraphQL */ `query L { listAllProducts { id name } }`;

const adminContext = async () => {
    const { user } = await seedUser({ role: 'ADMIN', email: `admin-${Date.now()}-${Math.random()}@example.com` });
    return { user, token: await issueAccessToken(user.id) };
};
const normalContext = async () => {
    const { user } = await seedUser({ role: 'NORMAL', email: `norm-${Date.now()}-${Math.random()}@example.com` });
    return { user, token: await issueAccessToken(user.id) };
};

describe('Product CRUD authorization', () => {
    beforeEach(resetDatabase);

    test('createProduct requires admin', async () => {
        const { token } = await normalContext();
        const result = await execute(CREATE, {
            token,
            variables: { input: { name: 'X', currency: 'EUR', price: '1.00' } },
        });
        expectError(result, 'Unauthorized');
    });

    test('createProduct rejects anonymous callers', async () => {
        const result = await execute(CREATE, {
            variables: { input: { name: 'X', currency: 'EUR', price: '1.00' } },
        });
        expectError(result, 'Unauthorized');
    });

    test('updateProduct and deleteProduct also require admin', async () => {
        const { token } = await normalContext();
        const product = await seedProduct();
        const upd = await execute(UPDATE, { token, variables: { id: product.id, input: { name: 'Y' } } });
        expectError(upd, 'Unauthorized');
        const del = await execute(DELETE, { token, variables: { id: product.id } });
        expectError(del, 'Unauthorized');
    });
});

describe('Mutation.createProduct', () => {
    beforeEach(resetDatabase);

    test('creates with all optional fields populated', async () => {
        const { token } = await adminContext();
        const input = {
            name: 'Wide Brim Hat',
            upc: '012345678905',
            upcScanned: true,
            description: 'Sun protection',
            amazonASIN: 'B0123ABCDE',
            country: 'IT',
            brand: 'BorsalinoTest',
            model: 'WB-1',
            color: 'beige',
            weightInKgs: 0.2,
            widthInCms: 30.5,
            heightInCms: 12,
            depthInCms: 30.5,
            currency: 'EUR' as const,
            price: '49.95',
        };
        const result = await execute<{ createProduct: { id: number; name: string; brand: string | null; price: string } }>(
            CREATE,
            { token, variables: { input } },
        );
        const created = expectData(result).createProduct;
        assert.equal(created.name, input.name);
        assert.equal(created.brand, 'BorsalinoTest');
        // Money is rendered with currency formatting by the MONEY type; the
        // assertion only checks the numeric component to stay robust against
        // locale changes.
        assert.match(created.price, /49[.,]95/);

        const stored = await prisma.product.findUniqueOrThrow({ where: { id: created.id } });
        assert.equal(stored.upcScanned, true);
        assert.equal(stored.amazonASIN, 'B0123ABCDE');
        assert.equal(Number(stored.price), 49.95);
    });

    test('creates with only required fields', async () => {
        const { token } = await adminContext();
        const result = await execute<{ createProduct: { id: number } }>(CREATE, {
            token,
            variables: { input: { name: 'Bare', currency: 'EUR', price: '0' } },
        });
        const created = expectData(result).createProduct;
        const stored = await prisma.product.findUniqueOrThrow({ where: { id: created.id } });
        assert.equal(stored.brand, null);
        assert.equal(stored.upc, null);
        assert.equal(stored.upcScanned, null);
        assert.equal(Number(stored.price), 0);
    });

    test('rejects an invalid currency enum value', async () => {
        const { token } = await adminContext();
        const result = await execute(CREATE, {
            token,
            variables: { input: { name: 'X', currency: 'USD', price: '1' } },
        });
        assert.ok((result.errors?.length ?? 0) > 0, 'invalid enum value should be rejected');
    });
});

describe('Mutation.updateProduct', () => {
    beforeEach(resetDatabase);

    test('partial update touches only specified fields', async () => {
        const { token } = await adminContext();
        const existing = await seedProduct({ name: 'Original', brand: 'OldBrand', price: 10 });
        const result = await execute<{ updateProduct: { id: number; name: string; brand: string | null } }>(
            UPDATE,
            { token, variables: { id: existing.id, input: { brand: 'NewBrand' } } },
        );
        const updated = expectData(result).updateProduct;
        assert.equal(updated.name, 'Original', 'name should be untouched');
        assert.equal(updated.brand, 'NewBrand');
    });

    test('updates the price (string input parses as Decimal)', async () => {
        const { token } = await adminContext();
        const existing = await seedProduct({ price: 5 });
        await execute(UPDATE, { token, variables: { id: existing.id, input: { price: '99.99' } } });
        const stored = await prisma.product.findUniqueOrThrow({ where: { id: existing.id } });
        assert.equal(Number(stored.price), 99.99);
    });

    test('errors when product does not exist', async () => {
        const { token } = await adminContext();
        const result = await execute(UPDATE, { token, variables: { id: 9999999, input: { name: 'x' } } });
        assert.ok((result.errors?.length ?? 0) > 0);
    });
});

describe('Mutation.deleteProduct', () => {
    beforeEach(resetDatabase);

    test('removes the row when called by an admin', async () => {
        const { token } = await adminContext();
        const existing = await seedProduct();
        const result = await execute<{ deleteProduct: boolean }>(DELETE, {
            token,
            variables: { id: existing.id },
        });
        assert.equal(expectData(result).deleteProduct, true);
        const after = await prisma.product.findUnique({ where: { id: existing.id } });
        assert.equal(after, null);
    });

    test('errors on unknown id', async () => {
        const { token } = await adminContext();
        const result = await execute(DELETE, { token, variables: { id: 9999999 } });
        assert.ok((result.errors?.length ?? 0) > 0);
    });
});

describe('Query.listAllProducts', () => {
    beforeEach(resetDatabase);

    test('requires authentication', async () => {
        const result = await execute(LIST);
        expectError(result, 'Unauthorized');
    });

    test('returns all products for any logged-in user (no scope filter)', async () => {
        const { token } = await normalContext();
        await seedProduct({ name: 'A' });
        await seedProduct({ name: 'B' });
        await seedProduct({ name: 'C' });
        const result = await execute<{ listAllProducts: Array<{ name: string }> }>(LIST, { token });
        const names = expectData(result).listAllProducts.map((p) => p.name).sort();
        assert.deepEqual(names, ['A', 'B', 'C']);
    });
});
