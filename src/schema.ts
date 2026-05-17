import { builder, prisma } from './builder';
import type { User as PrismaUser } from '@prisma/client';
import { Role, Prisma } from '@prisma/client';

const n2u = <T>(v: T | null | undefined): T | undefined => v ?? undefined;

const toOrderBy = <T>(
    entries: Array<{ field: string; direction?: 'asc' | 'desc' | null }> | null | undefined,
): T[] | undefined => {
    if (!entries?.length) return undefined;
    return entries.map(({ field, direction }) => ({ [field]: direction ?? 'asc' }) as T);
};
import crypto from 'crypto';
import {
    comparePassword, createLoginAndToken, expireAccessToken, hashPassword,
    sendEmailPasswordResetLink, sendEmailVerificationRequest,
    sendPhoneNumberPasswordResetLink, sendPhoneNumberVerificationRequest,
    verifyEmailAddress, verifyPhoneNumber,
} from './auth';
import { extractIpAddress } from './util';

const generateOTP = () => crypto.randomInt(0, 1000000);

// ── Enums ──────────────────────────────────────────────────────────────────────

const RoleEnum = builder.enumType('Role', { values: ['NORMAL', 'ADMIN'] as const });
const CurrencyEnum = builder.enumType('Currency', { values: ['EUR'] as const });
const PurchaseOrderStatusEnum = builder.enumType('PurchaseOrderStatus', {
    values: ['SUBMITTED', 'PAID', 'ORDERED_FROM_VENDOR', 'FULFILLED'] as const,
});

const SortOrderEnum = builder.enumType('SortOrder', { values: ['asc', 'desc'] as const });

const ProductScalarFieldEnum = builder.enumType('ProductScalarFieldEnum', {
    values: ['id', 'name', 'upc', 'upcScanned', 'description', 'amazonASIN', 'country', 'brand',
        'model', 'color', 'weightInKgs', 'widthInCms', 'heightInCms', 'depthInCms',
        'currency', 'price', 'createdAt', 'updatedAt'] as const,
});

const ItemScalarFieldEnum = builder.enumType('ItemScalarFieldEnum', {
    values: ['id', 'userId', 'code', 'name', 'description', 'productId',
        'weightInKgs', 'widthInCms', 'heightInCms', 'depthInCms', 'createdAt', 'updatedAt'] as const,
});

const PurchaseOrderScalarFieldEnum = builder.enumType('PurchaseOrderScalarFieldEnum', {
    values: ['id', 'userId', 'price', 'status', 'createdAt', 'updatedAt'] as const,
});

const ProductOrderByInput = builder.inputType('ProductOrderByInput', {
    fields: (t) => ({
        field: t.field({ type: ProductScalarFieldEnum, required: true }),
        direction: t.field({ type: SortOrderEnum }),
    }),
});

const ItemOrderByInput = builder.inputType('ItemOrderByInput', {
    fields: (t) => ({
        field: t.field({ type: ItemScalarFieldEnum, required: true }),
        direction: t.field({ type: SortOrderEnum }),
    }),
});

const PurchaseOrderOrderByInput = builder.inputType('PurchaseOrderOrderByInput', {
    fields: (t) => ({
        field: t.field({ type: PurchaseOrderScalarFieldEnum, required: true }),
        direction: t.field({ type: SortOrderEnum }),
    }),
});

// ── Prisma object types ────────────────────────────────────────────────────────
// Sensitive User fields (password, otp, etc.) are intentionally not exposed.

const UserRef = builder.prismaObject('User', {
    fields: (t) => ({
        id: t.exposeInt('id'),
        name: t.exposeString('name'),
        phoneNumber: t.exposeString('phoneNumber'),
        email: t.exposeString('email'),
        role: t.field({ type: RoleEnum, resolve: (u) => u.role }),
        items: t.relation('items'),
        purchaseOrders: t.relation('purchaseOrders'),
    }),
});

builder.prismaObject('Product', {
    fields: (t) => ({
        id: t.exposeInt('id'),
        name: t.exposeString('name'),
        upc: t.exposeString('upc', { nullable: true }),
        upcScanned: t.exposeBoolean('upcScanned', { nullable: true }),
        description: t.exposeString('description', { nullable: true }),
        amazonASIN: t.exposeString('amazonASIN', { nullable: true }),
        country: t.exposeString('country', { nullable: true }),
        brand: t.exposeString('brand', { nullable: true }),
        model: t.exposeString('model', { nullable: true }),
        color: t.exposeString('color', { nullable: true }),
        weightInKgs: t.exposeFloat('weightInKgs', { nullable: true }),
        widthInCms: t.exposeFloat('widthInCms', { nullable: true }),
        heightInCms: t.exposeFloat('heightInCms', { nullable: true }),
        depthInCms: t.exposeFloat('depthInCms', { nullable: true }),
        currency: t.field({ type: CurrencyEnum, resolve: (p) => p.currency }),
        price: t.field({ type: 'String', resolve: (p) => p.price.toString() }),
        items: t.relation('items'),
        purchaseOrderEntries: t.relation('purchaseOrderEntries'),
    }),
});

