-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Campaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'CAMPAIGN',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "startAt" DATETIME NOT NULL,
    "endAt" DATETIME,
    "priceAction" TEXT NOT NULL,
    "applyTo" TEXT NOT NULL DEFAULT 'PRICE',
    "value" REAL,
    "rounding" TEXT NOT NULL DEFAULT 'NONE',
    "selectionMode" TEXT NOT NULL DEFAULT 'PRODUCTS',
    "selectionNote" TEXT,
    "selectionData" TEXT,
    "takeOver" BOOLEAN NOT NULL DEFAULT false,
    "actorName" TEXT,
    "actorEmail" TEXT,
    "productCount" INTEGER NOT NULL DEFAULT 0,
    "variantCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "appliedAt" DATETIME,
    "rolledBackAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Campaign" ("actorEmail", "actorName", "appliedAt", "applyTo", "createdAt", "description", "endAt", "failedCount", "id", "kind", "name", "priceAction", "productCount", "rolledBackAt", "rounding", "selectionMode", "selectionNote", "shop", "startAt", "status", "updatedAt", "updatedCount", "value", "variantCount") SELECT "actorEmail", "actorName", "appliedAt", "applyTo", "createdAt", "description", "endAt", "failedCount", "id", "kind", "name", "priceAction", "productCount", "rolledBackAt", "rounding", "selectionMode", "selectionNote", "shop", "startAt", "status", "updatedAt", "updatedCount", "value", "variantCount" FROM "Campaign";
DROP TABLE "Campaign";
ALTER TABLE "new_Campaign" RENAME TO "Campaign";
CREATE INDEX "Campaign_shop_status_idx" ON "Campaign"("shop", "status");
CREATE INDEX "Campaign_shop_createdAt_idx" ON "Campaign"("shop", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
