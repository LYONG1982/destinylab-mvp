// Local diagnostic preload only. Never logs headers, query strings or bodies.
import http from "node:http";
import { syncBuiltinESMExports } from "node:module";
import { monitorEventLoopDelay } from "node:perf_hooks";
const original = http.createServer;
let sequence = 0;
const log = (entry) =>
  console.log(JSON.stringify({ diagnostic: true, at: Date.now(), ...entry }));
http.createServer = function (...args) {
  const server = original.apply(this, args);
  server.prependListener("request", (req, res) => {
    const path = (req.url || "").split("?")[0];
    if (!path.startsWith("/api/") && !path.startsWith("/mobile/")) return;
    const id = ++sequence,
      start = Date.now();
    log({ id, phase: "start", method: req.method, path });
    res.once("finish", () =>
      log({
        id,
        phase: "finish",
        status: res.statusCode,
        ms: Date.now() - start,
      }),
    );
    res.once("close", () => {
      if (!res.writableFinished)
        log({ id, phase: "closed", ms: Date.now() - start });
    });
  });
  return server;
};
syncBuiltinESMExports();
const delay = monitorEventLoopDelay({ resolution: 20 });
delay.enable();
setInterval(() => {
  log({
    phase: "eventLoop",
    p95Ms: Math.round(delay.percentile(95) / 1e6),
    maxMs: Math.round(delay.max / 1e6),
  });
  delay.reset();
}, 5000).unref();