builder.prismaObject('Item', {
    fields: (t) => ({
        id: t.exposeInt('id'),
        code: t.exposeString('code'),
        name: t.exposeString('name'),
        description: t.exposeString('description', { nullable: true }),
        weightInKgs: t.exposeFloat('weightInKgs', { nullable: true }),
        widthInCms: t.exposeFloat('widthInCms', { nullable: true }),
        heightInCms: t.exposeFloat('heightInCms', { nullable: true }),
        depthInCms: t.exposeFloat('depthInCms', { nullable: true }),
        user: t.relation('user'),
        product: t.relation('product', { nullable: true }),
    }),
});

builder.prismaObject('PurchaseOrder', {
    fields: (t) => ({
        id: t.exposeInt('id'),
        price: t.field({ type: 'String', resolve: (po) => po.price.toString() }),
        status: t.field({ type: PurchaseOrderStatusEnum, resolve: (po) => po.status }),
        user: t.relation('user'),
        entries: t.relation('entries'),
    }),
});

builder.prismaObject('PurchaseOrderEntry', {
    fields: (t) => ({
        id: t.exposeInt('id'),
        quantity: t.exposeInt('quantity'),
        currency: t.field({ type: CurrencyEnum, resolve: (e) => e.currency }),
        unitPrice: t.field({ type: 'String', resolve: (e) => e.unitPrice.toString() }),
        product: t.relation('product'),
        order: t.relation('order'),
    }),
});

// ── Response types ─────────────────────────────────────────────────────────────

const RegisterUserResponse = builder.objectRef<{
    userId?: number;
    error?: string;
}>('RegisterUserResponse').implement({
    fields: (t) => ({
        userId: t.int({ nullable: true, resolve: (p) => p.userId ?? null }),
        error: t.string({ nullable: true, resolve: (p) => p.error ?? null }),
    }),
});

const AuthResponse = builder.objectRef<{
    error?: string;
    token?: string;
    user?: PrismaUser | null;
}>('AuthResponse').implement({
    fields: (t) => ({
        error: t.string({ nullable: true, resolve: (p) => p.error ?? null }),
        token: t.string({ nullable: true, resolve: (p) => p.token ?? null }),
        user: t.field({ type: UserRef, nullable: true, resolve: (p) => p.user ?? null }),
    }),
});

const SimpleResponse = builder.objectRef<{
    error?: string;
}>('SimpleResponse').implement({
    fields: (t) => ({
        error: t.string({ nullable: true, resolve: (p) => p.error ?? null }),
    }),
});

// ── Input types ────────────────────────────────────────────────────────────────

const CreateProductInput = builder.inputType('CreateProductInput', {
    fields: (t) => ({
        name: t.string({ required: true }),
        upc: t.string(),
        upcScanned: t.boolean(),
        description: t.string(),
        amazonASIN: t.string(),
        country: t.string(),
        brand: t.string(),
        model: t.string(),
        color: t.string(),
        weightInKgs: t.float(),
        widthInCms: t.float(),
        heightInCms: t.float(),
        depthInCms: t.float(),
        currency: t.field({ type: CurrencyEnum, required: true }),
        price: t.string({ required: true }),
    }),
});

const UpdateProductInput = builder.inputType('UpdateProductInput', {
    fields: (t) => ({
        name: t.string(),
        upc: t.string(),
        upcScanned: t.boolean(),
        description: t.string(),
        amazonASIN: t.string(),
        country: t.string(),
        brand: t.string(),
        model: t.string(),
        color: t.string(),
        weightInKgs: t.float(),
        widthInCms: t.float(),
        heightInCms: t.float(),
        depthInCms: t.float(),
        currency: t.field({ type: CurrencyEnum }),
        price: t.string(),
    }),
});

const CreateItemInput = builder.inputType('CreateItemInput', {
    fields: (t) => ({
        userId: t.int({ required: true }),
        code: t.string({ required: true }),
        name: t.string({ required: true }),
        description: t.string(),
        productId: t.int(),
        weightInKgs: t.float(),
        widthInCms: t.float(),
        heightInCms: t.float(),
        depthInCms: t.float(),
    }),
});

