#!/usr/bin/env node
// server-proxy.mjs
//
// TCP-level reverse proxy that runs in front of the Next.js standalone
// server. It intercepts WebSocket upgrade requests bound for
//   /api/v1/managed_agents/sessions/<id>/tty
// and pipes the raw TCP connection directly to the cluster-internal sandbox
// pod (sandbox_url from the DB). Every other connection is forwarded to the
// Next.js server running on NEXT_PORT (default 3001).
//
// Why TCP-level: Next.js 16 App Router route handlers don't support WS
// upgrades (the connection closes after the response is generated). A
// raw-TCP proxy operates below the HTTP layer and avoids that restriction.
//
// Auth: the incoming WS upgrade must carry ?token=<value> matching either
// HARNESS_AUTH_TOKEN or MASTER_KEY. The token is forwarded as-is to the
// sandbox, which performs its own constant-time check.
//
// Startup: CMD ["sh", "-c", "... && node server-proxy.mjs"]
// Next.js is spawned as a child process on NEXT_PORT.

import { createServer } from "net";
import { connect } from "net";
import { spawn } from "child_process";
import { createRequire } from "module";
import { timingSafeEqual } from "crypto";
import { URL } from "url";

const require = createRequire(import.meta.url);

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const NEXT_PORT = parseInt(process.env.NEXT_PORT ?? "3001", 10);
const HOSTNAME = process.env.HOSTNAME ?? "0.0.0.0";

// Tokens accepted on the incoming WS upgrade. Both MASTER_KEY (operator
// access) and HARNESS_AUTH_TOKEN (the same value the frontend receives as
// tty_token) are valid. The proxy does NOT re-issue a different token to the
// sandbox — it forwards the request byte-for-byte, including the token, so
// the sandbox's own auth check handles validation on the far side.
const HARNESS_TOKEN = (process.env.HARNESS_AUTH_TOKEN ?? "").trim();
const CONTAINER_HARNESS_TOKEN = (process.env.CONTAINER_ENV_HARNESS_AUTH_TOKEN ?? "").trim();
const MASTER_KEY = (process.env.MASTER_KEY ?? "").trim();

