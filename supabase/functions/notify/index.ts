// Supabase Edge Function: Batched email digest for 7 Ware Lane
// Called every 10 minutes by pg_cron. Reads notification_queue,
// groups by target role, sends one digest email per role, clears queue.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_KEY")!;
const SITE_URL = Deno.env.get("SITE_URL") || "https://7warelanebuild.pages.dev";
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "7 Ware Lane <onboarding@resend.dev>";

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function iconForTable(table: string): string {
  if (table === "hub_updates") return "&#128221;";
  if (table === "hub_decisions") return "&#10067;";
  if (table === "hub_messages") return "&#128172;";
  return "&#8226;";
}

function labelForTable(table: string): string {
  if (table === "hub_updates") return "Update";
  if (table === "hub_decisions") return "Decision";
  if (table === "hub_messages") return "Message";
  return table;
}

Deno.serve(async (req) => {
  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Fetch all queued notifications
    const { data: queue, error: qErr } = await sb
      .from("notification_queue")
      .select("*")
      .order("created_at", { ascending: true });

    if (qErr || !queue || queue.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0, reason: "queue empty" }), { status: 200 });
    }

    // Group by target role
    const grouped: Record<string, typeof queue> = {};
    for (const item of queue) {
      const role = item.target_role;
      if (!grouped[role]) grouped[role] = [];
      grouped[role].push(item);
    }

    const results: Record<string, unknown> = {};

    for (const [targetRole, items] of Object.entries(grouped)) {
      // Look up emails for this role
      const emailKey = targetRole === "builder" ? "builder_email" : "homeowner_email";
      const { data: config } = await sb
        .from("hub_config")
        .select("value")
        .eq("key", emailKey)
        .single();

      const rawEmails = config?.value?.trim();
      if (!rawEmails) {
        results[targetRole] = "no email configured";
        continue;
      }

      const emails = rawEmails.split(",").map((e: string) => e.trim()).filter((e: string) => e.length > 0);
      if (!emails.length) {
        results[targetRole] = "no valid emails";
        continue;
      }

      // Build digest
      const count = items.length;
      const subject = count === 1
        ? `${labelForTable(items[0].source_table)}: ${items[0].summary.substring(0, 60)}`
        : `${count} new items on your project hub`;

      const itemsHtml = items.map((item) => {
        const icon = iconForTable(item.source_table);
        const label = labelForTable(item.source_table);
        const time = new Date(item.created_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
        return `
          <tr>
            <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;font-size:14px;vertical-align:top;width:28px;">
              ${icon}
            </td>
            <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;">
              <div style="font-size:11px;color:#6b7b86;text-transform:uppercase;letter-spacing:0.3px;margin-bottom:2px;">${label} &middot; ${time}</div>
              <div style="font-size:14px;color:#1a2024;line-height:1.4;">${escHtml(item.summary)}</div>
            </td>
          </tr>`;
      }).join("");

      const html = `
        <div style="font-family:-apple-system,'DM Sans',sans-serif;max-width:520px;margin:0 auto;padding:20px;">
          <div style="background:linear-gradient(135deg,#0f3d47,#14616f,#1e8a9e);color:white;padding:16px 22px;border-radius:12px 12px 0 0;">
            <div style="font-size:20px;font-weight:600;letter-spacing:-0.3px;">7 Ware Lane</div>
            <div style="font-size:13px;opacity:0.7;margin-top:2px;">Project Hub &middot; ${count} new ${count === 1 ? "item" : "items"}</div>
          </div>
          <div style="border:1px solid #e4e8eb;border-top:none;padding:0;border-radius:0 0 12px 12px;overflow:hidden;background:white;">
            <table style="width:100%;border-collapse:collapse;">
              ${itemsHtml}
            </table>
            <div style="padding:18px 22px;text-align:center;">
              <a href="${SITE_URL}" style="display:inline-block;padding:11px 28px;background:#14616f;color:white;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">
                Open Project Hub
              </a>
            </div>
          </div>
          <div style="text-align:center;margin-top:14px;font-size:11px;color:#6b7b86;">
            You're receiving this because you're part of the 7 Ware Lane build.
          </div>
        </div>
      `;

      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: emails,
          subject: `[7 Ware Lane] ${subject}`,
          html,
        }),
      });

      results[targetRole] = await res.json();
    }

    // Clear the queue
    const ids = queue.map((q) => q.id);
    await sb.from("notification_queue").delete().in("id", ids);

    return new Response(JSON.stringify({ ok: true, sent: queue.length, results }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
});