const UpdateItemInput = builder.inputType('UpdateItemInput', {
    fields: (t) => ({
        name: t.string(),
        description: t.string(),
        productId: t.int(),
        weightInKgs: t.float(),
        widthInCms: t.float(),
        heightInCms: t.float(),
        depthInCms: t.float(),
    }),
});

const PurchaseOrderEntryInput = builder.inputType('PurchaseOrderEntryInput', {
    fields: (t) => ({
        productId: t.int({ required: true }),
        quantity: t.int({ required: true }),
        currency: t.field({ type: CurrencyEnum, required: true }),
        unitPrice: t.string({ required: true }),
    }),
});

const CreatePurchaseOrderInput = builder.inputType('CreatePurchaseOrderInput', {
    fields: (t) => ({
        userId: t.int({ required: true }),
        price: t.string({ required: true }),
        status: t.field({ type: PurchaseOrderStatusEnum, required: true }),
        entries: t.field({ type: [PurchaseOrderEntryInput], required: true }),
    }),
});

const UpdatePurchaseOrderInput = builder.inputType('UpdatePurchaseOrderInput', {
    fields: (t) => ({
        price: t.string(),
        status: t.field({ type: PurchaseOrderStatusEnum }),
    }),
});

// ── Queries ────────────────────────────────────────────────────────────────────

builder.queryType({
    fields: (t) => ({
        listAllProducts: t.prismaField({
            type: ['Product'],
            authScopes: { loggedIn: true },
            args: {
                take: t.arg.int(),
                skip: t.arg.int(),
                orderBy: t.arg({ type: [ProductOrderByInput] }),
            },
            resolve: (query, _root, args) =>
                prisma.product.findMany({
                    ...query,
                    take: args.take ?? undefined,
                    skip: args.skip ?? undefined,
                    orderBy: toOrderBy<Prisma.ProductOrderByWithRelationInput>(args.orderBy),
                }),
        }),

        listAllItems: t.prismaField({
            type: ['Item'],
            authScopes: { loggedIn: true },
            args: {
                take: t.arg.int(),
                skip: t.arg.int(),
                orderBy: t.arg({ type: [ItemOrderByInput] }),
            },
            resolve: (query, _root, args, ctx) =>
                prisma.item.findMany({
                    ...query,
                    take: args.take ?? undefined,
                    skip: args.skip ?? undefined,
                    orderBy: toOrderBy<Prisma.ItemOrderByWithRelationInput>(args.orderBy),
                    where: ctx.user!.role === Role.ADMIN ? undefined : { userId: ctx.user!.id },
                }),
        }),

        listAllPurchaseOrders: t.prismaField({
            type: ['PurchaseOrder'],
            authScopes: { loggedIn: true },
            args: {
                take: t.arg.int(),
                skip: t.arg.int(),
                orderBy: t.arg({ type: [PurchaseOrderOrderByInput] }),
            },
            resolve: (query, _root, args, ctx) =>
                prisma.purchaseOrder.findMany({
                    ...query,
                    take: args.take ?? undefined,
                    skip: args.skip ?? undefined,
                    orderBy: toOrderBy<Prisma.PurchaseOrderOrderByWithRelationInput>(args.orderBy),
                    where: ctx.user!.role === Role.ADMIN ? undefined : { userId: ctx.user!.id },
                }),
        }),
    }),
});

// ── Mutations ──────────────────────────────────────────────────────────────────

