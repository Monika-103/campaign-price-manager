-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "startAt" DATETIME NOT NULL,
    "endAt" DATETIME NOT NULL,
    "priceAction" TEXT NOT NULL,
    "applyTo" TEXT NOT NULL DEFAULT 'PRICE',
    "value" REAL,
    "rounding" TEXT NOT NULL DEFAULT 'NONE',
    "productCount" INTEGER NOT NULL DEFAULT 0,
    "variantCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "appliedAt" DATETIME,
    "rolledBackAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CampaignItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "variantTitle" TEXT,
    "sku" TEXT,
    "originalPrice" TEXT NOT NULL,
    "originalCompareAt" TEXT,
    "newPrice" TEXT,
    "newCompareAt" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CampaignItem_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CampaignLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'INFO',
    "message" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CampaignLog_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Campaign_shop_status_idx" ON "Campaign"("shop", "status");

-- CreateIndex
CREATE INDEX "Campaign_shop_createdAt_idx" ON "Campaign"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "CampaignItem_campaignId_status_idx" ON "CampaignItem"("campaignId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignItem_campaignId_variantId_key" ON "CampaignItem"("campaignId", "variantId");

-- CreateIndex
CREATE INDEX "CampaignLog_campaignId_createdAt_idx" ON "CampaignLog"("campaignId", "createdAt");
