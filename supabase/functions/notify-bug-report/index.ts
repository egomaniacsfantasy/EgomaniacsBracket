import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const NOTIFY_EMAIL = Deno.env.get("BUG_REPORT_EMAIL") || "bugs@oddsgods.net";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";

serve(async (request) => {
  try {
    const payload = await request.json();
    const record = payload?.record ?? payload;

    if (!record) {
      return new Response("No record", { status: 400 });
    }

    const subject = `Bug Report - ${String(record.description || "No description").slice(0, 60)}`;
    const body = `
Bug Report - Bracket Lab
========================
Time: ${record.created_at}
User: ${record.display_name || "Anonymous"} ${record.user_id ? `(${record.user_id})` : ""}
Description: ${record.description}

Environment
-----------
URL: ${record.url || "N/A"}
Route: ${record.route || "/"}
User Agent: ${record.user_agent || "N/A"}
Screen: ${record.screen_width}x${record.screen_height}
Viewport: ${record.viewport_width}x${record.viewport_height}
Mobile: ${record.is_mobile ? "Yes" : "No"}

Bracket State
-------------
Active Region: ${record.active_region || "N/A"}
Active Round: ${record.active_round || "N/A"}
Active Tab: ${record.active_tab || "N/A"}
Pick Count: ${record.pick_count ?? "N/A"}
Chaos Score: ${record.chaos_score ?? "N/A"}
Display Mode: ${record.display_mode || "N/A"}
Futures Open: ${record.futures_open ? "Yes" : "No"}
Sim Running: ${record.sim_running ? "Yes" : "No"}
Bracket Hash: ${record.bracket_hash || "N/A"}
    `.trim();

    if (RESEND_API_KEY) {
      const resendResponse = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: "Bracket Lab <bugs@oddsgods.net>",
          to: [NOTIFY_EMAIL],
          subject,
          text: body,
        }),
      });

      if (!resendResponse.ok) {
        const responseText = await resendResponse.text();
        throw new Error(`Resend request failed: ${resendResponse.status} ${responseText}`);
      }
    }

    return new Response(JSON.stringify({ status: "ok" }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
