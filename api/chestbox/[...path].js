// Vercel serverless proxy to chestbox.
//
// Two reasons this exists rather than calling chestbox directly from the page:
//
//  1. CORS. chestbox sends no Access-Control-Allow-Origin, so a browser on a
//     different origin is blocked outright.
//  2. The admin key. Calling directly means SUPER_USER_KEY sits in client JS,
//     visible to anyone who opens devtools. Here it stays a server-side env var
//     and never leaves Vercel.
//
// Env:
//   CHESTBOX_URL        e.g. https://chestbox.beta.internal
//   CHESTBOX_ADMIN_KEY  the SUPER_USER_KEY value

export default async function handler(req, res) {
  const base = process.env.CHESTBOX_URL;
  const key = process.env.CHESTBOX_ADMIN_KEY;

  if (!base || !key) {
    return res
      .status(500)
      .json({ error: "proxy_unconfigured", message: "Set CHESTBOX_URL and CHESTBOX_ADMIN_KEY" });
  }

  const segments = [].concat(req.query.path ?? []);
  // req.query carries the caller's params plus Vercel's own `path` capture —
  // forwarding `path` too would corrupt the upstream query string.
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query)) {
    if (k !== "path") params.set(k, v);
  }
  const search = params.toString() ? `?${params}` : "";
  const target = `${base.replace(/\/$/, "")}/${segments.join("/")}${search}`;

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers: {
        "Content-Type": "application/json",
        "x-admin-api-key": key,
        // ngrok free tier serves an HTML interstitial without this
        "ngrok-skip-browser-warning": "true",
      },
      body: ["GET", "HEAD"].includes(req.method) ? undefined : JSON.stringify(req.body ?? {}),
    });

    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "application/json");
    return res.send(text);
  } catch (e) {
    return res
      .status(502)
      .json({ error: "upstream_unreachable", message: `Cannot reach ${base}: ${e.message}` });
  }
}
