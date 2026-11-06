-- DropForeignKey
ALTER TABLE "Expense" DROP CONSTRAINT "Expense_projectId_fkey";

-- AlterTable
ALTER TABLE "Expense" ALTER COLUMN "projectId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
