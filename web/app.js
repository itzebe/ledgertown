// Ledgertown interface. Served as an external module so the page can use a
// strict Content-Security-Policy without 'unsafe-inline' for scripts.
//
// The town is REAL: every figure comes from /api/state (final-finality views of
// town.ledgertown.testnet) and the economic signals are derived purely from
// those numbers (economy.js, game.js). Nothing here invents a balance, a price
// or a decision.
//
// PLAY is non-custodial. The player's NEAR key never touches this site: we ask
// the browser wallet extension to sign each action (wallet.js) and read back the
// connected account's own purse through /api/player. There is no server signer,
// so the same deployment is safe to expose publicly.
import { GOODS, marketRead } from "./economy.js";
import { tradeSignals, challenges as buildChallenges, netWorth, cargoValue } from "./game.js";

// The wallet module (and the 462 kB near-api-js bundle it imports) is loaded
// only when the visitor connects — a read-only visitor never downloads it.
// Detection needs no bundle, so it lives here.
function detectInjectedWallet(win = globalThis){
  return win?.freighter || win?.near?.wallet || null;
}

const EXPLORER = "https://testnet.nearblocks.io/txns/";
let state = null;
let read = null;
let prevMerchants = null;
let lastDay = null;
let focusMerchant = null;
let provenance = null;
let player = null;           // the connected account's own purse, or null
let walletCtl = null;        // wallet controller, or null when no extension
let walletStatus = "browse"; // browse | connecting | connected | pending | error
let walletError = null;
let busy = false;

