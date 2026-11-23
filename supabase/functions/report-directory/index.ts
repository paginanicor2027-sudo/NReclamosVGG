import { createReportDirectoryHandler } from "./handler.ts";
import { createReportDirectoryStore } from "./store.ts";

const allowedOrigins = [
  "https://paginanicor2027-sudo.github.io",
  ...(Deno.env.get("REPORT_ALLOWED_ORIGINS") ?? "").split(",").map((origin) =>
    origin.trim()
  ).filter(Boolean),
];

const store = createReportDirectoryStore({
  supabaseUrl: Deno.env.get("SUPABASE_URL"),
  secretKeys: Deno.env.get("SUPABASE_SECRET_KEYS"),
  serviceRoleKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
});

Deno.serve(createReportDirectoryHandler({ allowedOrigins, store }));
