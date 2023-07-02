import "reflect-metadata";
import _ from "lodash";
import { GraphQLContext } from "./context";
import { Resolver, Args, Ctx, Mutation } from "type-graphql";
import { comparePassword, hashPassword, createAuthToken, sendEmailVerificationRequest, sendPhoneNumberVerificationRequest, verifyEmailAddress, verifyPhoneNumber } from "./auth";
import { LogInUserArgs, LogInPayload, RegisterUserArgs, SafeUser, VerifyEmailAddressArgs, VerifyPhoneNumberArgs, ResendPhoneNumberVerificationRequestArgs, ResendEmailVerificationRequestArgs } from "./types";
import { Role, User } from "@prisma/client";
import { GraphQLVoid } from "graphql-scalars";
import crypto from "crypto";

const generateOTP = () => crypto.randomInt(0, 1000000);

const sanitizeUser = (user:User): SafeUser => _.omit(user, "password", "otp", "otpCreatedAt", "phoneNumberVerified", "emailVerified");

@Resolver(of => SafeUser)
export class CustomUserResolver {
    @Mutation(returns => LogInPayload)
    async registerUser(
        @Ctx() { prisma }: GraphQLContext,
        @Args() { name, phoneNumber, email, password }: RegisterUserArgs,
    ) : Promise<LogInPayload> {
        const otp = generateOTP();
        const user = await prisma.user.create({
            data: {
                name,
                phoneNumber,
                otp,
                otpCreatedAt: new Date(),
                email: email.toLowerCase(),
                password: await hashPassword(password),
                role: Role.NORMAL,
            }
        });
        sendEmailVerificationRequest(user).catch(err => console.error(err));
        sendPhoneNumberVerificationRequest(user).catch(err => console.error(err));
        return { token: createAuthToken(user), user: sanitizeUser(user) }
    }

    @Mutation(returns => GraphQLVoid, { nullable: true })
    async resendEmailVerificationRequest(@Ctx() { initialContext, prisma }: GraphQLContext,
        @Args() { email }: ResendEmailVerificationRequestArgs,
    ) : Promise<void> {
        const user = await prisma.user.findUnique({
            where: { email: email.toLowerCase() }
        });
        if (!user) {
            throw "User not found";
        }
        await sendEmailVerificationRequest(user);
    }

    @Mutation(returns => GraphQLVoid, { nullable: true })
    async resendPhoneNumberVerificationRequest(@Ctx() { initialContext, prisma }: GraphQLContext,
        @Args() { phoneNumber }: ResendPhoneNumberVerificationRequestArgs,
    ) : Promise<void> {
        const otp = generateOTP();
        let user;
        try {
            user = await prisma.user.update({
                where: { phoneNumber },
                data: {
                    otp,
                    otpCreatedAt: new Date()
                }
            });
        } catch (e) {
            throw "User not found";
        }
        await sendPhoneNumberVerificationRequest(user);
    }

    @Mutation(returns => GraphQLVoid, { nullable: true })
    async verifyPhoneNumber(
        @Ctx() { initialContext, prisma }: GraphQLContext,
        @Args() { userId, otp }: VerifyPhoneNumberArgs,
    ) : Promise<void> {
        const user = await prisma.user.findUnique({
            where: { id: userId }
        });
        if (!user) {
            throw "User not found";
        }
        verifyPhoneNumber(user, otp);
        const result = await prisma.user.updateMany({
            where: {
                id: userId,
                phoneNumberVerified: null
            },
            data: { phoneNumberVerified: new Date() }
        });
        if (!result.count) {
            throw "Already verified";
        }
    }

    @Mutation(returns => GraphQLVoid, { nullable: true })
    async verifyEmailAddress(
        @Ctx() { initialContext, prisma }: GraphQLContext,
        @Args() { token }: VerifyEmailAddressArgs,
    ) : Promise<void> {
        const userId = verifyEmailAddress(token);
        const result = await prisma.user.updateMany({
            where: {
                id: userId,
                emailVerified: null
            },
            data: { emailVerified: new Date() }
        });
        if (!result.count) {
            throw "Already verified";
        }
    }

    @Mutation(returns => LogInPayload, { nullable: true })
    async logInUser(
        @Ctx() { initialContext, prisma }: GraphQLContext,
        @Args() { email, password }: LogInUserArgs,
    ) : Promise<LogInPayload | null> {
        let user = await prisma.user.findFirst({
            where: { email: email.toLowerCase() }
        });
        if (!user) {
            return null;
        }
        const passwordsMatch: boolean = await comparePassword(user.password, password);
        if (!passwordsMatch) {
            return null;
        }
        const ipAddress:string = initialContext.req.headers['x-forwarded-for'] || initialContext.req.socket.remoteAddress;
        await prisma.login.create({
            data: {
                ...(ipAddress ? { ipAddress } : {}),
                userId: user.id
            }
        });
        return { token: createAuthToken(user), user: sanitizeUser(user) }
    }
}