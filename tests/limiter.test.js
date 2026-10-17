const test = require('node:test');
const assert = require('node:assert');
const { createLimiter } = require('../server/utils/limiter');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('never runs more than the configured number of jobs at once', async () => {
  const run = createLimiter(3);
  let active = 0;
  let peak = 0;
  const jobs = [];
  for (let i = 0; i < 12; i++) {
    jobs.push(run(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await sleep(15);
      active -= 1;
      return i;
    }));
  }
  const results = await Promise.all(jobs);
  assert.strictEqual(peak, 3, `peak concurrency was ${peak}`);
  assert.deepStrictEqual(results, [...Array(12).keys()]);
  assert.deepStrictEqual(run.stats(), { active: 0, queued: 0, limit: 3 });
});

test('runs queued jobs in FIFO order', async () => {
  const run = createLimiter(1);
  const order = [];
  await Promise.all([1, 2, 3, 4].map((n) => run(async () => {
    order.push(n);
    await sleep(5);
  })));
  assert.deepStrictEqual(order, [1, 2, 3, 4]);
});

test('a failing job rejects its caller without stalling the queue', async () => {
  const run = createLimiter(2);
  const bad = run(async () => { throw new Error('boom'); });
  const good = run(async () => 'ok');
  await assert.rejects(bad, /boom/);
  assert.strictEqual(await good, 'ok');
  assert.strictEqual(run.stats().active, 0);
});

test('degenerate limits are clamped to at least one', async () => {
  assert.strictEqual(createLimiter(0).stats().limit, 1);
  assert.strictEqual(createLimiter(undefined).stats().limit, 1);
  assert.strictEqual(createLimiter('4').stats().limit, 4);
});

test('frees the slot when a job resolves synchronously', async () => {
  const run = createLimiter(1);
  const out = await Promise.all([run(async () => 'a'), run(async () => 'b')]);
  assert.deepStrictEqual(out, ['a', 'b']);
  assert.strictEqual(run.stats().queued, 0);
});
