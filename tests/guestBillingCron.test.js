const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getAutomaticCheckoutAt,
  getAutomaticCheckoutWindow,
} = require("../jobs/guestBilling.cron");

test("delayed cron execution keeps the scheduled checkout timestamp", () => {
  const checkoutAt = getAutomaticCheckoutAt(
    new Date("2026-08-26T12:00:00+05:00"),
    new Date("2026-08-26T12:00:45+05:00"),
  );

  assert.equal(checkoutAt.toISOString(), "2026-08-26T07:00:00.000Z");
});

test("automatic checkout opens one minute before configured checkout time", () => {
  const window = getAutomaticCheckoutWindow(
    new Date("2026-08-26T11:59:20+05:00"),
    "12:00",
  );

  assert.equal(window.isEarlyMinute, true);
  assert.equal(window.isExactMinute, false);
  assert.equal(window.cutoffAt.toISOString(), "2026-08-26T07:00:00.000Z");
  assert.equal(window.key, "2026-08-26-12:00");
});

test("automatic checkout keeps an exact-time fallback", () => {
  const window = getAutomaticCheckoutWindow(
    new Date("2026-08-26T12:00:20+05:00"),
    "12:00",
  );

  assert.equal(window.isEarlyMinute, false);
  assert.equal(window.isExactMinute, true);
  assert.equal(window.key, "2026-08-26-12:00");
});

test("automatic checkout does not run two minutes early", () => {
  const window = getAutomaticCheckoutWindow(
    new Date("2026-08-26T11:58:59+05:00"),
    "12:00",
  );

  assert.equal(window.isEarlyMinute, false);
  assert.equal(window.isExactMinute, false);
});

test("automatic checkout catches up when the entire checkout minute was missed", () => {
  const window = getAutomaticCheckoutWindow(
    new Date("2026-08-26T12:01:10+05:00"),
    "12:00",
  );

  assert.equal(window.isEarlyMinute, false);
  assert.equal(window.isExactMinute, false);
  assert.equal(window.isDueOrPast, true);
  assert.equal(window.key, "2026-08-26-12:00");
});
