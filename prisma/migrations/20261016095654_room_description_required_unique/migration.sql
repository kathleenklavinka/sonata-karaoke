/*
  Warnings:

  - A unique constraint covering the columns `[description]` on the table `Room` will be added. If there are existing duplicate values, this will fail.
  - Made the column `description` on table `Room` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Room" ALTER COLUMN "description" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Room_description_key" ON "Room"("description");
