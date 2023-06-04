Run this after changing `schema.prisma`:
```
npx prisma migrate dev --name <migration name>
npx prisma generate
```
Then, review the generated migration and manually tweak as needed.