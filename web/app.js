// Ledgertown UI. Served as an external file so the page can use a strict
// Content-Security-Policy without 'unsafe-inline' for scripts.
const EXPLORER = "https://testnet.nearblocks.io/txns/";
let state = null;
let prevMerchants = null;   // previous day's snapshot, for day-over-day deltas
let lastDay = null;
let focusMerchant = null;   // merchant whose transactions the player last acted on

function toast(msg, err){
  const t = document.getElementById("toast");
  t.textContent = msg; t.className = "toast show" + (err ? " err" : "");
  clearTimeout(t._h); t._h = setTimeout(()=>{ t.className="toast"; }, 4200);
}
function money(n){ return (n??0).toLocaleString(); }

// Persistent, actionable error banner (distinct from the transient toast).
function setBanner(msg){
  const el = document.getElementById("banner-slot");
  if(!msg){ el.innerHTML = ""; return; }
  el.innerHTML = `<div class="banner" role="alert">${msg}</div>`;
}

// Delta since the previous day: the "what changed since yesterday" signal.
function delta(cur, prev){
  if(prev == null || cur == null) return "";
  const d = cur - prev;
  if(d === 0) return `<span class="delta flat">·</span>`;
  const cls = d > 0 ? "up" : "down";
  return `<span class="delta ${cls}">${d>0?"▲":"▼"}${Math.abs(d)}</span>`;
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

function prevOf(id){
  return prevMerchants ? prevMerchants.find(p => p.id === id) : null;
}

// Plain-language rendering of the contract's real last_decision. The server
// already translated it (state.merchants[].decision); we never invent reasoning.
function decisionBlock(m){
  const d = m.decision || {status:"none", plain:"No agent decision recorded yet."};
  const tag = d.status === "accepted" ? "accepted"
            : d.status === "rejected" ? "rejected"
            : d.status === "recorded" ? "recorded" : "no decision";
  return `<div class="decision ${d.status}"><span class="tag">${tag}</span>${d.plain}</div>`;
}

function renderModeNote(){
  if(state.canAct){ setBanner(""); return; }
  document.getElementById("banner-slot").innerHTML = `<div class="mode-note"><b>Read-only preview.</b> This deployment serves live NEAR testnet state without holding any signing keys, so the trade buttons are disabled here. The state, the ledger and every explorer link below are real. To play, run the server in play mode with a demo key (see the README).</div>`;
  // Read-only: no signing, so no action button can work. Disable them honestly
  // instead of letting a click fail silently.
  document.querySelectorAll(".gather, #advance, #advance7").forEach(b=>{
    b.disabled = true; b.title = "Read-only deployment — actions are disabled here";
  });
}

function renderStalls(){
  const el = document.getElementById("stalls");
  el.innerHTML = "";
  for(const m of state.merchants){
    const good = m.specialty;
    const inv = m.inventory?.[good] ?? 0;
    const list = m.list_price?.[good];
    const bid = m.bid_price?.[good];
    const p = prevOf(m.id);
    const pInv = p ? (p.inventory?.[good] ?? 0) : null;
    const pList = p ? (p.list_price?.[good] ?? null) : null;
    const pCash = p ? p.cash : null;
    const closed = m.state === "closed";
    const ro = state.canAct ? "" : "disabled";
    // Contextual actions: a closed shop can only be revived; an open shop trades.
    const actions = closed
      ? `<div class="actions">
           <span class="cap" style="align-self:center">Revive</span>
           <input type="number" value="200" min="1" id="u-${m.id}" />
           <button class="primary" data-invest="${m.id}" ${ro}>Invest to reopen</button>
         </div>`
      : `<div class="actions">
           <span class="cap" style="align-self:center">units</span>
           <input type="number" value="1" min="1" id="u-${m.id}" />
           <button data-buy="${m.id}" ${ro}>Buy ${good}</button>
           <button data-sell="${m.id}" ${ro}>Sell ${good}</button>
         </div>`;
    const stall = document.createElement("div");
    stall.className = "stall";
    stall.innerHTML = `
      <div class="who">
        <div class="nm">${m.name}${m.reopened_count ? `<span class="recovered" title="Times revived by investment">revived ×${m.reopened_count}</span>` : ""}</div>
        <div class="sp">${good}</div>
        <div class="acct">${m.account}</div>
      </div>
      <div>
        <div class="figs">
          <div class="fig"><div class="k">Cash</div><div class="v num">${money(m.cash)}${delta(m.cash, pCash)}</div></div>
          <div class="fig"><div class="k">Stock</div><div class="v num">${inv}${delta(inv, pInv)}</div></div>
          <div class="fig"><div class="k">Sells at</div><div class="v num">${list==null?"—":list}${list!=null?delta(list,pList):""}</div></div>
          <div class="fig"><div class="k">Buys at</div><div class="v num">${bid==null?"—":bid}</div></div>
          <div class="fig"><div class="k">State</div><div class="v"><span class="state ${m.state}">${m.state}</span></div></div>
        </div>
          ${decisionBlock(m)}
        ${actions}
      </div>`;
    el.appendChild(stall);
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

function renderLog(){
  const el = document.getElementById("log");
  const evs = [...(state.events||[])].reverse();
  el.innerHTML = evs.length ? "" : '<div class="ev"><div class="day">—</div><div class="muted">No events yet.</div></div>';
  for(const e of evs){
    const div = document.createElement("div");
    div.className = "ev" + (e.day === state.day ? " today" : "");
    div.innerHTML = `
      <div class="day num">d${e.day}</div>
      <div>
        <div><span class="kind">${e.kind}</span> · ${e.merchant} · <span class="num">${e.value}</span></div>
        <div class="muted">${e.note||""}</div>
      </div>`;
    el.appendChild(div);
  }
}

function renderMine(){
  const el = document.getElementById("mine");
  const all = state.recentTxs || [];
  const txs = focusMerchant ? all.filter(t => t.merchant === focusMerchant) : all;
  const head = focusMerchant
    ? `<div class="ev"><div class="day">—</div><div class="muted">Showing ${focusMerchant}. <a href="#" id="clear-focus">Show all</a></div></div>`
    : "";
  el.innerHTML = head + (txs.length ? "" : '<div class="ev"><div class="day">—</div><div class="muted">No transactions yet — take an action above.</div></div>');
  for(const t of txs){
    const div = document.createElement("div");
    div.className = "ev";
    div.innerHTML = `
      <div class="day num">${new Date(t.at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</div>
      <div>
        <div><span class="kind">${t.label}</span>${t.merchant?` · ${t.merchant}`:""}</div>
        <div class="tx">tx <a target="_blank" rel="noopener" href="${EXPLORER}${t.hash}">${t.hash}</a></div>
      </div>`;
    el.appendChild(div);
  }
}

async function refresh(){
  try{
    const next = await api("GET","/api/state");
    // Track the previous day's merchant snapshot for day-over-day deltas.
    if(lastDay !== null && next.day !== lastDay && state){
      prevMerchants = state.merchants;
    }
    lastDay = next.day;
    state = next;
    document.getElementById("day").textContent = state.day;
    document.getElementById("contract").textContent = state.contract;
    renderStalls(); renderPurse(); renderLog(); renderMine();
    renderModeNote();
  }catch(e){
    setBanner(`Cannot reach the town contract: ${e.message}. ` +
      `The local play server proxies to NEAR testnet — check it is running and the RPC is reachable.`);
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

refresh();
setInterval(refresh, 6000);
