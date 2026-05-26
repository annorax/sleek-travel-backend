import { createApp } from './app';

async function main(): Promise<void> {
    const app = createApp();
    app.listen(4000, () => {
        console.log('Running GraphQL API server at http://localhost:4000/graphql');
    });
}

main();
