import type { PrismaClient, User, AccessToken } from './generated/prisma/client';
import { prisma } from './builder';

export type GraphQLContext = {
    initialContext: any;
    prisma: PrismaClient;
    user: User | null;
    token: string | null;
};

export async function createContext(initialContext: any): Promise<GraphQLContext> {
    const authHeader = initialContext.request.headers.get('authorization');
    let user: User | null = null;
    let token: string | null = null;
    if (authHeader) {
        const parts = authHeader.split(' ');
        if (parts[0] === 'Bearer' && parts[1]) {
            token = parts[1];
            const tokenObject: AccessToken | null = await prisma.accessToken.findUnique({
                where: { value: parts[1], expired: false },
            });
            const userId = tokenObject?.userId;
            user = userId ? await prisma.user.findUnique({ where: { id: userId } }) : null;
        }
    }
    return { initialContext, prisma, user, token };
}
