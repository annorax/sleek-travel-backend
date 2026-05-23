import 'dotenv/config';
import SchemaBuilder from '@pothos/core';
import PrismaPlugin from '@pothos/plugin-prisma';
import ScopeAuthPlugin from '@pothos/plugin-scope-auth';
import type PrismaTypes from './generated/pothos-types';
import { getDatamodel } from './generated/pothos-types';
import { PrismaClient } from './generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { GraphQLContext } from './context';
import { DateTimeResolver } from 'graphql-scalars';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
export const prisma = new PrismaClient({ adapter });

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
        dmmf: getDatamodel(),
    },
});

builder.addScalarType('DateTime', DateTimeResolver, {});
