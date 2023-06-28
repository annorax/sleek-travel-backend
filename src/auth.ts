import { PrismaClient, User } from '@prisma/client';
import { JwtPayload, sign, verify } from 'jsonwebtoken';
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt);

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