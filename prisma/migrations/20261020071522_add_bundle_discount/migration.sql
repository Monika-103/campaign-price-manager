-- CreateTable
CREATE TABLE "BundleDiscount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "shopifyDiscountId" TEXT,
    "title" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "bundlePrice" TEXT NOT NULL,
    "selectionMode" TEXT NOT NULL,
    "selection" TEXT NOT NULL,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME,
    "endedAt" DATETIME,
    "actorName" TEXT,
    "actorEmail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "BundleDiscount_shop_createdAt_idx" ON "BundleDiscount"("shop", "createdAt");
