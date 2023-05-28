import { makeExecutableSchema } from '@graphql-tools/schema';

const typeDefinitions = /* GraphQL */ `
  type Query {
    info: String!
    feed: [Link!]!
  }
 
  type Mutation {
    postLink(url: String!, description: String!): Link!
  }
 
  type Link {
    id: ID!
    description: String!
    url: String!
  }
`;

type Link = {
    id: string
    url: string
    description: string
};

const links: Link[] = [
    {
        id: 'link-0',
        url: 'https://graphql-yoga.com',
        description: 'The easiest way of setting up a GraphQL server'
    }
];

const resolvers = {
    Query: {
        info: () => `This is the API of a Hackernews Clone`,
        feed: () => links
    },
    Mutation: {
        postLink: (parent: unknown, args: { description: string; url: string }) => {
            let idCount = links.length;

            const link: Link = {
                id: `link-${idCount}`,
                description: args.description,
                url: args.url
            };

            links.push(link);

            return link;
        }
    }
};

export const schema = makeExecutableSchema({
    resolvers: [resolvers],
    typeDefs: [typeDefinitions]
});