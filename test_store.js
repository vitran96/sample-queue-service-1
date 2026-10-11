import assert from 'node:assert';
import {
  getConfig,
  getSnapshot,
  issueTicket,
  callNext,
  recall,
  markNoShow,
  requeue,
  getTicket,
  sim
} from './assets/store.js';

async function runTests() {
  console.log('Running store self-tests...');
  sim.clearAll();
  sim.set({ latencyMs: 0, serviceDown: false });

  // 1. Initial empty state
  let snap = getSnapshot();
  assert.strictEqual(snap.counts.total, 0, 'Initial total should be 0');
  assert.strictEqual(snap.current, null, 'Initial current should be null');

  // 2. Issue tickets in sequence
  const t1 = await issueTicket();
  assert.strictEqual(t1.no, 'A001', 'First ticket should be A001');
  assert.strictEqual(t1.ahead, 0, 'First ticket ahead should be 0');

  const t2 = await issueTicket();
  assert.strictEqual(t2.no, 'A002', 'Second ticket should be A002');
  assert.strictEqual(t2.ahead, 1, 'Second ticket ahead should be 1');

  const t3 = await issueTicket();
  assert.strictEqual(t3.no, 'A003');

  // 3. getTicket
  const gt2 = getTicket(t2.token);
  assert.strictEqual(gt2.ticket.no, 'A002');
  assert.strictEqual(gt2.ahead, 1);

  // 4. Call next
  snap = await callNext();
  assert.strictEqual(snap.current.no, 'A001', 'Called A001');
  assert.strictEqual(snap.current.calls, 1);
  assert.strictEqual(snap.waiting.length, 2);

  // 5. Recall
  snap = await recall();
  assert.strictEqual(snap.current.calls, 2, 'Recall bumps calls to 2');

  // 6. Mark no-show
  snap = await markNoShow();
  assert.strictEqual(snap.current, null, 'Current cleared after no-show');
  assert.strictEqual(snap.counts.noshow, 1);

  // 7. Call next (calls A002)
  snap = await callNext();
  assert.strictEqual(snap.current.no, 'A002');

  // 8. Requeue A001 to front of queue
  snap = await requeue(t1.token);
  assert.strictEqual(snap.waiting[0].no, 'A001', 'Requeued A001 should be front of waiting queue');

  // 9. Call next again (should be A001 because it was requeued to index 0, A002 gets served)
  snap = await callNext();
  assert.strictEqual(snap.current.no, 'A001', 'A001 called again from front');
  assert.strictEqual(snap.counts.served, 1, 'A002 is now served');

  // 10. Service down rejection
  sim.set({ serviceDown: true });
  await assert.rejects(async () => {
    await issueTicket();
  }, /ServiceUnavailable/);
  sim.set({ serviceDown: false });

  // 11. Daily reset verification
  // Advance simulated clock by 25 hours
  sim.set({ clockOffsetMs: 25 * 3600 * 1000 });
  snap = getSnapshot();
  assert.strictEqual(snap.counts.waiting, 0, 'New day waiting count reset');
  assert.strictEqual(snap.current, null, 'New day current reset');
  const oldTicketCheck = getTicket(t1.token);
  assert.strictEqual(oldTicketCheck, null, 'Old ticket not accessible in new day');

  const newDayT1 = await issueTicket();
  assert.strictEqual(newDayT1.no, 'A001', 'Numbers restart at A001 on new day');

  sim.clearAll();
  console.log('✓ All store self-tests passed.');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
