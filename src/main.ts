import "reflect-metadata";
import { User, UserCrudResolver, CreateOneUserArgs } from "@generated/type-graphql";
import express from 'express';
import { createYoga } from 'graphql-yoga';
import { createContext, GraphQLContext } from './context';
import passport from 'passport';
import { Resolver, Args, buildSchema, Field, Int, Ctx, Root, Mutation, ArgsType } from "type-graphql";
import { hashPassword } from "./password";
 
@ArgsType()
class RegisterUserArgs {
  @Field()
  name!: string;

  @Field()
  email!: string;

  @Field()
  password!: string;
}

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