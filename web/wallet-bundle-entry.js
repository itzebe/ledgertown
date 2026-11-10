// Entry point for the committed browser wallet bundle.
// Re-exported explicitly (not `export *`) because the source is CommonJS and
// the ESM interop only forwards statically-named exports.
export {
  connect,
  keyStores,
  utils,
  transactions,
  providers,
  WalletConnection,
  KeyPair,
  Contract,
  Account,
} from "near-api-js";
