import { makeExecutableSchema } from '@graphql-tools/schema';
import type { GraphQLContext } from './context';
import type { Link, User } from '@prisma/client';
import { GraphQLError } from 'graphql';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { hash, compare } from 'bcryptjs';
import { sign } from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const appAuthSecret = <string>process.env.APP_AUTH_SECRET;

const parseIntSafe = (value: string): number | null => {
    if (/^(\d+)$/.test(value)) {
        return parseInt(value, 10);
    }
    return null;
}

const applyTakeConstraints = (params: {
    min: number
    max: number
    value: number
}) => {
    if (params.value < params.min || params.value > params.max) {
        throw new GraphQLError(
            `'take' argument value '${params.value}' is outside the valid range of '${params.min}' to '${params.max}'.`
        );
    }
    return params.value;
}

const typeDefinitions = /* GraphQL */ `
    type Link {
        id: ID!
        description: String!
        url: String!
        comments: [Comment!]!
        postedBy: User
    }

    type AuthPayload {
        token: String
        user: User
    }
       
    type User {
        id: ID!
        name: String!
        email: String!
        links: [Link!]!
    }
   
    type Comment {
        id: ID!
        body: String!
        link: Link
    }
   
    type Query {
        info: String!
        feed(filterNeedle: String, skip: Int, take: Int): [Link!]!
        comment(id: ID!): Comment
        link(id: ID!): Link
        me: User!
    }
   
    type Mutation {
        postLink(url: String!, description: String!): Link!
        postCommentOnLink(linkId: ID!, body: String!): Comment!
        signup(email: String!, password: String!, name: String!): AuthPayload
        login(email: String!, password: String!): AuthPayload
    }
`;

const resolvers = {
    Query: {
        info: () => `This is the API of a Hackernews Clone`,
        me(parent: unknown, args: {}, context: GraphQLContext) {
            if (context.currentUser === null) {
                throw new Error('Unauthenticated!');
            }
            return context.currentUser;
        },
        async feed(
            parent: unknown,
            args: { filterNeedle?: string; skip?: number; take?: number },
            context: GraphQLContext
        ) {
            const where = args.filterNeedle
                ? {
                    OR: [
                        { description: { contains: args.filterNeedle } },
                        { url: { contains: args.filterNeedle } }
                    ]
                }
                : {};

            const take = applyTakeConstraints({
                min: 1,
                max: 50,
                value: args.take ?? 30
            });

            return context.prisma.link.findMany({
                where,
                skip: args.skip,
                take
            });
        },
        async comment(
            parent: unknown,
            args: { id: string },
            context: GraphQLContext
        ) {
            return context.prisma.comment.findUnique({
                where: { id: parseInt(args.id) }
            });
        },
        async link(
            parent: unknown,
            args: { id: string },
            context: GraphQLContext
        ) {
            return context.prisma.link.findUnique({
                where: { id: parseInt(args.id) }
            });
        }
    },
    Link: {
        comments(parent: Link, args: {}, context: GraphQLContext) {
            return context.prisma.comment.findMany({
                where: {
                    linkId: parent.id
                }
            });
        },
        postedBy(parent: Link, args: {}, context: GraphQLContext) {
            if (!parent.postedById) {
                return null;
            }
            return context.prisma.link
                .findUnique({ where: { id: parent.id } })
                .postedBy();
        }
    },
    User: {
        links: (parent: User, args: {}, context: GraphQLContext) => context.prisma.user.findUnique({ where: { id: parent.id } }).links()
    },
    Mutation: {
        async postLink(
            parent: unknown,
            args: { url: string; description: string },
            context: GraphQLContext
        ) {
            if (context.currentUser === null) {
                throw new Error('Unauthenticated!');
            }
            const newLink = await context.prisma.link.create({
                data: {
                    url: args.url,
                    description: args.description,
                    postedBy: { connect: { id: context.currentUser.id } }
                }
            });
            return newLink;
        },
        async postCommentOnLink(
            parent: unknown,
            args: { linkId: string; body: string },
            context: GraphQLContext
        ) {
            const linkId = parseIntSafe(args.linkId)
            if (linkId === null) {
                return Promise.reject(
                    new GraphQLError(
                        `Cannot post comment on non-existing link with id '${args.linkId}'.`
                    )
                );
            }
            const comment = await context.prisma.comment
                .create({
                    data: {
                        body: args.body,
                        linkId
                    }
                })
                .catch((err: unknown) => {
                    if (err instanceof PrismaClientKnownRequestError) {
                        if (err.code === 'P2003') {
                            return Promise.reject(
                                new GraphQLError(
                                    `Cannot post comment on non-existing link with id '${args.linkId}'.`
                                )
                            );
                        }
                    }
                    return Promise.reject(err);
                });
            return comment
        },
        async signup(
            parent: unknown,
            args: { email: string; password: string; name: string },
            context: GraphQLContext
        ) {
            const password = await hash(args.password, 10);
            const user = await context.prisma.user.create({
                data: { ...args, password }
            });
            const token = sign({ userId: user.id }, appAuthSecret);
            return { token, user };
        },
        async login(
            parent: unknown,
            args: { email: string; password: string },
            context: GraphQLContext
        ) {
            const user = await context.prisma.user.findUnique({
                where: { email: args.email }
            });
            if (!user) {
                throw new Error('No such user found');
            }
            const valid = await compare(args.password, user.password);
            if (!valid) {
                throw new Error('Invalid password');
            }
            const token = sign({ userId: user.id }, appAuthSecret);
            return { token, user }
        }
    }
};

export const schema = makeExecutableSchema({
    resolvers: [resolvers],
    typeDefs: [typeDefinitions]
});