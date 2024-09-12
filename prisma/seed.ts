import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../src/auth'
const prisma = new PrismaClient()
const now = new Date();
async function main() {
  const idoEmail = 'ido.dovrat@gmail.com';
  await prisma.user.create({
    data: {
      email: idoEmail,
      emailVerified: now,
      name: 'Ido Dovrat',
      phoneNumber: '+972544264831',
      phoneNumberVerified: now,
      otp: 54783,
      otpCreatedAt: now,
      password: await hashPassword('123456'),
      role: 'ADMIN'
    },
  });
  await prisma.product.create({
    data: {
      name: 'Robonen',
      currency: 'GBP',
      price: 10
    },
  })
}
main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })