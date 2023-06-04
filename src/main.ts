import express from 'express';
import { createYoga } from 'graphql-yoga';
import { schema } from './schema';
import { createContext } from './context';
import passport from 'passport';
 
function main() {
  const app = express();
  app.use(passport.initialize());
  const yoga = createYoga({ schema, context: createContext });
  app.use(yoga.graphqlEndpoint, yoga);
  app.listen(4000, () => {
    console.log('Running a GraphQL API server at http://localhost:4000/graphql')
  });
}
 
main();