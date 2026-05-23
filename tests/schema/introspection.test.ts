// Schema-shape invariants.
//
// These assertions check public-contract properties of the GraphQL schema
// (presence of types/fields/args, scalar shape, enum values). They are
// deliberately additive: a future migration can introduce new fields/types
// without breaking these tests — only renames or removals will. This keeps
// the test surface aligned with "things downstream consumers depend on"
// rather than "the exact shape of the schema today".

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    GraphQLEnumType,
    GraphQLNonNull,
    GraphQLObjectType,
    GraphQLInputObjectType,
    GraphQLList,
    isNonNullType,
    isListType,
    getNamedType,
} from 'graphql';
import { schema } from '../helpers/gql';

const queryType = schema.getQueryType();
const mutationType = schema.getMutationType();

const expectField = (type: GraphQLObjectType | undefined | null, name: string) => {
    assert.ok(type, `${name}: parent type missing`);
    const field = type.getFields()[name];
    assert.ok(field, `field ${type.name}.${name} should exist`);
    return field;
};

const argNames = (field: { args: ReadonlyArray<{ name: string }> }) =>
    new Set(field.args.map((a) => a.name));

describe('Root types', () => {
    test('Query and Mutation are defined', () => {
        assert.ok(queryType, 'Query type must exist');
        assert.ok(mutationType, 'Mutation type must exist');
    });
});

describe('Enums', () => {
    test('Role enum contains NORMAL and ADMIN', () => {
        const e = schema.getType('Role') as GraphQLEnumType;
        assert.ok(e);
        const values = e.getValues().map((v) => v.name);
        for (const required of ['NORMAL', 'ADMIN']) {
            assert.ok(values.includes(required), `Role must include ${required}`);
        }
    });

    test('PurchaseOrderStatus includes the documented states', () => {
        const e = schema.getType('PurchaseOrderStatus') as GraphQLEnumType;
        const values = e.getValues().map((v) => v.name);
        for (const required of ['SUBMITTED', 'PAID', 'ORDERED_FROM_VENDOR', 'FULFILLED']) {
            assert.ok(values.includes(required), `PurchaseOrderStatus must include ${required}`);
        }
    });

    test('Currency includes EUR', () => {
        const e = schema.getType('Currency') as GraphQLEnumType;
        assert.ok(e.getValues().some((v) => v.name === 'EUR'));
    });
});

describe('User object type does not leak sensitive fields', () => {
    test('User has no password / otp / token fields exposed', () => {
        const user = schema.getType('User') as GraphQLObjectType;
        const fieldNames = Object.keys(user.getFields());
        for (const forbidden of ['password', 'otp', 'otpCreatedAt']) {
            assert.ok(!fieldNames.includes(forbidden),
                `User must NOT expose ${forbidden}; current fields: ${fieldNames.join(', ')}`);
        }
    });

    test('User exposes id, name, email, phoneNumber, role', () => {
        const user = schema.getType('User') as GraphQLObjectType;
        const fields = user.getFields();
        for (const required of ['id', 'name', 'email', 'phoneNumber', 'role']) {
            assert.ok(fields[required], `User must expose ${required}`);
        }
    });
});

