import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { hashPassword } from '../src/auth';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const now = new Date();

async function main() {
  const idoEmail = 'ido.dovrat@gmail.com';
  await prisma.user.upsert({
    where: { email: idoEmail },
    update: {},
    create: {
      email: idoEmail,
      emailVerified: now,
      name: 'Ido Dovrat',
      phoneNumber: '+972544264831',
      phoneNumberVerified: now,
      otp: 54783,
      otpCreatedAt: now,
      password: await hashPassword('123456'),
      role: 'ADMIN',
    },
  });
  for (const data of [
    { name: 'Product A', currency: 'EUR' as const, price: 10, updatedAt: now },
    { name: 'Product B', currency: 'EUR' as const, price: 20, updatedAt: new Date(now.getTime() - 1000) },
  ]) {
    if (!await prisma.product.findFirst({ where: { name: data.name } })) {
      await prisma.product.create({ data });
    }
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
