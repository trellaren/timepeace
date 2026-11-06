/*
  Warnings:

  - Added the required column `orgId` to the `MileageLog` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "VendorTaxClass" AS ENUM ('INDIVIDUAL', 'PARTNERSHIP', 'C_CORP', 'S_CORP', 'LLC_C', 'LLC_S', 'LLC_P', 'TRUST_ESTATE', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CHECK', 'ACH', 'CASH', 'CARD');

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "paymentMethod" "PaymentMethod";

-- AlterTable
ALTER TABLE "MileageLog" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "fromPlace" TEXT,
ADD COLUMN     "orgId" TEXT NOT NULL,
ADD COLUMN     "toPlace" TEXT;

-- AlterTable
ALTER TABLE "TaxYearSettings" ADD COLUMN     "priorYearAgiOver150k" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "priorYearTaxCents" INTEGER;

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "isAttorney" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "taxClassification" "VendorTaxClass",
ADD COLUMN     "w9ReceivedOn" DATE;

-- CreateTable
CREATE TABLE "EstimatedTaxPayment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "quarter" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "paidOn" DATE NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EstimatedTaxPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EstimatedTaxPayment_orgId_year_idx" ON "EstimatedTaxPayment"("orgId", "year");

-- CreateIndex
CREATE INDEX "MileageLog_orgId_date_idx" ON "MileageLog"("orgId", "date");

-- AddForeignKey
ALTER TABLE "MileageLog" ADD CONSTRAINT "MileageLog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimatedTaxPayment" ADD CONSTRAINT "EstimatedTaxPayment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
