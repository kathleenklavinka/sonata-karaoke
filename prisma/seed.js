import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("admin123", 10);

  await prisma.user.upsert({
    where: { email: "sonata@gmail.com" },
    update: {},
    create: {
      name: "Admin",
      email: "sonata@gmail.com",
      password: passwordHash,
      role: "ADMIN",
    },
  });

  const roomCount = await prisma.room.count();

  if (roomCount === 0) {
    await prisma.room.createMany({
      data: [
        { name: "Room Small", description: "Cozy room for small groups", capacity: 4, pricePerHour: 50000 },
        { name: "Room Medium", description: "Great for a group of friends", capacity: 8, pricePerHour: 90000 },
        { name: "Room VIP", description: "Spacious room with premium sound", capacity: 15, pricePerHour: 150000 },
      ],
    });
  }

  console.log("Seeding completed");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());