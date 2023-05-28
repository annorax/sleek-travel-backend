Run this after changing `schema.prisma`:
```
npx prisma migrate dev --name <migration name>
```
Then, review the generated migration and manually tweak as needed.