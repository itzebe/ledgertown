// Ledgertown interface. Served as an external module so the page can use a
// strict Content-Security-Policy without 'unsafe-inline' for scripts.
//
// The interface is a *reading* of real contract state: every figure comes from
// /api/state (which reads `final`-finality views of town.ledgertown.testnet),
// and the economic signals are derived purely from those numbers (see
// economy.js). Nothing here invents a balance, a price or a decision.
import { GOODS, marketRead } from "./economy.js";

const EXPLORER = "https://testnet.nearblocks.io/txns/";
let state = null;
let read = null;            // derived economic read of `state`
let prevMerchants = null;   // previous day's snapshot, for day-over-day deltas
let lastDay = null;
let focusMerchant = null;   // merchant whose transactions the player last acted on
let provenance = null;

function toast(msg, err){
  const t = document.getElementById("toast");
  t.textContent = msg; t.className = "toast show" + (err ? " err" : "");
  clearTimeout(t._h); t._h = setTimeout(()=>{ t.className="toast"; }, 4200);
}
function money(n){ return (n??0).toLocaleString(); }
function esc(s){ return String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }

function setBanner(msg){
  const el = document.getElementById("banner-slot");
  el.innerHTML = msg ? `<div class="banner" role="alert">${msg}</div>` : "";
}

// Delta since the previous day: the "what changed since yesterday" signal.
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

// A thin accounting meter: fill = value/cap, with a tick marking the target.
function meter(ratio, cls, tickRatio){
  const pct = Math.max(0, Math.min(1, ratio)) * 100;
  const tick = tickRatio != null ? `<i class="tick" style="left:${Math.max(0,Math.min(1,tickRatio))*100}%"></i>` : "";
  return `<div class="meter ${cls}"><span style="width:${pct}%"></span>${tick}</div>`;
}

// Plain-language rendering of the contract's real last_decision.
function decisionBlock(m){
  const d = m.decision || {status:"none", plain:"No agent decision recorded yet."};
  const tag = d.status === "accepted" ? "accepted"
            : d.status === "rejected" ? "rejected"
            : d.status === "recorded" ? "recorded" : "no decision";
  return `<div class="decision ${d.status}"><span class="tag">${tag}</span><span class="why">${esc(d.plain)}</span></div>`;
}

function renderModeNote(){
  if(state.canAct){ setBanner(""); return; }
  document.getElementById("banner-slot").innerHTML =
    `<div class="mode-note"><b>Read-only preview.</b> This deployment serves live NEAR
     testnet state without holding any signing keys, so the trade buttons are disabled
     here. Every figure, the ledger and every explorer link are real. To play, run the
     server in play mode with a demo key (see the README).</div>`;
  document.querySelectorAll(".gather, #advance, #advance7").forEach(b=>{
    b.disabled = true; b.title = "Read-only deployment — actions are disabled here";
  });
}

function renderPulse(){
  const s = read.summary;
  document.getElementById("p-open").textContent = `${s.open}/${s.total}`;
  document.getElementById("p-cash").textContent = money(s.cash);
  document.getElementById("p-player").textContent = money(state.player.cash);
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
  el.innerHTML = "";
  for(const m of state.merchants){
    const r = read.merchants[m.id];
    const p = prevOf(m.id);
    const pCash = p ? p.cash : null;
    const pInv = p ? (p.inventory?.[m.specialty] ?? 0) : null;
    const pList = p ? (p.list_price?.[m.specialty] ?? null) : null;
    const closed = m.state === "closed";
    const ro = state.canAct ? "" : "disabled";

    const stateClass = closed ? "closed" : (m.cash < 0 ? "insolvent" : "open");
    // cash instrument: meter against 4x reserve, tick at the reserve line (1x).
    const cashCls = r.health === "healthy" ? "good" : r.health === "thin" ? "warn" : "bad";
    const cashRatio = r.cashRatio == null ? 0 : r.cashRatio / 4;
    const cashTick = 0.25;
    // stock instrument: meter against 2x target, tick at the target (1x).
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
          ${meter(cashRatio, cashCls, cashTick)}
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
  el.innerHTML = "";
  for(const {good, dbase} of GOODS){
    const quotes = read.board[good] || [];
    const row = document.createElement("div");
    row.className = "brow";
    const qhtml = quotes.length
      ? quotes.map(q => `<span class="q ${q.cheapest?"cheap":""} ${q.dearest?"dear":""}" title="${esc(q.name)} sells ${good} at ${q.price}${q.bid!=null?`; buys at ${q.bid}`:""}">
          <span class="who">${esc(q.name)}</span><span class="p num">${q.price}</span></span>`).join("")
      : '<span class="muted" style="font-size:12px">no open shop quotes this good</span>';
    row.innerHTML = `<div class="gname">${good}<span class="dc">${dbase}/day</span></div><div class="quotes">${qhtml}</div>`;
    el.appendChild(row);
  }
}

function renderPurse(){
  document.getElementById("pcash").textContent = money(state.player.cash);
  document.getElementById("pdep").textContent = (state.player.deposited_yocto/1e24).toFixed(3) + " NEAR";
  const inv = state.player.inventory || {};
  const keys = Object.keys(inv).filter(k=>inv[k]>0);
  document.getElementById("pinv").innerHTML = keys.length
    ? keys.map(k=>`<span>${k}: ${inv[k]}</span>`).join("")
    : '<span class="muted">empty</span>';
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
  // Milestones are the real lifecycle events the contract recorded — nothing is
  // fabricated. Start and "now" always frame the real span.
  const milestones = evs
    .filter(e => /CLOSED|REOPENED|LIFELINE/.test(e.kind))
    .sort((a,b) => a.day - b.day);
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
    // Link the two defining lifecycle events to the real transaction that
    // produced them (verified hashes in provenance.json); other events link to
    // nothing rather than a guess.
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
    renderPulse(); renderMarket(); renderBoard(); renderPurse(); renderTimeline(); renderLog(); renderMine();
    renderModeNote();
  }catch(e){
    setBanner(`Cannot reach the town contract: ${esc(e.message)}. ` +
      `The server proxies to NEAR testnet — check it is running and the RPC is reachable.`);
    toast("State error: "+e.message, true);
  }
}

