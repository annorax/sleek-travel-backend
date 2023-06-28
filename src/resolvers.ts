import "reflect-metadata";
import _ from "lodash";
import { GraphQLContext } from './context';
import { Resolver, Args, Ctx, Mutation } from "type-graphql";
import { comparePassword, hashPassword, createAuthToken, verifyEmailAddress } from "./auth";
import { LogInUserArgs, LogInPayload, RegisterUserArgs, SafeUser, VerifyEmailAddressArgs } from "./types";
import { Role } from "@prisma/client";
import { sendEmailVerificationRequest } from "./mail";
import { GraphQLVoid } from "graphql-scalars";

@Resolver(of => SafeUser)
export class CustomUserResolver {
    @Mutation(returns => LogInPayload)
    async registerUser(
        @Ctx() { prisma }: GraphQLContext,
        @Args() { name, email, password }: RegisterUserArgs,
    ) : Promise<LogInPayload> {
        const user = await prisma.user.create({
            data: {
                name,
                email: email.toLowerCase(),
                password: await hashPassword(password),
                role: Role.NORMAL
            }
        });
        const safeUser = _.omit(user, "password");
        const token = createAuthToken(user);
        sendEmailVerificationRequest(user).catch(err => console.error(err));
        return { token, user: safeUser }
    }

    @Mutation(returns => GraphQLVoid)
    async verifyEmailAddress(
        @Ctx() { initialContext, prisma }: GraphQLContext,
        @Args() { token }: VerifyEmailAddressArgs,
    ) : Promise<void> {
        const userId = verifyEmailAddress(token);
        await prisma.user.update({
            where: { id: userId },
            data: { emailVerified: new Date() }
        });
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
        const safeUser = _.omit(user, "password");
        const token = createAuthToken(user);
        return { token, user: safeUser }
    }
}