function toast(msg, err){
  const t = document.getElementById("toast");
  t.textContent = msg; t.className = "toast show" + (err ? " err" : "");
  clearTimeout(t._h); t._h = setTimeout(()=>{ t.className="toast"; }, 4200);
}
function money(n){ return (n??0).toLocaleString(); }
function esc(s){ return String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
function setBanner(msg){
  document.getElementById("banner-slot").innerHTML = msg ? `<div class="banner" role="alert">${msg}</div>` : "";
}
function delta(cur, prev){
  if(prev == null || cur == null) return "";
  const d = cur - prev;
  if(d === 0) return `<span class="delta flat">·</span>`;
  return `<span class="delta ${d>0?"up":"down"}">${d>0?"▲":"▼"}${Math.abs(d)}</span>`;
}
async function api(method, path, body){
  const r = await fetch(path, {
    method, headers: {"Content-Type":"application/json"},
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(()=>({ok:false,error:"bad response"}));
  if(!j.ok) throw new Error(j.error || "request failed");
  return j;
}
function prevOf(id){ return prevMerchants ? prevMerchants.find(p => p.id === id) : null; }
function meter(ratio, cls, tickRatio){
  const pct = Math.max(0, Math.min(1, ratio)) * 100;
  const tick = tickRatio != null ? `<i class="tick" style="left:${Math.max(0,Math.min(1,tickRatio))*100}%"></i>` : "";
  return `<div class="meter ${cls}"><span style="width:${pct}%"></span>${tick}</div>`;
}

// -- wallet ----------------------------------------------------------------

function renderWallet(){
  const slot = document.getElementById("wallet-slot");
  const ext = detectInjectedWallet();
  const chipCls = walletStatus === "connected" ? "on" : walletStatus === "pending" ? "pending" : walletStatus === "error" ? "err" : "";

  let chip;
  if(walletStatus === "connected" || walletStatus === "pending"){
    chip = `<span class="wchip ${chipCls}" title="${esc(walletCtl?.accountId || "")}">● <span class="id">${esc(walletCtl?.accountId || "")}</span>${walletStatus==="pending"?" · signing…":""}</span>
      <button id="w-disconnect">Disconnect</button>`;
  } else {
    chip = `<button class="primary" id="w-connect"${ext?"":" disabled"}>Connect wallet</button>`;
  }

  let note;
  if(!ext){
    note = `<p class="wnote"><b>No NEAR wallet found in this browser.</b> Install a NEAR wallet
      extension (for example <a href="https://www.freighter.app/" target="_blank" rel="noopener">Freighter</a>),
      switch it to <b>testnet</b>, then reload. The town below is live and readable without a wallet —
      connecting only adds your own purse and the ability to act.</p>`;
  } else if(walletStatus === "connected" || walletStatus === "pending"){
    note = `<p class="wnote">Connected. Every action below is signed by your wallet and settles on
      NEAR testnet — the site never sees your key. Gathering is free; buying, selling and investing
      move real testnet credits. No deposit is ever required to play.</p>`;
  } else if(walletStatus === "error"){
    note = `<p class="wnote"><b>Wallet error:</b> ${esc(walletError || "unknown")}.</p>`;
  } else {
    note = `<p class="wnote">Play is <b>non-custodial</b>: connect your own NEAR testnet wallet and
      sign each action yourself. The site holds no keys and never asks for a deposit.</p>`;
  }

  const net = walletStatus === "connected" || walletStatus === "pending"
    ? `<div class="networth"><span class="big num">${money(netWorth(player))}</span><span class="cap">credits net worth</span></div>
       <div class="netbreak">${money(player?.cash ?? 0)} credits + ${money(cargoValue(player))} in cargo (reference value)</div>`
    : "";

  slot.innerHTML = `<div class="wrow">${chip}</div>${note}${net}`;
}

function renderPlayActions(){
  const slot = document.getElementById("play-actions");
  if(!state) return;
  const perAccount = state.model === "per-account";
  const connected = walletStatus === "connected" || walletStatus === "pending";

  if(!perAccount){
    slot.innerHTML = `<div class="warnbox"><b>The live contract still uses the original
      single-purse model.</b> Personal play (own purse, gather, buy, sell, invest) activates when the
      owner deploys the per-account upgrade to <span class="num">${esc(state.contract)}</span> — the
      migration preserves all existing state. The town below is fully live and readable now.</div>`;
    return;
  }
  if(!connected){
    slot.innerHTML = `<div class="warnbox">Connect a NEAR testnet wallet to act. Reads below stay live
      without one.</div>`;
    return;
  }
  slot.innerHTML = `<div class="wrow">
      <button class="primary" id="p-init">Open my purse</button>
      <span class="cap" style="align-self:center">Market clock — advance the town one day</span>
      <button id="p-advance">Advance one day ▸</button>
    </div>`;
}

function renderChallenges(){
  const el = document.getElementById("challenges");
  if(!state){ el.innerHTML = ""; return; }
  const list = buildChallenges(state, player);
  if(!list.length){ el.innerHTML = `<p class="wnote">The market is calm — no obvious opening right now. Watch the price board below.</p>`; return; }
  el.innerHTML = list.map(c => {
    const perAccount = state.model === "per-account";
    const connected = walletStatus === "connected" || walletStatus === "pending";
    const canAct = perAccount && connected;
    let buttons = "";
    if(c.id === "gather"){
      buttons = `<button class="gather" data-gather="${esc(c.good)}" ${canAct?"":"disabled"}>Gather ${esc(c.good)}</button>`;
    } else if(c.id === "arbitrage"){
      buttons = `<button data-buy="${esc(c.from)}" data-good="${esc(c.good)}" ${canAct?"":"disabled"}>Buy at ${esc(c.from)}</button>
                 <button data-sell="${esc(c.to)}" data-good="${esc(c.good)}" ${canAct?"":"disabled"}>Sell to ${esc(c.to)}</button>`;
    } else if(c.id === "rescue"){
      buttons = `<button data-invest="${esc(c.merchant)}" data-amount="${esc(c.need || 0)}" ${canAct?"":"disabled"}>Invest ${money(c.need || 0)}</button>`;
    } else if(c.id === "supply"){
      buttons = `<button class="gather" data-gather="${esc(c.good)}" ${canAct?"":"disabled"}>Gather ${esc(c.good)}</button>
                 <button data-sell="${esc(c.merchant)}" data-good="${esc(c.good)}" ${canAct?"":"disabled"}>Sell to ${esc(c.merchant)}</button>`;
    }
    return `<div class="chal">
      <div class="ct">${esc(c.title)}</div>
      <div class="cd">${esc(c.detail)}</div>
      ${buttons ? `<div class="do">${buttons}</div>` : ""}
    </div>`;
  }).join("");
}

// -- read-only market ------------------------------------------------------

function decisionBlock(m){
  const d = m.decision || {status:"none", plain:"No agent decision recorded yet."};
  const tag = d.status === "accepted" ? "accepted"
            : d.status === "rejected" ? "rejected"
            : d.status === "recorded" ? "recorded" : "no decision";
  return `<div class="decision ${d.status}"><span class="tag">${tag}</span><span class="why">${esc(d.plain)}</span></div>`;
}

function renderPulse(){
  const s = read.summary;
  document.getElementById("p-open").textContent = `${s.open}/${s.total}`;
  document.getElementById("p-cash").textContent = money(s.cash);
  document.getElementById("p-player").textContent = player ? money(player.cash) : "—";
  const sc = read.scarcity;
  document.getElementById("p-scarcity").innerHTML = GOODS.map(({good}) => {
    const x = sc[good];
    const label = x.verdict === "none" ? "none left"
      : x.verdict === "scarce" ? "scarce"
      : x.verdict === "tight" ? "tight"
      : x.verdict === "glut" ? "glut"
      : "stocked";
    const cover = x.daysOfCover == null ? "" : `${x.daysOfCover.toFixed(1)}d cover`;
    return `<span class="chip ${x.verdict}" title="${good}: ${x.stock} units across ${x.shops} shop(s); base demand ${x.dbase}/day; ${cover}">
      <span class="g">${good}</span><span class="m num">${x.stock}u</span><span class="v">${label}</span></span>`;
  }).join("");
}

function renderMarket(){
  const el = document.getElementById("market");
  const perAccount = state.model === "per-account";
  const connected = walletStatus === "connected" || walletStatus === "pending";
  const canAct = perAccount && connected;
  el.innerHTML = "";
  for(const m of state.merchants){
    const r = read.merchants[m.id];
    const p = prevOf(m.id);
    const pCash = p ? p.cash : null;
    const pInv = p ? (p.inventory?.[m.specialty] ?? 0) : null;
    const pList = p ? (p.list_price?.[m.specialty] ?? null) : null;
    const closed = m.state === "closed";
    const ro = canAct ? "" : "disabled";
    const stateClass = closed ? "closed" : (m.cash < 0 ? "insolvent" : "open");
    const cashCls = r.health === "healthy" ? "good" : r.health === "thin" ? "warn" : "bad";
    const cashRatio = r.cashRatio == null ? 0 : r.cashRatio / 4;
    const stockCls = r.stockRatio == null ? "" : (r.stockRatio < 0.5 || r.stockRatio > 2) ? "warn" : "good";
    const stockPct = r.stockRatio == null ? 0 : Math.min(1, r.stockRatio / 2);

    const actions = closed
      ? `<div class="actions">
           <span class="cap" style="align-self:center">Revive · needs ≥ ${money(r.reserve)}</span>
           <input type="number" value="${Math.max(1, r.reserve)}" min="1" id="u-${m.id}" aria-label="credits to invest in ${m.name}" />
           <button class="primary" data-invest="${m.id}" ${ro}>Invest to reopen</button>
         </div>`
      : `<div class="actions">
           <span class="cap" style="align-self:center">units</span>
           <input type="number" value="1" min="1" id="u-${m.id}" aria-label="units for ${m.name}" />
           <button data-buy="${m.id}" ${ro}>Buy ${m.specialty}</button>
           <button data-sell="${m.id}" ${ro}>Sell ${m.specialty}</button>
         </div>`;

    const shop = document.createElement("article");
    shop.className = "shop " + stateClass;
    shop.setAttribute("aria-label", `${m.name}, ${m.specialty} shop, ${m.state}`);
    shop.innerHTML = `
      <div class="top">
        <div>
          <div class="nm">${esc(m.name)}<span class="sp">${m.specialty}</span>${m.reopened_count ? `<span class="recovered" title="Times revived by investment">revived ×${m.reopened_count}</span>`:""}</div>
          <div class="acct" title="Real NEAR testnet account that operates this shop">${esc(m.account)}</div>
        </div>
        <span class="state ${stateClass}">${closed ? "closed" : m.state}</span>
      </div>
      <div class="instruments">
        <div class="inst">
          <div class="cap">Cash ${delta(m.cash, pCash)}</div>
          <div class="v num">${money(m.cash)}</div>
          ${meter(cashRatio, cashCls, 0.25)}
          <div class="sub">reserve ${money(r.reserve)}</div>
        </div>
        <div class="inst">
          <div class="cap">Stock ${delta(r.inv, pInv)}</div>
          <div class="v num">${r.inv}</div>
          ${meter(stockPct, stockCls, 0.5)}
          <div class="sub">target ${r.target}</div>
        </div>
        <div class="inst">
          <div class="cap">Sells at ${delta(r.list, pList)}</div>
          <div class="v num">${r.list==null?"—":r.list}</div>
          <div class="sub ${r.marginPct!=null?(r.marginPct>=0?"pos":"neg"):""}">${r.marginPct!=null?`${r.marginPct>=0?"+":""}${r.marginPct}% over cost`:"—"}</div>
        </div>
        <div class="inst">
          <div class="cap">Buys at</div>
          <div class="v num">${r.bid==null?"—":r.bid}</div>
          <div class="sub">avg cost ${r.avgCost}</div>
        </div>
      </div>
      ${decisionBlock(m)}
      <div class="risk ${read.risk[m.id].level}">${esc(read.risk[m.id].text)}</div>
      ${actions}`;
    el.appendChild(shop);
  }
}

function renderBoard(){
  const el = document.getElementById("board");
  const signals = Object.fromEntries(tradeSignals(state.merchants).map(s => [s.good, s]));
  el.innerHTML = "";
  for(const {good, dbase} of GOODS){
    const quotes = read.board[good] || [];
    const sig = signals[good];
    const hint = sig?.arbitrage
      ? `<span class="q cheap" style="border-style:dashed" title="Buy at ${esc(sig.buy.name)} for ${sig.buy.price}, sell to ${esc(sig.sell.name)} for ${sig.sell.price}">spread ${sig.spread}</span>`
      : "";
    const row = document.createElement("div");
    row.className = "brow";
    const qhtml = quotes.length
      ? quotes.map(q => `<span class="q ${q.cheapest?"cheap":""} ${q.dearest?"dear":""}" title="${esc(q.name)} sells ${good} at ${q.price}${q.bid!=null?`; buys at ${q.bid}`:""}">
          <span class="who">${esc(q.name)}</span><span class="p num">${q.price}</span></span>`).join("") + hint
      : '<span class="muted" style="font-size:12px">no open shop quotes this good</span>';
    row.innerHTML = `<div class="gname">${good}<span class="dc">${dbase}/day</span></div><div class="quotes">${qhtml}</div>`;
    el.appendChild(row);
  }
}

function renderPurse(){
  document.getElementById("pcash").textContent = player ? money(player.cash) : "—";
  document.getElementById("pnet").textContent = player ? money(netWorth(player)) : "—";
  const inv = player?.inventory || {};
  const keys = Object.keys(inv).filter(k=>inv[k]>0);
  document.getElementById("pinv").innerHTML = keys.length
    ? keys.map(k=>`<span>${k}: ${inv[k]}</span>`).join("")
    : '<span class="muted">empty</span>';
  const note = document.getElementById("shared-note");
  if(state?.model !== "per-account"){
    note.textContent = "The live contract still stores one shared purse. Personal play opens when the owner deploys the per-account upgrade.";
  } else if(player){
    note.textContent = "Your own on-chain purse. Gathering is free; credits come from trading.";
  } else if(walletStatus === "connected" || walletStatus === "pending"){
    note.textContent = "Connected — open your purse to begin (free).";
  } else {
    note.textContent = "Connect a wallet to open your own purse.";
  }
  // The purse's gather buttons are markup in index.html; gate them here so they
  // are never enabled on the single-purse contract or before a wallet connects.
  const canAct = state?.model === "per-account" && (walletStatus === "connected" || walletStatus === "pending");
  document.querySelectorAll("#purse-gather .gather").forEach(b=>{ b.disabled = !canAct; });
}

function kindClass(kind){
  if(/CLOSED|INSOLVENT/.test(kind)) return "close";
  if(/REOPEN|LIFELINE/.test(kind)) return "reopen";
  return "";
}

function renderTimeline(){
  const el = document.getElementById("timeline");
  if(!el) return;
  const evs = state.events || [];
  const milestones = evs.filter(e => /CLOSED|REOPENED|LIFELINE/.test(e.kind)).sort((a,b) => a.day - b.day);
  const marks = [];
  if(evs.length) marks.push({ day: 1, cls: "", v: "opened", sub: "town seeded" });
  for(const e of milestones){
    const cls = e.kind === "CLOSED" ? "bad" : "ok";
    marks.push({ day: e.day, cls, v: `${e.kind.toLowerCase()} ${e.merchant}`, sub: `cash ${e.value}` });
  }
  marks.push({ day: state.day, cls: "now", v: "today", sub: `day ${state.day}` });
  el.innerHTML = marks.map(m => `
    <div class="tl ${m.cls}">
      <div class="dlbl">day ${m.day}</div>
      <div class="tlv">${esc(m.v)}</div>
      <div class="tlsub">${esc(m.sub)}</div>
    </div>`).join("");
}

function renderLog(){
  const el = document.getElementById("log");
  const evs = [...(state.events||[])].reverse();
  el.innerHTML = evs.length ? "" : '<div class="ev"><div class="day">—</div><div class="muted">No events yet.</div></div>';
  for(const e of evs){
    const div = document.createElement("div");
    div.className = "ev" + (e.day === state.day ? " today" : "");
    const et = provenance?.eventTx?.[e.kind];
    const txline = et
      ? `<div class="tx">tx <a target="_blank" rel="noopener" href="${EXPLORER}${encodeURIComponent(et.hash)}" title="${esc(et.note)}">${esc(et.hash.slice(0,14))}…</a></div>`
      : "";
    div.innerHTML = `
      <div class="day num">d${e.day}</div>
      <div>
        <div><span class="kind ${kindClass(e.kind)}">${esc(e.kind)}</span> · ${esc(e.merchant)} · <span class="num">${e.value}</span></div>
        <div class="muted">${esc(e.note||"")}</div>
        ${txline}
      </div>`;
    el.appendChild(div);
  }
}

function renderMine(){
  const el = document.getElementById("mine");
  const all = state.recentTxs || [];
  const txs = focusMerchant ? all.filter(t => t.merchant === focusMerchant) : all;
  const head = focusMerchant
    ? `<div class="ev"><div class="day">—</div><div class="muted">Showing ${esc(focusMerchant)}. <a href="#" id="clear-focus">Show all</a></div></div>`
    : "";
  el.innerHTML = head + (txs.length ? "" : '<div class="ev"><div class="day">—</div><div class="muted">No transactions yet — take an action above.</div></div>');
  for(const t of txs){
    const div = document.createElement("div");
    div.className = "ev";
    div.innerHTML = `
      <div class="day num">${new Date(t.at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</div>
      <div>
        <div><span class="kind">${esc(t.label)}</span>${t.merchant?` · ${esc(t.merchant)}`:""}</div>
        <div class="tx">tx <a target="_blank" rel="noopener" href="${EXPLORER}${encodeURIComponent(t.hash)}">${esc(t.hash)}</a></div>
      </div>`;
    el.appendChild(div);
  }
}

function renderProvenance(){
  const el = document.getElementById("prov");
  if(!provenance){ el.innerHTML = '<div class="muted" style="font-size:12px">loading…</div>'; return; }
  el.innerHTML = provenance.txs.map(t => `
    <div class="prow">
      <div class="lbl">${esc(t.label)}</div>
      <div class="h"><a target="_blank" rel="noopener" href="${EXPLORER}${encodeURIComponent(t.hash)}" title="${esc(t.hash)}">${esc(t.hash.slice(0,10))}…</a></div>
    </div>`).join("");
}

async function loadProvenance(){
  try{ provenance = await (await fetch("/provenance.json")).json(); }
  catch{ provenance = { txs: [] }; }
  renderProvenance();
  if(state) renderLog();
}

async function refresh(){
  try{
    const next = await api("GET","/api/state");
    if(lastDay !== null && next.day !== lastDay && state){ prevMerchants = state.merchants; }
    lastDay = next.day;
    state = next;
    read = marketRead(state);
    document.getElementById("day").textContent = state.day;
    document.getElementById("contract").textContent = state.contract;
    if(state.model === "per-account" && walletCtl?.accountId){
      try{
        const r = await api("GET", `/api/player?account=${encodeURIComponent(walletCtl.accountId)}`);
        player = r.player;
      }catch{ /* purse read is best-effort; the town still renders */ }
    } else {
      player = null;
    }
    setBanner("");   // a good read clears any stale transient error
    renderPulse(); renderMarket(); renderBoard(); renderPurse(); renderTimeline(); renderLog(); renderMine();
    renderWallet(); renderChallenges(); renderPlayActions();
  }catch(e){
    // A transient upstream failure (RPC rate limit, brief outage) must NOT
    // blank a town we have already rendered. Keep the last real state on
    // screen and say plainly that the refresh failed.
    if(state){
      toast(`Refresh failed (${e.message}); showing the last read.`, true);
    } else {
      setBanner(`Cannot reach the town contract: ${esc(e.message)}. ` +
        `The server proxies to NEAR testnet — check it is running and the RPC is reachable.`);
      toast("State error: "+e.message, true);
    }
  }
}

// -- play (client-signed) --------------------------------------------------

let walletModule = null; // { createInjectedWallet, createWalletController }, loaded on demand

async function connectWallet(){
  const ext = detectInjectedWallet();
  if(!ext){ toast("No NEAR wallet extension found — install one and reload.", true); return; }
  walletStatus = "connecting"; walletError = null;
  renderWallet(); renderPlayActions();
  try{
    walletModule = walletModule || await import("./wallet.js");
    walletCtl = walletModule.createWalletController({
      wallet: walletModule.createInjectedWallet(ext),
      contractId: state.contract,
      onChange: ({ accountId, status, error }) => {
        walletStatus = status; walletError = error;
        renderWallet(); renderChallenges(); renderPlayActions();
      },
    });
    const id = await walletCtl.connect();
    toast(`Connected as ${id}`);
    await refresh();
  }catch(e){
    walletStatus = "error"; walletError = String(e?.message || e);
    renderWallet(); renderPlayActions();
    toast("Wallet connect failed: " + e.message, true);
  }
}

// Sign and send one player action, then refresh the town so the change shows.
async function playerAct(label, method, args, merchant){
  if(!walletCtl || !walletCtl.accountId){ toast("Connect a wallet first.", true); return; }
  if(busy) return;
  busy = true;
  document.querySelectorAll("button").forEach(b=>b.disabled=true);
  try{
    const { hash } = await walletCtl.act(method, args);
    if(merchant) focusMerchant = merchant;
    toast(`${label} — tx ${hash ? hash.slice(0,14)+"…" : "sent"}`);
    await refresh();
  }catch(e){
    toast(`${label} failed: ${e.message}`, true);
  } finally {
    busy = false;
    document.querySelectorAll("button").forEach(b=>b.disabled=false);
    renderPlayActions();
    renderWallet();
  }
}

document.addEventListener("click", async (ev)=>{
  if(ev.target.id === "clear-focus"){ ev.preventDefault(); focusMerchant = null; renderMine(); return; }
  const b = ev.target.closest("button"); if(!b) return;

  if(b.id === "w-connect") return connectWallet();
  if(b.id === "w-disconnect"){ walletCtl?.disconnect(); player = null; refresh(); return; }
  if(b.id === "p-init") return playerAct("Purse opened", "player_init", {});
  if(b.id === "p-advance") return playerAct("Advanced one day", "tick", {});

  // Every player action below is refused unless the per-account contract is live
  // and a wallet is connected — defence in depth beyond the disabled attribute.
  const canAct = state?.model === "per-account" && (walletStatus === "connected" || walletStatus === "pending");
  const isPlayerAction = b.dataset.gather || b.dataset.buy || b.dataset.sell || b.dataset.invest;
  if(isPlayerAction && !canAct){
    toast(state?.model !== "per-account"
      ? "Play needs the per-account contract upgrade — not deployed yet."
      : "Connect a NEAR testnet wallet first.", true);
    return;
  }

  if(b.dataset.gather){
    const units = 5;
    return playerAct(`Gathered ${units} ${b.dataset.gather}`, "player_gather", { good: b.dataset.gather, units: String(units) });
  }
  if(b.dataset.buy){
    const id = b.dataset.buy;
    const good = b.dataset.good || state.merchants.find(x=>x.id===id)?.specialty;
    const input = document.getElementById("u-"+id);
    const units = input ? (Number(input.value)||1) : 1;
    return playerAct(`Bought ${units} ${good} from ${id}`, "player_buy_from", { merchant_id: id, good, units: String(units) }, id);
  }
  if(b.dataset.sell){
    const id = b.dataset.sell;
    const good = b.dataset.good || state.merchants.find(x=>x.id===id)?.specialty;
    const input = document.getElementById("u-"+id);
    const units = input ? (Number(input.value)||1) : 1;
    return playerAct(`Sold ${units} ${good} to ${id}`, "player_sell_to", { merchant_id: id, good, units: String(units) }, id);
  }
  if(b.dataset.invest){
    const id = b.dataset.invest;
    const input = document.getElementById("u-"+id);
    const amount = b.dataset.amount ? Number(b.dataset.amount) : (input ? (Number(input.value)||200) : 200);
    return playerAct(`Invested ${amount} in ${id}`, "player_invest", { merchant_id: id, amount: String(amount) }, id);
  }
});

loadProvenance();
refresh();
setInterval(refresh, 6000);
