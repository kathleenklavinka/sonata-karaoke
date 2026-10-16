-- DropIndex
DROP INDEX "Room_description_key";

-- AlterTable
ALTER TABLE "Room" ALTER COLUMN "description" DROP NOT NULL;
