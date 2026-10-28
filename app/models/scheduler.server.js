// Starts and ends campaigns on their schedule.
//
// A campaign saved with a future start time sits in SCHEDULED until then, and
// one with an end time stays live until it passes. Nobody is signed in when
// either moment arrives, so this runs inside the server process on a timer and
// talks to Shopify with each shop's offline session.
//
// It checks once a minute, so a campaign set for 18:00 changes within a minute
// of it. It relies on the server staying up: while it is down nothing starts
// or ends, and anything that fell due is picked up on the first tick after it
// comes back.

import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import {
  CAMPAIGN_KIND,
  CAMPAIGN_STATUS,
  LOG_LEVEL,
} from "./campaign.constants";
import {
  rollbackCampaign,
  startScheduledCampaign,
} from "./campaign.apply.server";

const TICK_MS = 60 * 1000;
// First run shortly after boot, so anything that fell due while the server
// was down is handled without waiting a full minute.
const FIRST_TICK_MS = 5 * 1000;

// Kept on `global` (as db.server.js does) because the dev server re-imports
// modules on every edit. Each import replaces the previous timer, so only the
// newest code runs and there is never more than one scheduler.
const state = (global.__campaignScheduler ??= {
  interval: null,
  timeout: null,
  running: false,
});

export function startScheduler() {
  clearInterval(state.interval);
  clearTimeout(state.timeout);

  state.timeout = setTimeout(tick, FIRST_TICK_MS);
  state.interval = setInterval(tick, TICK_MS);
}

async function tick() {
  // A slow tick (hundreds of variants) must not overlap the next one.
  if (state.running) return;
  state.running = true;

  try {
    await startDueCampaigns();
    await endDueCampaigns();
  } catch (error) {
    console.error("[scheduler] tick failed", error);
  } finally {
    state.running = false;
  }
}

async function startDueCampaigns() {
  const due = await prisma.campaign.findMany({
    where: {
      kind: CAMPAIGN_KIND.CAMPAIGN,
      status: CAMPAIGN_STATUS.SCHEDULED,
      startAt: { lte: new Date() },
    },
    orderBy: { startAt: "asc" },
  });

  for (const campaign of due) {
    await runForShop(campaign, (admin) =>
      startScheduledCampaign(admin, campaign),
    );
  }
}

async function endDueCampaigns() {
  const due = await prisma.campaign.findMany({
    where: {
      kind: CAMPAIGN_KIND.CAMPAIGN,
      // Only a cleanly running campaign ends by itself. One that FAILED
      // partway needs a person to look at it; retrying it every minute would
      // just repeat the same failure into the log.
      status: CAMPAIGN_STATUS.ACTIVE,
      endAt: { lte: new Date() },
    },
    orderBy: { endAt: "asc" },
  });

  for (const campaign of due) {
    await runForShop(campaign, (admin) =>
      rollbackCampaign(admin, campaign.shop, campaign.id, null, {
        reason: "end",
      }),
    );
  }
}

// One campaign's failure -- an uninstalled shop, a Shopify outage -- is
// logged against that campaign and must not stop the others in the same tick.
async function runForShop(campaign, work) {
  try {
    const { admin } = await unauthenticated.admin(campaign.shop);
    await work(admin);
  } catch (error) {
    console.error(`[scheduler] campaign ${campaign.id} failed`, error);
    await prisma.campaignLog
      .create({
        data: {
          campaignId: campaign.id,
          level: LOG_LEVEL.ERROR,
          message: `The scheduler could not reach Shopify for this campaign and will try again in a minute: ${error.message}`,
        },
      })
      .catch(() => {});
  }
}
