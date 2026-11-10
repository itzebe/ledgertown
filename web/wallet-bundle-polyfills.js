// Polyfills injected into the wallet bundle. near-api-js reads `Buffer` and
// `process` at module load; a browser has neither. These are the only two
// globals we add — nothing else is shimmed.
import { Buffer } from "buffer";
import process from "process";

export { Buffer, process };
