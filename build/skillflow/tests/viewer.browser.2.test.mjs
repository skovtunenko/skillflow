// One of the processes that run viewer.browser.suite.mjs at once: file k runs every 4th test from the k-th.
// A machine with fewer than 8 cores runs the whole suite in file 1, so that four Chromes do not slow each other into timeouts.
import os from "node:os";
const SHARDS = os.availableParallelism() >= 8 ? 4 : 1, SHARD = Number(/\.(\d)\.test\.mjs$/.exec(import.meta.filename)[1]) - 1;
if (SHARD < SHARDS) { globalThis.skillflowShard = [SHARD, SHARDS]; await import("./viewer.browser.suite.mjs"); }
