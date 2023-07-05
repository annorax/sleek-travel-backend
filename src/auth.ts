import { User, Role } from "@prisma/client";
import { JwtPayload, sign, verify } from 'jsonwebtoken';
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { ArgsDictionary, AuthCheckerInterface, ResolverData } from 'type-graphql';
import { GraphQLContext } from "./context";
import { createTransport } from "nodemailer";
import { PinpointSMSVoiceV2Client, SendTextMessageCommand } from "@aws-sdk/client-pinpoint-sms-voice-v2";
import ms from "ms";
import { GraphQLResolveInfo } from "graphql";

const emailVerificationLinkExpirationDuration = "1 hour";
const phoneNumberVerificationOTPExpirationDuration = "5 minutes";

const scryptAsync = promisify(scrypt);

const authSecret = <string>process.env.AUTH_SECRET;
const emailVerificationSecret = <string>process.env.EMAIL_VERIFICATION_SECRET;

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
    const url = `${<string>process.env.CLIENT_BASE_URL}/verify-email?token=${createEmailVerificationToken(user)}`;
    await emailTransport.sendMail({
        from: "Slim Travel <noreply@slim.travel>",
        to: `${user.name} <${user.email}>`,
        subject: "Account Activation",
        text: `Simply visit ${url} to verify your email address and activate your account. This link is valid for ${emailVerificationLinkExpirationDuration}.`,
        html: `Simply click <a href="${url}">this link</a> to verify your email address and activate your account. This link is valid for ${emailVerificationLinkExpirationDuration}.`
    });
}

export async function sendPhoneNumberVerificationRequest(user:User): Promise<void> {
    await pinpointSMSVoiceV2Client.send(new SendTextMessageCommand({
        DestinationPhoneNumber: user.phoneNumber,
        OriginationIdentity: "Slim-Travel",
        MessageBody: `Your SlimTravel OTP is ${user.otp.toString().padStart(6, "0")} (valid for ${phoneNumberVerificationOTPExpirationDuration})`
    })).catch(err => console.error(err));;
}

export function createAuthToken(user: User): string {
    return sign({ userId: user.id }, authSecret);
}

function createEmailVerificationToken(user: User): string {
    return sign({ userId: user.id }, emailVerificationSecret, { expiresIn: emailVerificationLinkExpirationDuration });
}

export async function authenticateUser(
    request: Request
): Promise<number | null> {
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
    return tokenPayload.userId;
}

export function verifyEmailAddress(token:string): number {
    const tokenPayload = verify(token, emailVerificationSecret) as JwtPayload;
    return tokenPayload.userId;
}

export function verifyPhoneNumber(user:User, otp:string): void {
    if (user.otpCreatedAt.getTime() < new Date().getTime() - ms(phoneNumberVerificationOTPExpirationDuration)) {
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

export class CustomAuthChecker implements AuthCheckerInterface<GraphQLContext> {
    check({ root, args, context, info }: ResolverData<GraphQLContext>, roles: Role[]) {
        if (!context.currentUser) {
            return false;
        }
        const { ownDataOnly } = info.parentType.getFields()[info.fieldName].extensions || {}
        if (!roles.length) {
            return ownDataOnly ?  this.accessingOwnData(root, args, context, info) : true;
        }
        if (roles.indexOf(context.currentUser.role) === -1) {
            return false;
        }
        if (!ownDataOnly) {
            return true;
        }
        return context.currentUser.role === Role.ADMIN || this.accessingOwnData(root, args, context, info);
    }
    
    private accessingOwnData(root: any, args: ArgsDictionary, context: GraphQLContext, info: GraphQLResolveInfo): boolean {
        const userIdFilter = args?.where?.userId?.equals;
        const currentUserId = context.currentUser?.id;
        return userIdFilter && userIdFilter === currentUserId;
    }
}