import { PrismaClient, User } from '@prisma/client';
import { authenticateUser } from './auth';

const prisma = new PrismaClient();

export type GraphQLContext = {
    initialContext: any,
    prisma: PrismaClient,
    currentUser: null | User
};

export async function createContext(
    initialContext: any
): Promise<GraphQLContext> {
    return {
        initialContext,
        prisma,
        currentUser: await authenticateUser(prisma, initialContext.request)
    };
}
