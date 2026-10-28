-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN "actorEmail" TEXT;
ALTER TABLE "Campaign" ADD COLUMN "actorName" TEXT;

-- AlterTable
ALTER TABLE "CampaignLog" ADD COLUMN "actorEmail" TEXT;
ALTER TABLE "CampaignLog" ADD COLUMN "actorName" TEXT;
