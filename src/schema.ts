import { makeExecutableSchema } from '@graphql-tools/schema';
import type { GraphQLContext } from './context';
import type { Link } from '@prisma/client';
import { GraphQLError } from 'graphql';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

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
    }
   
    type Mutation {
        postLink(url: String!, description: String!): Link!
        postCommentOnLink(linkId: ID!, body: String!): Comment!
    }
`;

const resolvers = {
    Query: {
        info: () => `This is the API of a Hackernews Clone`,
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
        }
    },
    Mutation: {
        async postLink(
            parent: unknown,
            args: { description: string; url: string },
            context: GraphQLContext
        ) {
            const newLink = await context.prisma.link.create({
                data: {
                    url: args.url,
                    description: args.description
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
        }
    }
};

export const schema = makeExecutableSchema({
    resolvers: [resolvers],
    typeDefs: [typeDefinitions]
});