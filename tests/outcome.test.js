// Unit tests for failed-execution detection. No network, no chain.
// Run: npm run test:agent
import { test } from "node:test";
import assert from "node:assert/strict";
import { executionFailure } from "../driver/near.js";

test("a success outcome has no failure reason", () => {
  assert.equal(executionFailure({ status: { SuccessValue: "" } }), null);
  assert.equal(executionFailure({ status: {} }), null);
  assert.equal(executionFailure({}), null);
  assert.equal(executionFailure(null), null);
});

test("a contract panic is surfaced as a plain-language reason", () => {
  const outcome = {
    status: {
      Failure: {
        ActionError: {
          index: 0,
          kind: {
            FunctionCallError: {
              ExecutionError: "Smart contract panicked: gather 1..=50 per call",
            },
          },
        },
      },
    },
  };
  assert.equal(executionFailure(outcome), "gather 1..=50 per call");
});

test("a compilation error is surfaced too", () => {
  const outcome = {
    status: {
      Failure: {
        ActionError: {
          index: 0,
          kind: { FunctionCallError: { CompilationError: "nope" } },
        },
      },
    },
  };
  assert.equal(executionFailure(outcome), "nope");
});

test("an unrecognised failure shape is never reported as success", () => {
  const reason = executionFailure({ status: { Failure: { weird: true } } });
  assert.equal(typeof reason, "string");
  assert.ok(reason.length > 0);
});
