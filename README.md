# sleek-travel-backend

## First-time setup

```
npm install
npx prisma generate
```

## Database

Create the database and apply migrations (or create from scratch):
```
npx prisma migrate dev --name init
```

Seed the database:
```
npx prisma db seed
```

> Note: unlike Prisma 6 and earlier, `prisma migrate dev` no longer seeds automatically.

## Schema changes

After changing `schema.prisma`:
```
npx prisma migrate dev --name <migration name>
npx prisma generate
```
Review the generated migration and manually tweak as needed.

After any schema change, refresh the frontend's GraphQL schema file:
```
npx tsx scripts/print-schema.ts > ../sleek-travel-frontend/lib/graphql/schema.graphql
```
Then re-run Ferry codegen in the frontend (`flutter pub run build_runner build --delete-conflicting-outputs`).

## Tests

Run the full suite once:
```
npm test
```

Rerun on file changes:
```
npm run test:watch
```

The suite uses Node's built-in `node:test` runner and an in-process PGlite instance, so it does not require Docker or a running Postgres. See [`tests/README.md`](tests/README.md) for the harness architecture and conventions for adding tests.
