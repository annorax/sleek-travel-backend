import "reflect-metadata";
import { ProductCrudResolver, ItemCrudResolver, PurchaseOrderCrudResolver, PurchaseOrderRelationsResolver, applyResolversEnhanceMap, Role } from "@generated/type-graphql";
import _ from "lodash";
import express from "express";
import { createYoga } from 'graphql-yoga';
import { createContext } from './context';
import passport from 'passport';
import { buildSchema, Authorized, Extensions } from "type-graphql";
import { CustomAuthChecker } from "./auth";
import { CustomItemResolver, CustomProductResolver, CustomPurchaseOrderResolver, CustomUserResolver } from "./resolvers";

async function main(): Promise<void> {
    const app = express();
    app.use(passport.initialize());
    applyResolversEnhanceMap({
        Product: {
            _query: [Authorized()],
            _mutation: [Authorized(Role.ADMIN)]
        },
        Item: {
            _query: [Authorized(), Extensions({ ownDataOnly: true })],
            _mutation: [Authorized(Role.ADMIN)]
        },
        PurchaseOrder: {
            _query: [Authorized(), Extensions({ ownDataOnly: true })],
            _mutation: [Authorized(Role.ADMIN)]
        },
    });
    const schema = await buildSchema({
        resolvers: [
            CustomUserResolver,
            CustomItemResolver,
            CustomProductResolver,
            CustomPurchaseOrderResolver,
            ItemCrudResolver,
            ProductCrudResolver,
            PurchaseOrderCrudResolver,
            PurchaseOrderRelationsResolver
        ],
        authChecker: CustomAuthChecker,
        validate: true
    });
    const yoga = createYoga({
        schema,
        context: createContext
    });
    app.use(yoga.graphqlEndpoint, yoga);
    app.listen(4000, () => {
        console.log('Running GraphQL API server at http://localhost:4000/graphql')
    });
}

main();
