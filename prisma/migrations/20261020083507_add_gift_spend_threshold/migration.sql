-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BundleDiscount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "shopifyDiscountId" TEXT,
    "title" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'AUTOMATIC',
    "code" TEXT,
    "landingPath" TEXT,
    "usageLimit" INTEGER,
    "oncePerCustomer" BOOLEAN NOT NULL DEFAULT false,
    "kind" TEXT NOT NULL DEFAULT 'BUNDLE',
    "quantity" INTEGER NOT NULL,
    "bundlePrice" TEXT,
    "giftProduct" TEXT,
    "giftPrice" TEXT,
    "giftRepeats" BOOLEAN NOT NULL DEFAULT false,
    "giftThreshold" TEXT NOT NULL DEFAULT 'ITEMS',
    "minSpend" TEXT,
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
INSERT INTO "new_BundleDiscount" ("actorEmail", "actorName", "bundlePrice", "code", "createdAt", "endedAt", "endsAt", "giftPrice", "giftProduct", "giftRepeats", "id", "kind", "landingPath", "method", "oncePerCustomer", "quantity", "selection", "selectionMode", "shop", "shopifyDiscountId", "startsAt", "title", "updatedAt", "usageLimit") SELECT "actorEmail", "actorName", "bundlePrice", "code", "createdAt", "endedAt", "endsAt", "giftPrice", "giftProduct", "giftRepeats", "id", "kind", "landingPath", "method", "oncePerCustomer", "quantity", "selection", "selectionMode", "shop", "shopifyDiscountId", "startsAt", "title", "updatedAt", "usageLimit" FROM "BundleDiscount";
DROP TABLE "BundleDiscount";
ALTER TABLE "new_BundleDiscount" RENAME TO "BundleDiscount";
CREATE INDEX "BundleDiscount_shop_createdAt_idx" ON "BundleDiscount"("shop", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
