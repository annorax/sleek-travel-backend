import "reflect-metadata";
import { resolvers } from "@generated/type-graphql";
import express from 'express';
import { createYoga } from 'graphql-yoga';
import { createContext } from './context';
import passport from 'passport';
import { buildSchema } from "type-graphql";
 
async function main(): Promise<void> {
  const app = express();
  app.use(passport.initialize());
  const schema = await buildSchema({
    resolvers,
    validate: false,
  });
  const yoga = createYoga({ schema, context: createContext });
  app.use(yoga.graphqlEndpoint, yoga);
  app.listen(4000, () => {
    console.log('Running a GraphQL API server at http://localhost:4000/graphql')
  });
}
 
main();