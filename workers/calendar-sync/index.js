// workers/calendar-sync/index.js
// Cloudflare Scheduled Cron Worker for Manila Prime Staycation
// Automatically fetches Airbnb & Booking.com iCal calendars every 30 minutes

export default {
  /**
   * Automated Cron Trigger handler
   */
  async scheduled(controller, env, ctx) {
    const timestamp = new Date().toISOString();
    console.log(`[Manila Prime Cron] Running background calendar sync at ${timestamp}...`);

    ctx.waitUntil(
      (async () => {
        try {
          const response = await fetch("https://asia-southeast1-unified-booker.cloudfunctions.net/api/calendar-sync", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(env.CRON_SECRET ? { "Authorization": `Bearer ${env.CRON_SECRET}` } : {})
            }
          });

          const result = await response.text();
          console.log(`[Manila Prime Cron] Calendar sync executed. Response status: ${response.status}`, result);
        } catch (err) {
          console.error("[Manila Prime Cron] Background sync execution failed:", err);
        }
      })()
    );
  },

  /**
   * HTTP trigger handler (allows manual instant sync via browser or curl)
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/sync" || url.pathname === "/api/sync") {
      try {
        const response = await fetch("https://asia-southeast1-unified-booker.cloudfunctions.net/api/calendar-sync", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(env.CRON_SECRET ? { "Authorization": `Bearer ${env.CRON_SECRET}` } : {})
          }
        });

        const data = await response.text();
        return new Response(data, {
          status: response.status,
          headers: { "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    return new Response(
      JSON.stringify({
        service: "Manila Prime Calendar Sync Cron Worker",
        status: "active",
        schedule: "Every 30 minutes (*/30 * * * *)",
        manualSyncUrl: `${url.origin}/sync`
      }),
      {
        headers: { "Content-Type": "application/json" }
      }
    );
  }
};
