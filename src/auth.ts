import { PrismaClient, User } from '@prisma/client';
import { JwtPayload, sign, verify } from 'jsonwebtoken';

const secret = <string>process.env.APP_AUTH_SECRET;

export function createTokenForUser(user: User): string {
    return sign({ userId: user.id }, secret);
}

export async function authenticateUser(
    prisma: PrismaClient,
    request: Request
): Promise<User | null> {
    const header = request.headers.get('authorization');
    if (header !== null) {
        const token = header.split(' ')[1];
        const tokenPayload = verify(token, secret) as JwtPayload;
        const userId = tokenPayload.userId;
        return await prisma.user.findUnique({ where: { id: userId } });
    }
    return null;
}