import express from 'express';
import { createYoga } from 'graphql-yoga';
import { createContext } from './context';
import { builder } from './builder';
import './schema';

async function main(): Promise<void> {
    const app = express();
    const schema = builder.toSchema();
    const yoga = createYoga({ schema, context: createContext });
    app.use(yoga.graphqlEndpoint, yoga);
    app.listen(4000, () => {
        console.log('Running GraphQL API server at http://localhost:4000/graphql');
    });
}

main();
