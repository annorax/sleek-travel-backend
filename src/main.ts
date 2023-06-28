import "reflect-metadata";
import { ProductCrudResolver, applyResolversEnhanceMap } from "@generated/type-graphql";
import _ from "lodash";
import express from "express";
import { createYoga } from 'graphql-yoga';
import { createContext, GraphQLContext } from './context';
import passport from 'passport';
import { Resolver, Args, buildSchema, Ctx, Mutation, Authorized } from "type-graphql";
import { comparePassword, hashPassword, createTokenForUser, CustomAuthChecker } from "./auth";
import { LogInUserArgs, LogInPayload, RegisterUserArgs, SafeUser } from "./types";
import { Role } from "@prisma/client";

@Resolver(of => SafeUser)
class CustomUserResolver {
    @Mutation(returns => LogInPayload)
    async registerUser(
        @Ctx() { prisma }: GraphQLContext,
        @Args() { name, email, password }: RegisterUserArgs,
    ) : Promise<LogInPayload> {
        const user = await prisma.user.create({
            data: {
                name,
                email,
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
            where: { email }
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

async function main(): Promise<void> {
    const app = express();
    app.use(passport.initialize());
    applyResolversEnhanceMap({
        Product: {
          _query: [Authorized()],
          _mutation: [Authorized(Role.ADMIN)]
        },
      });
    const schema = await buildSchema({
        resolvers: [
            CustomUserResolver,
            ProductCrudResolver
        ],
        authChecker: CustomAuthChecker,
        validate: false,
    });
    const yoga = createYoga({ schema, context: createContext });
    app.use(yoga.graphqlEndpoint, yoga);
    app.listen(4000, () => {
        console.log('Running a GraphQL API server at http://localhost:4000/graphql')
    });
}

main();