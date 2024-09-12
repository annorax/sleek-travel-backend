import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../src/auth'
const prisma = new PrismaClient()
const now = new Date();
async function main() {
  const ido = await prisma.user.upsert({
    where: { email: 'alice@prisma.io' },
    update: {},
    create: {
      email: 'ido.dovrat@gmail.com',
      emailVerified: now,
      name: 'Ido Dovrat',
      phoneNumber: '+972544264831',
      phoneNumberVerified: now,
      otp: 54783,
      otpCreatedAt: now,
      password: await hashPassword('123456'),
      role: 'ADMIN'
    },
  })
  console.log({ ido })
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