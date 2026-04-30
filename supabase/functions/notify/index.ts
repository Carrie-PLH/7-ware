// Supabase Edge Function: Email notifications for 7 Ware Lane
// Triggered by database webhooks on INSERT to hub_updates, hub_decisions, hub_messages
//
// SETUP:
// 1. Sign up at https://resend.com and get an API key (free tier: 100 emails/day)
// 2. Set secrets:
//    supabase secrets set RESEND_API_KEY=re_xxxxx
//    supabase secrets set SUPABASE_URL=https://xhlwkfhrivucphlwtubl.supabase.co
//    supabase secrets set SUPABASE_SERVICE_KEY=your-service-role-key
// 3. Deploy: supabase functions deploy notify
// 4. Create database webhooks in Supabase Dashboard > Database > Webhooks:
//    - Table: hub_updates, Event: INSERT, URL: <function-url>
//    - Table: hub_decisions, Event: INSERT, URL: <function-url>
//    - Table: hub_messages, Event: INSERT, URL: <function-url>

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_KEY")!;
const SITE_URL = Deno.env.get("SITE_URL") || "https://7warelanebuild.pages.dev";
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "7 Ware Lane <notifications@yourdomain.com>";

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const table = payload.table;
    const record = payload.record;

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Determine who posted and who should be notified
    let posterRole: string | null = null;
    let subject = "";
    let body = "";

    if (table === "hub_updates") {
      posterRole = "builder"; // only builder posts updates
      subject = "New Update: " + (record.title || "Untitled");
      body = record.body || record.title || "A new update was posted.";
    } else if (table === "hub_decisions") {
      posterRole = "builder"; // only builder creates decisions
      subject = "Decision Needed: " + (record.question || "");
      body = record.question || "A new decision question was posted.";
      if (record.deadline) body += `\n\nNeeded by: ${record.deadline}`;
    } else if (table === "hub_messages") {
      posterRole = record.role || null;
      const otherRole = posterRole === "builder" ? "Homeowner" : "Builder";
      subject = `New Message from ${posterRole === "builder" ? "Builder" : "Homeowner"}`;
      body = record.body || "New message on the board.";
    }

    if (!posterRole) {
      return new Response(JSON.stringify({ ok: true, skipped: "unknown table" }), { status: 200 });
    }

    // Get the email of the OTHER party
    const notifyKey = posterRole === "builder" ? "homeowner_email" : "builder_email";
    const { data: config } = await sb
      .from("hub_config")
      .select("value")
      .eq("key", notifyKey)
      .single();

    const email = config?.value?.trim();
    if (!email) {
      return new Response(JSON.stringify({ ok: true, skipped: "no email configured" }), { status: 200 });
    }

    // Send via Resend
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [email],
        subject: `[7 Ware Lane] ${subject}`,
        html: `
          <div style="font-family:-apple-system,sans-serif;max-width:500px;margin:0 auto;padding:20px;">
            <div style="background:#1a6b7a;color:white;padding:12px 20px;border-radius:8px 8px 0 0;">
              <strong>7 Ware Lane</strong>
            </div>
            <div style="border:1px solid #e0e0e0;border-top:none;padding:20px;border-radius:0 0 8px 8px;">
              <h2 style="margin:0 0 10px;color:#2d3436;font-size:1.1rem;">${subject}</h2>
              <p style="color:#4a4a4a;line-height:1.6;white-space:pre-wrap;">${body.substring(0, 500)}</p>
              <a href="${SITE_URL}" style="display:inline-block;margin-top:15px;padding:10px 20px;background:#2d9db3;color:white;text-decoration:none;border-radius:6px;font-weight:600;">
                Open Project Hub
              </a>
            </div>
          </div>
        `,
      }),
    });

    const result = await res.json();
    return new Response(JSON.stringify({ ok: true, resend: result }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
