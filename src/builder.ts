import SchemaBuilder from '@pothos/core';
import PrismaPlugin from '@pothos/plugin-prisma';
import ScopeAuthPlugin from '@pothos/plugin-scope-auth';
import type PrismaTypes from '@pothos/plugin-prisma/generated';
import { PrismaClient, Prisma } from '@prisma/client';
import type { GraphQLContext } from './context';
import { DateTimeResolver } from 'graphql-scalars';

export const prisma = new PrismaClient();

export const builder = new SchemaBuilder<{
    PrismaTypes: PrismaTypes;
    Context: GraphQLContext;
    AuthScopes: {
        loggedIn: boolean;
        admin: boolean;
    };
    Scalars: {
        DateTime: { Input: Date; Output: Date };
    };
}>({
    plugins: [ScopeAuthPlugin, PrismaPlugin],
    scopeAuth: {
        authScopes: (context: GraphQLContext) => ({
            loggedIn: !!context.user,
            admin: context.user?.role === 'ADMIN',
        }),
        unauthorizedError: () => new Error('Unauthorized'),
    },
    prisma: {
        client: prisma,
        dmmf: Prisma.dmmf,
    },
});

builder.addScalarType('DateTime', DateTimeResolver, {});
