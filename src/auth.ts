import { PrismaClient, User, Role } from '@prisma/client';
import { JwtPayload, sign, verify } from 'jsonwebtoken';
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { AuthCheckerInterface, ResolverData } from 'type-graphql';
import { GraphQLContext } from './context';

const scryptAsync = promisify(scrypt);

const authSecret = <string>process.env.AUTH_SECRET;
const emailVerificationSecret = <string>process.env.EMAIL_VERIFICATION_SECRET;

export function createAuthToken(user: User): string {
    return sign({ userId: user.id }, authSecret);
}

export async function authenticateUser(
    prisma: PrismaClient,
    request: Request
): Promise<User | null> {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
        return null;
    }
    const tokenizedAuthHeader = authHeader.split(' ');
    if (tokenizedAuthHeader[0] !== "Bearer") {
        return null;
    }
    const token = tokenizedAuthHeader[1];
    const tokenPayload = verify(token, authSecret) as JwtPayload;
    const userId = tokenPayload.userId;
    return await prisma.user.findUnique({ where: { id: userId } });
}

export function createEmailVerificationToken(user: User): string {
    return sign({ userId: user.id }, emailVerificationSecret, { expiresIn: 60 * 60 });
}

export function verifyEmailAddress(token:string): number {
    const tokenPayload = verify(token, emailVerificationSecret) as JwtPayload;
    return tokenPayload.userId;
}

export async function hashPassword(password: string) {
    const salt = randomBytes(16).toString("hex");
    const buf = (await scryptAsync(password, salt, 64)) as Buffer;
    return `${buf.toString("hex")}.${salt}`;
}
  
export async function comparePassword(
    storedPassword: string,
    suppliedPassword: string
): Promise<boolean> {
    const [hashedPassword, salt] = storedPassword.split(".");
    const hashedPasswordBuf = Buffer.from(hashedPassword, "hex");
    const suppliedPasswordBuf = (await scryptAsync(suppliedPassword, salt, 64)) as Buffer;
    return timingSafeEqual(hashedPasswordBuf, suppliedPasswordBuf);
}

export class CustomAuthChecker implements AuthCheckerInterface<GraphQLContext> {
    check({ root, args, context, info }: ResolverData<GraphQLContext>, roles: Role[]) {
        if (!context.currentUser) {
            return false;
        }
        if (!roles.length) {
            return true;
        }
        return roles.indexOf(context.currentUser.role) > -1;
    }
  }