function tokenOk(presented) {
  if (!presented) return false;
  const check = (expected) => {
    if (!expected) return false;
    try {
      const a = Buffer.from(presented, "utf8");
      const b = Buffer.from(expected, "utf8");
      if (a.length !== b.length) return false;
      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  };
  return check(HARNESS_TOKEN) || check(CONTAINER_HARNESS_TOKEN) || check(MASTER_KEY);
}

// --- Prisma lazy singleton ---
let _prisma = null;
function getPrisma() {
  if (!_prisma) {
    const { PrismaClient } = require("@prisma/client");
    _prisma = new PrismaClient({ log: [] });
  }
  return _prisma;
}

// Parse the HTTP request-line and headers from a raw buffer. Returns null if
// the header block isn't complete yet (caller should buffer more data).
function parseRequest(buf) {
  const str = buf.toString("latin1");
  const eoh = str.indexOf("\r\n\r\n");
  if (eoh === -1) return null;
  const lines = str.slice(0, eoh).split("\r\n");
  const requestLine = lines[0] ?? "";
  const headers = {};
  for (let i = 1; i < lines.length; i++) {
    const colon = lines[i].indexOf(":");
    if (colon === -1) continue;
    const key = lines[i].slice(0, colon).toLowerCase().trim();
    const val = lines[i].slice(colon + 1).trim();
    headers[key] = val;
  }
  return { requestLine, headers };
}

const TTY_PATH_RE = /\/api\/v1\/managed_agents\/sessions\/([^/?]+)\/tty/;

// Forward raw bytes to the Next.js server (running on NEXT_PORT locally).
// Retries the connect up to ~15 s to cover the Next.js cold-start window.
function forwardToNext(clientSocket, initialBuf, attempt = 0) {
  const target = connect(NEXT_PORT, "127.0.0.1");
  target.once("connect", () => {
    target.write(initialBuf);
    clientSocket.pipe(target);
    target.pipe(clientSocket);
    clientSocket.on("error", () => { try { target.destroy(); } catch {} });
    target.on("error", () => { try { clientSocket.destroy(); } catch {} });
  });
  target.once("error", () => {
    if (attempt < 30) {
      // Next.js not ready yet — retry after 500 ms.
      setTimeout(() => forwardToNext(clientSocket, initialBuf, attempt + 1), 500);
    } else {
      try {
        clientSocket.write(
          "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        );
        clientSocket.destroy();
      } catch {}
    }
  });
}

async function handleTtyUpgrade(clientSocket, buf, sessionId, token) {
  if (!tokenOk(token)) {
    try {
      clientSocket.write(
        "HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
      );
      clientSocket.destroy();
    } catch {}
    return;
  }

  let sandboxUrl;
  try {
    const session = await getPrisma().session.findUnique({
      where: { session_id: sessionId },
      select: { sandbox_url: true, status: true },
    });
    sandboxUrl = session?.sandbox_url ?? null;
  } catch (e) {
    console.error("[tty-proxy] DB lookup failed:", e.message);
    try {
      clientSocket.write(
        "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
      );
      clientSocket.destroy();
    } catch {}
    return;
  }

  if (!sandboxUrl) {
    try {
      clientSocket.write(
        "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
      );
      clientSocket.destroy();
    } catch {}
    return;
  }

  let parsed;
  try {
    parsed = new URL(sandboxUrl);
  } catch {
    console.error("[tty-proxy] bad sandbox_url:", sandboxUrl);
    try { clientSocket.destroy(); } catch {}
    return;
  }

  const host = parsed.hostname;
  const port = parseInt(parsed.port || "80", 10);

  const target = connect(port, host);
  target.once("connect", () => {
    target.write(buf);
    clientSocket.pipe(target);
    target.pipe(clientSocket);
    clientSocket.on("error", () => { try { target.destroy(); } catch {} });
    target.on("error", () => { try { clientSocket.destroy(); } catch {} });
  });
  target.once("error", (e) => {
    console.error(`[tty-proxy] sandbox connect error (${host}:${port}):`, e.message);
    try { clientSocket.destroy(); } catch {}
  });
}

function createProxy() {
  return createServer((clientSocket) => {
    let buf = Buffer.alloc(0);
    let decided = false;

    const onData = (chunk) => {
      if (decided) return;
      buf = Buffer.concat([buf, chunk]);

      const parsed = parseRequest(buf);
      // Wait for full header block (max 16 KB before giving up).
      if (!parsed && buf.length < 16_384) return;

      decided = true;
      clientSocket.removeListener("data", onData);

      if (!parsed) {
        forwardToNext(clientSocket, buf);
        return;
      }

      const { requestLine, headers } = parsed;
      const isUpgrade = (headers["upgrade"] ?? "").toLowerCase() === "websocket";

      if (isUpgrade) {
        const urlPart = requestLine.split(" ")[1] ?? "";
        const match = urlPart.match(TTY_PATH_RE);
        if (match) {
          const sessionId = match[1];
          const qIdx = urlPart.indexOf("?");
          const qParams = new URLSearchParams(qIdx >= 0 ? urlPart.slice(qIdx + 1) : "");
          const token = qParams.get("token") ?? "";
          handleTtyUpgrade(clientSocket, buf, sessionId, token).catch((e) => {
            console.error("[tty-proxy] unhandled error:", e.message);
            try { clientSocket.destroy(); } catch {}
          });
          return;
        }
      }

      forwardToNext(clientSocket, buf);
    };

    clientSocket.on("data", onData);
    clientSocket.on("error", () => {});
  });
}

// Start Next.js on an internal port so only the proxy faces the network.
function startNextServer() {
  const child = spawn("node", ["server.js"], {
    env: { ...process.env, PORT: String(NEXT_PORT), HOSTNAME: "127.0.0.1" },
    stdio: "inherit",
  });
  child.on("exit", (code) => {
    console.error(`[tty-proxy] Next.js exited (code=${code ?? "?"})`);
    process.exit(code ?? 1);
  });
  process.on("exit", () => {
    try { child.kill(); } catch {}
  });
}

startNextServer();

const proxy = createProxy();
proxy.listen(PORT, HOSTNAME, () => {
  console.log(
    `[tty-proxy] listening on ${HOSTNAME}:${PORT} — Next.js on 127.0.0.1:${NEXT_PORT}`,
  );
});
proxy.on("error", (e) => {
  console.error("[tty-proxy] server error:", e.message);
  process.exit(1);
});