builder.mutationType({
    fields: (t) => ({

        // ── Auth ───────────────────────────────────────────────────────────────

        registerUser: t.field({
            type: RegisterUserResponse,
            args: {
                name: t.arg.string({ required: true }),
                phoneNumber: t.arg.string({ required: true }),
                email: t.arg.string({ required: true }),
                password: t.arg.string({ required: true }),
            },
            resolve: async (_root, args) => {
                const otp = generateOTP();
                const user = await prisma.user.create({
                    data: {
                        name: args.name,
                        phoneNumber: args.phoneNumber,
                        otp,
                        otpCreatedAt: new Date(),
                        email: args.email.toLowerCase(),
                        password: await hashPassword(args.password),
                        role: Role.NORMAL,
                    },
                });
                const result: { userId: number; error?: string } = { userId: user.id };
                const failures: string[] = [];
                try { await sendEmailVerificationRequest(user); } catch { failures.push('email'); }
                try { await sendPhoneNumberVerificationRequest(user); } catch { failures.push('SMS'); }
                if (failures.length) {
                    result.error = `Failed to send ${failures.join(' and ')}. Please check back later by trying to log in.`;
                }
                return result;
            },
        }),

        logInUser: t.field({
            type: AuthResponse,
            args: {
                emailOrPhone: t.arg.string({ required: true }),
                password: t.arg.string({ required: true }),
            },
            resolve: async (_root, args, ctx) => {
                const user = await prisma.user.findFirst({
                    where: {
                        OR: [
                            { email: args.emailOrPhone.toLowerCase() },
                            { phoneNumber: args.emailOrPhone.toLowerCase() },
                        ],
                    },
                });
                if (!user) return { error: 'No user account matches the provided email address or phone number.' };
                if (!(await comparePassword(user.password, args.password))) return { error: 'Incorrect password.' };
                const response: { error?: string; token?: string; user: typeof user } = { user };
                if (!user.emailVerified) {
                    response.error = 'Unverified email address.';
                } else if (!user.phoneNumberVerified) {
                    response.error = 'Unverified phone number.';
                } else {
                    response.token = await createLoginAndToken(
                        prisma, extractIpAddress(ctx.initialContext.req), user.id, true,
                    );
                }
                return response;
            },
        }),

        logOutUser: t.field({
            type: 'Boolean',
            authScopes: { loggedIn: true },
            resolve: async (_root, _args, ctx) => {
                await expireAccessToken(prisma, ctx.token!);
                return true;
            },
        }),

        verifyPhoneNumber: t.field({
            type: 'Boolean',
            args: {
                userId: t.arg.int({ required: true }),
                otp: t.arg.string({ required: true }),
            },
            resolve: async (_root, args) => {
                const user = await prisma.user.findUnique({ where: { id: args.userId } });
                if (!user) throw new Error('User not found');
                verifyPhoneNumber(user, args.otp);
                await prisma.user.updateMany({
                    where: { id: args.userId, phoneNumberVerified: null },
                    data: { phoneNumberVerified: new Date() },
                });
                return true;
            },
        }),

        verifyEmailAddress: t.field({
            type: 'Boolean',
            args: { token: t.arg.string({ required: true }) },
            resolve: async (_root, args) => {
                const userId = verifyEmailAddress(args.token);
                await prisma.user.updateMany({
                    where: { id: userId, emailVerified: null },
                    data: { emailVerified: new Date() },
                });
                return true;
            },
        }),

        resendEmailVerificationRequest: t.field({
            type: SimpleResponse,
            args: { email: t.arg.string({ required: true }) },
            resolve: async (_root, args) => {
                const user = await prisma.user.findUnique({ where: { email: args.email.toLowerCase() } });
                if (!user) return { error: 'User not found.' };
                try { await sendEmailVerificationRequest(user); }
                catch { return { error: 'Failed to send email.' }; }
                return {};
            },
        }),

        resendPhoneNumberVerificationRequest: t.field({
            type: SimpleResponse,
            args: { phoneNumber: t.arg.string({ required: true }) },
            resolve: async (_root, args) => {
                const otp = generateOTP();
                let user;
                try {
                    user = await prisma.user.update({
                        where: { phoneNumber: args.phoneNumber },
                        data: { otp, otpCreatedAt: new Date() },
                    });
                } catch { return { error: 'User not found.' }; }
                try { await sendPhoneNumberVerificationRequest(user); }
                catch { return { error: 'Failed to send SMS.' }; }
                return {};
            },
        }),

        sendPasswordResetLink: t.field({
            type: 'Boolean',
            args: { emailOrPhone: t.arg.string({ required: true }) },
            resolve: async (_root, args) => {
                const user = await prisma.user.findFirst({
                    where: {
                        OR: [
                            { email: args.emailOrPhone.toLowerCase() },
                            { phoneNumber: args.emailOrPhone.toLowerCase() },
                        ],
                    },
                });
                if (!user) throw new Error('User not found');
                await sendEmailPasswordResetLink(user);
                await sendPhoneNumberPasswordResetLink(user);
                return true;
            },
        }),

        validateToken: t.field({
            type: AuthResponse,
            args: { tokenValue: t.arg.string({ required: true }) },
            resolve: async (_root, args, ctx) => {
                const token = await prisma.accessToken.findUnique({
                    where: { value: args.tokenValue, expired: false },
                });
                if (!token) return { error: 'Token not found' };
                const user = await prisma.user.findUnique({ where: { id: token.userId } });
                if (!user) return { error: 'User not found' };
                const newToken = await createLoginAndToken(
                    prisma, extractIpAddress(ctx.initialContext.req), user.id, false,
                );
                await expireAccessToken(prisma, args.tokenValue);
                return { token: newToken, user };
            },
        }),

        // ── Admin CRUD ─────────────────────────────────────────────────────────

        createProduct: t.prismaField({
            type: 'Product',
            authScopes: { admin: true },
            args: { input: t.arg({ type: CreateProductInput, required: true }) },
            resolve: (query, _root, args) =>
                prisma.product.create({
                    ...query,
                    data: { ...args.input, price: args.input.price },
                }),
        }),

        updateProduct: t.prismaField({
            type: 'Product',
            authScopes: { admin: true },
            args: {
                id: t.arg.int({ required: true }),
                input: t.arg({ type: UpdateProductInput, required: true }),
            },
            resolve: (query, _root, args) =>
                prisma.product.update({
                    ...query,
                    where: { id: args.id },
                    data: {
                        name: n2u(args.input.name),
                        upc: n2u(args.input.upc),
                        upcScanned: n2u(args.input.upcScanned),
                        description: n2u(args.input.description),
                        amazonASIN: n2u(args.input.amazonASIN),
                        country: n2u(args.input.country),
                        brand: n2u(args.input.brand),
                        model: n2u(args.input.model),
                        color: n2u(args.input.color),
                        weightInKgs: n2u(args.input.weightInKgs),
                        widthInCms: n2u(args.input.widthInCms),
                        heightInCms: n2u(args.input.heightInCms),
                        depthInCms: n2u(args.input.depthInCms),
                        currency: n2u(args.input.currency),
                        price: n2u(args.input.price),
                    },
                }),
        }),

        deleteProduct: t.field({
            type: 'Boolean',
            authScopes: { admin: true },
            args: { id: t.arg.int({ required: true }) },
            resolve: async (_root, args) => {
                await prisma.product.delete({ where: { id: args.id } });
                return true;
            },
        }),

        createItem: t.prismaField({
            type: 'Item',
            authScopes: { admin: true },
            args: { input: t.arg({ type: CreateItemInput, required: true }) },
            resolve: (query, _root, args) =>
                prisma.item.create({
                    ...query,
                    data: { ...args.input },
                }),
        }),

        updateItem: t.prismaField({
            type: 'Item',
            authScopes: { admin: true },
            args: {
                id: t.arg.int({ required: true }),
                input: t.arg({ type: UpdateItemInput, required: true }),
            },
            resolve: (query, _root, args) =>
                prisma.item.update({
                    ...query,
                    where: { id: args.id },
                    data: {
                        name: n2u(args.input.name),
                        description: n2u(args.input.description),
                        productId: n2u(args.input.productId),
                        weightInKgs: n2u(args.input.weightInKgs),
                        widthInCms: n2u(args.input.widthInCms),
                        heightInCms: n2u(args.input.heightInCms),
                        depthInCms: n2u(args.input.depthInCms),
                    },
                }),
        }),

        deleteItem: t.field({
            type: 'Boolean',
            authScopes: { admin: true },
            args: { id: t.arg.int({ required: true }) },
            resolve: async (_root, args) => {
                await prisma.item.delete({ where: { id: args.id } });
                return true;
            },
        }),

        createPurchaseOrder: t.prismaField({
            type: 'PurchaseOrder',
            authScopes: { admin: true },
            args: { input: t.arg({ type: CreatePurchaseOrderInput, required: true }) },
            resolve: (query, _root, args) =>
                prisma.purchaseOrder.create({
                    ...query,
                    data: {
                        userId: args.input.userId,
                        price: args.input.price,
                        status: args.input.status,
                        entries: {
                            create: args.input.entries.map((e) => ({
                                productId: e.productId,
                                quantity: e.quantity,
                                currency: e.currency,
                                unitPrice: e.unitPrice,
                            })),
                        },
                    },
                }),
        }),

        updatePurchaseOrder: t.prismaField({
            type: 'PurchaseOrder',
            authScopes: { admin: true },
            args: {
                id: t.arg.int({ required: true }),
                input: t.arg({ type: UpdatePurchaseOrderInput, required: true }),
            },
            resolve: (query, _root, args) =>
                prisma.purchaseOrder.update({
                    ...query,
                    where: { id: args.id },
                    data: {
                        price: n2u(args.input.price),
                        status: n2u(args.input.status),
                    },
                }),
        }),

        deletePurchaseOrder: t.field({
            type: 'Boolean',
            authScopes: { admin: true },
            args: { id: t.arg.int({ required: true }) },
            resolve: async (_root, args) => {
                await prisma.purchaseOrder.delete({ where: { id: args.id } });
                return true;
            },
        }),
    }),
});
