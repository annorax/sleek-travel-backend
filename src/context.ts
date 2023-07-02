import { PrismaClient, User } from "@prisma/client";
import { authenticateUser } from "./auth";

const prisma = new PrismaClient();

export type GraphQLContext = {
    initialContext: any,
    prisma: PrismaClient,
    currentUser: null | User
};

export async function createContext(
    initialContext: any
): Promise<GraphQLContext> {
    const userId = await authenticateUser(initialContext.request);
    const currentUser = userId ? await prisma.user.findUnique({ where: { id: userId } }) : null;
    return {
        initialContext,
        prisma,
        currentUser
    };
}
