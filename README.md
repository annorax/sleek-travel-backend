* Create DB
npx prisma db push

* Seed DB
npx prisma db seed

Run this after changing `schema.prisma`:
```
npx prisma migrate dev --name <migration name>
npx prisma generate
```
Then, review the generated migration and manually tweak as needed.

After any schema change, refresh the frontend's GraphQL schema file:
```
npx ts-node scripts/print-schema.ts > ../sleek-travel-frontend/lib/graphql/schema.graphql
```
Then re-run Ferry codegen in the frontend (`flutter pub run build_runner build --delete-conflicting-outputs`).