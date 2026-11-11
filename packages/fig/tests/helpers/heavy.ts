// Heavy tests parse large fixtures, or one fixture more than once, and run only when
// BUN_HEAVY_TESTS is true, which the unit test runner sets while giving each heavy file its own
// process (`tools/dev/unit-tests/src/shards.ts`).
export const runsHeavyTests = ['1', 't', 'true'].includes(
  (process.env.BUN_HEAVY_TESTS ?? '').trim().toLowerCase()
)

/** Bounded by how fast the fixture parses, which on a loaded machine is well past the default. */
export const HEAVY_TEST_TIMEOUT_MS = 30_000