function busy(on){ document.querySelectorAll("button").forEach(b=>b.disabled=on); }

async function act(label, action, body, merchant){
  busy(true);
  try{
    const r = await api("POST", "/api/action/"+action, body);
    if(merchant) focusMerchant = merchant;
    toast(`${label} — tx ${r.hash.slice(0,14)}…`);
    await refresh();
  }catch(e){ toast(`${label} refused: ${e.message}`, true); }
  finally{ busy(false); }
}

// Fast-forward: the server signs each day as a separate real transaction and
// reports exactly how many succeeded. We never claim 7 if fewer landed.
let advancing = false;
async function fastForward(){
  if(advancing) return;
  advancing = true;
  const prog = document.getElementById("prog");
  const btn = document.getElementById("advance7");
  btn.disabled = true; prog.textContent = "advancing…";
  try{
    const r = await api("POST","/api/advance",{days:7});
    if(r.completed === r.requested){
      prog.textContent = `advanced ${r.completed} days → day ${r.day}`;
      toast(`Fast-forwarded ${r.completed} days`);
    } else {
      prog.textContent = `advanced ${r.completed} of ${r.requested} days (stopped: ${(r.failed&&r.failed[0]&&r.failed[0].error)||"error"})`;
      toast(`Advanced only ${r.completed}/${r.requested} days`, true);
    }
    await refresh();
  }catch(e){
    prog.textContent = "fast-forward failed: " + e.message;
    toast("Fast-forward failed: "+e.message, true);
  } finally {
    advancing = false; btn.disabled = false;
  }
}

document.addEventListener("click", async (ev)=>{
  if(ev.target.id === "clear-focus"){ ev.preventDefault(); focusMerchant = null; renderMine(); return; }
  const b = ev.target.closest("button"); if(!b) return;
  if(b.id==="advance") return act("Day advanced","tick",{});
  if(b.id==="advance7") return fastForward();
  if(b.dataset.gather) return act(`Gathered ${b.dataset.gather}`,"gather",{good:b.dataset.gather,units:5});
  if(b.dataset.buy){
    const id=b.dataset.buy, units=Number(document.getElementById("u-"+id).value)||1;
    const m=state.merchants.find(x=>x.id===id);
    return act(`Bought ${units} ${m.specialty} from ${m.name}`,"buy",{merchant:id,good:m.specialty,units},id);
  }
  if(b.dataset.sell){
    const id=b.dataset.sell, units=Number(document.getElementById("u-"+id).value)||1;
    const m=state.merchants.find(x=>x.id===id);
    return act(`Sold ${units} ${m.specialty} to ${m.name}`,"sell",{merchant:id,good:m.specialty,units},id);
  }
  if(b.dataset.invest){
    const id=b.dataset.invest;
    const amount=Number(document.getElementById("u-"+id).value)||200;
    return act(`Invested ${amount} in ${id}`,"invest",{merchant:id,amount},id);
  }
});

loadProvenance();
refresh();
setInterval(refresh, 6000);
