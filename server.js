import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { URL } from "url";

/* ===============================
   BASIC APP SETUP
   =============================== */
const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.static(__dirname));

/* ===============================
   UTILITIES
   =============================== */
function isHtml(headers) {
  return (headers.get("content-type") || "").includes("text/html");
}

function sanitizeHeaders(headers) {
  const blocked = [
    "content-security-policy",
    "content-security-policy-report-only",
    "x-frame-options",
    "strict-transport-security",
    "permissions-policy"
  ];

  const out = {};
  for (const [k, v] of headers.entries()) {
    if (!blocked.includes(k.toLowerCase())) {
      out[k] = v;
    }
  }
  return out;
}

function rewriteLinks(html, base) {
  return html.replace(
    /(href|src|action)=["'](?!https?:|data:|#|mailto:|javascript:)([^"']+)["']/gi,
    (m, attr, link) => {
      try {
        const abs = new URL(link, base).href;
        return `${attr}="/proxy?url=${encodeURIComponent(abs)}"`;
      } catch {
        return m;
      }
    }
  );
}

/* ===============================
   PROXY BACKENDS
   =============================== */

const backends = [];

/* ---------- BACKEND: FETCH ---------- */
backends.push({
  name: "fetch",
  async handle(req, res, target) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const response = await fetch(target, {
      method: "GET",
      headers: {
        "user-agent":
          req.headers["user-agent"] ||
          "Mozilla/5.0 ODE/4.0",
        "accept": "*/*"
      },
      redirect: "follow",
      signal: controller.signal
    });

    clearTimeout(timeout);

    res.status(response.status);
    const headers = sanitizeHeaders(response.headers);
    for (const k in headers) res.setHeader(k, headers[k]);

    if (!isHtml(response.headers)) {
      response.body.pipe(res);
      return true;
    }

    let html = await response.text();
    html = rewriteLinks(html, target);
    res.send(html);
    return true;
  }
});

/* ---------- BACKEND: FORWARD ---------- */
backends.push({
  name: "forward",
  async handle(req, res, target) {
    const response = await fetch(target, {
      headers: {
        "user-agent": "ODE-Forward/1.0",
        "accept": "*/*"
      }
    });

    res.status(response.status);
    const headers = sanitizeHeaders(response.headers);
    for (const k in headers) res.setHeader(k, headers[k]);

    response.body.pipe(res);
    return true;
  }
});

/* ===============================
   PROXY ROUTER (PLUGGABLE)
   =============================== */
app.get("/proxy", async (req, res) => {
  const target = req.query.url;
  if (!target) return res.status(400).send("Missing url");

  let lastError = null;

  for (const backend of backends) {
    try {
      console.log(`[proxy] ${backend.name} → ${target}`);
      res.setHeader("x-proxy-backend", backend.name);
      await backend.handle(req, res, target);
      return;
    } catch (err) {
      console.warn(`[proxy] ${backend.name} failed`);
      lastError = err;
    }
  }

  res.status(502).send(`
    <html>
      <body style="font-family:sans-serif;background:#111;color:#fff;padding:20px">
        <h2>Proxy failed</h2>
        <p>All backends failed.</p>
        <pre>${lastError?.message || "Unknown error"}</pre>
      </body>
    </html>
  `);
});

/* ===============================
   AI-STYLE MONITOR ENDPOINT
   (non-LLM, safe, lightweight)
   =============================== */
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    backends: backends.map(b => b.name),
    uptime: process.uptime()
  });
});

/* ===============================
   FALLBACK
   =============================== */
app.use((req, res) => {
  res.status(404).send("Not found");
});

/* ===============================
   START
   =============================== */
app.listen(PORT, () => {
  console.log(`ODE Hub running on http://localhost:${PORT}`);
});
