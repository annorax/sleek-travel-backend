import { PrismaClient, User } from '@prisma/client';
import { JwtPayload, verify } from 'jsonwebtoken';
 
export async function authenticateUser(
  prisma: PrismaClient,
  request: Request
): Promise<User | null> {
  const header = request.headers.get('authorization');
  if (header !== null) {
    const token = header.split(' ')[1];
    const tokenPayload = verify(token, <string>process.env.APP_AUTH_SECRET) as JwtPayload;
    const userId = tokenPayload.userId;
    return await prisma.user.findUnique({ where: { id: userId } });
  }
  return null;
}