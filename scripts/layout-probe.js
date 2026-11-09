// One-off layout probe over the Chrome DevTools Protocol.
// Reports horizontal overflow and tap-target sizes at several widths.
// Uses Node's built-in global WebSocket (Node >= 22). Not part of the product.
import { spawn } from "node:child_process";

const WIDTHS = [320, 390, 768, 1280];
const PORT = 9333;

const chrome = spawn("chromium", [
  "--headless", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
  `--remote-debugging-port=${PORT}`, "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targets() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json`);
      const list = await r.json();
      const page = list.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error("no devtools target");
}

function cdp(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  const ready = new Promise((res) => (ws.onopen = res));
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((res) => {
      const mid = ++id;
      pending.set(mid, res);
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  return { ready, send, close: () => ws.close() };
}

async function evalIn(client, expression) {
  const r = await client.send("Runtime.evaluate", { expression, returnByValue: true });
  return r.result?.result?.value;
}

const url = process.argv[2] || "http://localhost:12000/";
const wsUrl = await targets();
const c = cdp(wsUrl);
await c.ready;
await c.send("Page.enable");
await c.send("Runtime.enable");

for (const w of WIDTHS) {
  await c.send("Emulation.setDeviceMetricsOverride", {
    width: w, height: 900, deviceScaleFactor: 1, mobile: w < 700,
  });
  await c.send("Page.navigate", { url });
  await sleep(2500);
  const report = await evalIn(
    c,
    `(() => {
      const de = document.documentElement;
      const overflow = de.scrollWidth - de.clientWidth;
      const small = [];
      for (const el of document.querySelectorAll("button,a,input,select")) {
        const r = el.getBoundingClientRect();
        if (r.width && r.height && (r.width < 44 || r.height < 44) && r.top < 2000) {
          small.push((el.textContent||el.tagName).trim().slice(0,18) + " " + Math.round(r.width) + "x" + Math.round(r.height));
        }
      }
      return JSON.stringify({
        w: de.clientWidth,
        scrollWidth: de.scrollWidth,
        overflow,
        h1: document.querySelectorAll("h1").length,
        h2: document.querySelectorAll("h2").length,
        buttons: document.querySelectorAll("button").length,
        smallTargets: small.slice(0, 6),
        hasAltOrLabel: [...document.querySelectorAll("input")].every(i => i.id || i.getAttribute("aria-label")),
      });
    })()`
  );
  console.log(`width ${String(w).padStart(4)} -> ${report}`);
}
c.close();
chrome.kill();
process.exit(0);
