import "reflect-metadata";
import { User, UserCrudResolver } from "@generated/type-graphql";
import _ from "lodash";
import express from 'express';
import { createYoga } from 'graphql-yoga';
import { createContext, GraphQLContext } from './context';
import passport from 'passport';
import { Resolver, Args, buildSchema, Field, Ctx, Mutation, ArgsType, Query, ObjectType } from "type-graphql";
import { comparePassword, hashPassword } from "./password";

const Omit = <T, K extends keyof T>(Class: new () => T, keys: K[]): new () => Omit<T, typeof keys[number]> => Class;

@ArgsType()
class RegisterUserArgs {
    @Field()
    name!: string;

    @Field()
    email!: string;

    @Field()
    password!: string;
}

@ArgsType()
class LogInUserArgs {
    @Field()
    email!: string;

    @Field()
    password!: string;
}

@ObjectType()
class SafeUser extends Omit(User, ['password']) { }

@Resolver(of => User)
class CustomUserResolver {
    @Mutation(returns => User)
    async registerUser(
        @Ctx() { prisma }: GraphQLContext,
        @Args() { name, email, password }: RegisterUserArgs,
    ): Promise<User> {
        return await prisma.user.create({
            data: {
                name,
                email,
                password: await hashPassword(password),
                kind: "NORMAL"
            },
        });
    }

    @Mutation(returns => SafeUser, { nullable: true })
    async logInUser(
        @Ctx() { prisma }: GraphQLContext,
        @Args() { email, password }: LogInUserArgs,
    ): Promise<SafeUser | null> {
        let result: SafeUser | null = null;
        let user = await prisma.user.findFirst({
            where: { email }
        });
        if (user) {
            const passwordsMatch: boolean = await comparePassword(user.password, password);
            if (passwordsMatch) {
                result = _.omit(user, "password");
            }
        }
        return result;
    }
}

async function main(): Promise<void> {
    const app = express();
    app.use(passport.initialize());
    const schema = await buildSchema({
        resolvers: [
            UserCrudResolver,
            CustomUserResolver
        ],
        validate: false,
    });
    const yoga = createYoga({ schema, context: createContext });
    app.use(yoga.graphqlEndpoint, yoga);
    app.listen(4000, () => {
        console.log('Running a GraphQL API server at http://localhost:4000/graphql')
    });
}

main();