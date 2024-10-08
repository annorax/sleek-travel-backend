import { PrismaClient, AccessToken, User } from "@prisma/client";

const prisma = new PrismaClient();

export type GraphQLContext = {
    initialContext: any,
    prisma: PrismaClient,
    user: null | User,
    token: null | string
};

export async function createContext(
    initialContext: any
): Promise<GraphQLContext> {
    const authHeader = initialContext.request.headers.get('authorization');
    let user = null;
    let token = null;
    if (authHeader) {
        const tokenizedAuthHeader = authHeader.split(' ');
        if (tokenizedAuthHeader[0] === "Bearer") {
            token = tokenizedAuthHeader[1];
            const tokenObject:AccessToken|null = await prisma.accessToken.findUnique({ where: { value: token } });
            const userId = tokenObject?.userId;
            user = userId ? await prisma.user.findUnique({ where: { id: userId } }) : null;
        }
    }
    return { initialContext, prisma, user, token };
}
