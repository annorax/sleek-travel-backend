import express from 'express';
import { createYoga } from 'graphql-yoga';
import { createContext } from './context';
import { builder } from './builder';
import './schema';

export function createApp(): express.Express {
    const app = express();
    const schema = builder.toSchema();
    const yoga = createYoga({ schema, context: createContext });
    app.use(yoga.graphqlEndpoint, yoga);
    return app;
}