describe('Mutation argument shape', () => {
    test('registerUser requires name, phoneNumber, email, password (all String!)', () => {
        const field = expectField(mutationType, 'registerUser');
        for (const name of ['name', 'phoneNumber', 'email', 'password']) {
            const arg = field.args.find((a) => a.name === name);
            assert.ok(arg, `arg ${name} must exist`);
            assert.ok(arg.type instanceof GraphQLNonNull, `arg ${name} must be non-null`);
            assert.equal(getNamedType(arg.type).name, 'String');
        }
    });

    test('logInUser requires emailOrPhone and password', () => {
        const field = expectField(mutationType, 'logInUser');
        const names = argNames(field);
        assert.ok(names.has('emailOrPhone'));
        assert.ok(names.has('password'));
    });

    test('verifyPhoneNumber accepts userId: Int! and otp: String!', () => {
        const field = expectField(mutationType, 'verifyPhoneNumber');
        const userId = field.args.find((a) => a.name === 'userId');
        const otp = field.args.find((a) => a.name === 'otp');
        assert.ok(userId && userId.type instanceof GraphQLNonNull);
        assert.equal(getNamedType(userId.type).name, 'Int');
        assert.ok(otp && otp.type instanceof GraphQLNonNull);
        assert.equal(getNamedType(otp.type).name, 'String');
    });

    test('admin CRUD mutations exist', () => {
        for (const name of [
            'createProduct', 'updateProduct', 'deleteProduct',
            'createItem', 'updateItem', 'deleteItem',
            'createPurchaseOrder', 'updatePurchaseOrder', 'deletePurchaseOrder',
        ]) {
            expectField(mutationType, name);
        }
    });
});

describe('Query argument shape', () => {
    test('list queries accept take, skip, orderBy', () => {
        for (const name of ['listAllProducts', 'listAllItems', 'listAllPurchaseOrders']) {
            const field = expectField(queryType, name);
            const a = argNames(field);
            assert.ok(a.has('take'), `${name} should accept take`);
            assert.ok(a.has('skip'), `${name} should accept skip`);
            assert.ok(a.has('orderBy'), `${name} should accept orderBy`);
        }
    });

    test('orderBy is a list of input objects', () => {
        const field = expectField(queryType, 'listAllProducts');
        const orderBy = field.args.find((a) => a.name === 'orderBy');
        assert.ok(orderBy);
        const t = orderBy.type;
        // orderBy type is `[ProductOrderByInput!]` — optional outer list of
        // required input objects. Assert structurally without pinning whether
        // the outer list is itself required.
        const inner = isListType(t)
            ? t.ofType
            : isListType((t as GraphQLNonNull<GraphQLList<unknown>>).ofType)
                ? (t as GraphQLNonNull<GraphQLList<unknown>>).ofType.ofType
                : null;
        assert.ok(inner, 'orderBy must be a list type');
        assert.equal(getNamedType(inner as never).name, 'ProductOrderByInput');
    });
});

describe('Input types', () => {
    test('CreateProductInput requires name, currency, price; other fields optional', () => {
        const t = schema.getType('CreateProductInput') as GraphQLInputObjectType;
        const f = t.getFields();
        const required = (n: string) => isNonNullType(f[n].type);
        assert.ok(required('name'));
        assert.ok(required('currency'));
        assert.ok(required('price'));
        for (const optional of ['upc', 'brand', 'model', 'weightInKgs']) {
            assert.ok(!required(optional), `${optional} must be optional`);
        }
    });

    test('CreateItemInput requires userId, code, name', () => {
        const t = schema.getType('CreateItemInput') as GraphQLInputObjectType;
        const f = t.getFields();
        for (const required of ['userId', 'code', 'name']) {
            assert.ok(isNonNullType(f[required].type), `${required} must be required`);
        }
    });

    test('CreatePurchaseOrderInput requires entries as a list', () => {
        const t = schema.getType('CreatePurchaseOrderInput') as GraphQLInputObjectType;
        const entries = t.getFields().entries;
        assert.ok(entries);
        assert.ok(isNonNullType(entries.type));
        const inner = (entries.type as GraphQLNonNull<unknown>).ofType;
        assert.ok(isListType(inner));
    });
});

describe('Response object types', () => {
    test('AuthResponse exposes error, token, user fields', () => {
        const t = schema.getType('AuthResponse') as GraphQLObjectType;
        const f = t.getFields();
        assert.ok(f.error);
        assert.ok(f.token);
        assert.ok(f.user);
    });

    test('RegisterUserResponse exposes userId and error', () => {
        const t = schema.getType('RegisterUserResponse') as GraphQLObjectType;
        const f = t.getFields();
        assert.ok(f.userId);
        assert.ok(f.error);
    });
});
