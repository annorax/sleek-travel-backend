import { PrismaClient, AccessToken, User } from "@prisma/client";

const prisma = new PrismaClient();

export type GraphQLContext = {
    initialContext: any,
    prisma: PrismaClient,
    currentUser: null | User
};

export async function createContext(
    initialContext: any
): Promise<GraphQLContext> {
    const authHeader = initialContext.request.headers.get('authorization');
    let currentUser = null;
    if (authHeader) {
        const tokenizedAuthHeader = authHeader.split(' ');
        if (tokenizedAuthHeader[0] === "Bearer") {
            const tokenValue = tokenizedAuthHeader[1];
            const token:AccessToken|null = await prisma.accessToken.findUnique({ where: { value: tokenValue } });
            const userId = token?.userId;
            currentUser = userId ? await prisma.user.findUnique({ where: { id: userId } }) : null;
        }
    }
    return { initialContext, prisma, currentUser };
}
