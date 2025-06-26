import { User, Role, PrismaClient } from "@prisma/client";
import { JwtPayload, sign, verify } from 'jsonwebtoken';
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { ArgsDictionary, AuthCheckerInterface, ResolverData } from 'type-graphql';
import { GraphQLContext } from "./context";
import { createTransport } from "nodemailer";
import { PinpointSMSVoiceV2Client, SendTextMessageCommand } from "@aws-sdk/client-pinpoint-sms-voice-v2";
import { GraphQLResolveInfo } from "graphql";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import parse from 'parse-duration'

const linkExpirationDuration = "1 hour";
const phoneNumberVerificationOTPExpirationDuration = "5 minutes";
const appName = "SleekTravel";
const originationIdentity = "Sleek-Travel";
const from = `${appName} <noreply@sleek.travel>`;

const maxLoginTokenGenerationAttempts = 10;

const scryptAsync = promisify(scrypt);

const tokenSecret = <string>process.env.TOKEN_SECRET;

const emailTransport = createTransport({
    host: <string>process.env.SMTP_ENDPOINT_URL,
    port: parseInt(<string>process.env.SMTP_ENDPOINT_PORT),
    secure: true,
    auth: {
      user: <string>process.env.SMTP_USERNAME,
      pass: <string>process.env.SMTP_PASSWORD
    }
});

const pinpointSMSVoiceV2Client = new PinpointSMSVoiceV2Client({});

export async function sendEmailVerificationRequest(user:User):Promise<void> {
    const url = `${<string>process.env.CLIENT_BASE_URL}/verify-email?token=${createToken(user)}`;
    await emailTransport.sendMail({
        from: from,
        to: `${user.name} <${user.email}>`,
        subject: `${appName} Account Activation`,
        text: `Simply visit ${url} to verify your email address and activate your account. This link is valid for ${linkExpirationDuration}.`,
        html: `Simply click <a href="${url}">this link</a> to verify your email address and activate your account. This link is valid for ${linkExpirationDuration}.`
    });
}

export async function sendEmailPasswordResetLink(user:User):Promise<void> {
    const url = `${<string>process.env.CLIENT_BASE_URL}/reset-password?token=${createToken(user)}`;
    await emailTransport.sendMail({
        from: from,
        to: `${user.name} <${user.email}>`,
        subject: `${appName} Password Reset`,
        text: `Simply visit ${url} to reset your password. This link is valid for ${linkExpirationDuration}.`,
        html: `Simply click <a href="${url}">this link</a> to reset your password. This link is valid for ${linkExpirationDuration}.`
    });
}

export async function sendPhoneNumberPasswordResetLink(user:User): Promise<void> {
    const url = `${<string>process.env.CLIENT_BASE_URL}/reset-password?token=${createToken(user)}`;
    await pinpointSMSVoiceV2Client.send(new SendTextMessageCommand({
        DestinationPhoneNumber: user.phoneNumber,
        OriginationIdentity: originationIdentity,
        MessageBody: `To reset your ${appName} password please visit this link: ${url} (valid for ${linkExpirationDuration})`
    })).catch(err => console.error(err));;
}

export async function sendPhoneNumberVerificationRequest(user:User): Promise<void> {
    await pinpointSMSVoiceV2Client.send(new SendTextMessageCommand({
        DestinationPhoneNumber: user.phoneNumber,
        OriginationIdentity: originationIdentity,
        MessageBody: `Your ${appName} OTP is ${user.otp.toString().padStart(6, "0")} (valid for ${phoneNumberVerificationOTPExpirationDuration})`
    })).catch(err => console.error(err));;
}

function createToken(user: User): string {
    return sign({ userId: user.id }, tokenSecret, { expiresIn: linkExpirationDuration });
}

export function verifyEmailAddress(token:string): number {
    const tokenPayload = verify(token, tokenSecret) as JwtPayload;
    return tokenPayload.userId;
}

export function verifyPhoneNumber(user:User, otp:string): void {
    const phoneNumberVerificationOTPExpirationDurationInMs:number = parse(phoneNumberVerificationOTPExpirationDuration) ?? 0;
    if (user.otpCreatedAt.getTime() < new Date().getTime() - phoneNumberVerificationOTPExpirationDurationInMs) {
        throw "OTP expired";
    }
    if (user?.otp !== parseInt(otp)) {
        throw "OTP mismatch";
    }
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

export async function expireAccessToken(prisma:PrismaClient, token:string) {
    await prisma.accessToken.update({ where: { value: token }, data: { expired: true }});
}

export async function createLoginAndToken(prisma:PrismaClient, ipAddress:string|null, userId:number, explicit:boolean):Promise<string> {
    const tokenValue = randomBytes(64).toString("base64url");
    let retry:boolean;
    let attempts = 0;
    do {
        retry = false;
        attempts++;
        try {
            await prisma.accessToken.create({
                data: {
                    value: tokenValue,
                    userId: userId
                }
            });
        } catch (error) {
            if (error instanceof PrismaClientKnownRequestError && error.code === "P2002") { // unique constraint violation
                retry = true;
            } else {
                throw error;
            }
        }
    } while (retry && attempts <= maxLoginTokenGenerationAttempts);
    await prisma.login.create({
        data: {
            ...(ipAddress ? { ipAddress } : {}),
            userId: userId,
            tokenValue: tokenValue,
            explicit: explicit
        }
    });
    return tokenValue;
}

export class CustomAuthChecker implements AuthCheckerInterface<GraphQLContext> {
    check({ root, args, context, info }: ResolverData<GraphQLContext>, roles: Role[]) {
        if (!context.user) {
            return false;
        }
        const { ownDataOnly } = info.parentType.getFields()[info.fieldName].extensions || {}
        if (!roles.length) {
            return ownDataOnly ?  this.accessingOwnData(root, args, context, info) : true;
        }
        if (roles.indexOf(context.user.role) === -1) {
            return false;
        }
        if (!ownDataOnly) {
            return true;
        }
        return context.user.role === Role.ADMIN || this.accessingOwnData(root, args, context, info);
    }
    
    private accessingOwnData(root: any, args: ArgsDictionary, context: GraphQLContext, info: GraphQLResolveInfo): boolean {
        const userIdFilter = args?.where?.userId?.equals;
        const currentUserId = context.user?.id;
        return userIdFilter && userIdFilter === currentUserId;
    }
}