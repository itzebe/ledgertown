// Top up any Ledgertown account with free testnet NEAR via a throwaway faucet
// account. Used only to give the player/market funds to deposit or spend.
//
//   node scripts/fund.js <accountId> <nearAmount>
import { connectTown, faucetFund } from "../driver/near.js";

const target = process.argv[2];
const amount = process.argv[3] || "10";

async function main() {
  if (!target) throw new Error("usage: node scripts/fund.js <accountId> <near>");
  const near = await connectTown();
  const t = await faucetFund(near, target, amount);
  console.log(`sent ${amount} NEAR to ${target}  tx ${t.transaction_outcome.id}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
