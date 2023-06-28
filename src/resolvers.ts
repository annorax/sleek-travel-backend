import "reflect-metadata";
import _ from "lodash";
import { GraphQLContext } from './context';
import { Resolver, Args, Ctx, Mutation } from "type-graphql";
import { comparePassword, hashPassword, createTokenForUser } from "./auth";
import { LogInUserArgs, LogInPayload, RegisterUserArgs, SafeUser } from "./types";
import { Role } from "@prisma/client";

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
        const token = createTokenForUser(user);
        return { token, user: safeUser }
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
        const token = createTokenForUser(user);
        return { token, user: safeUser }
    }
}