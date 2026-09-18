const test = require("node:test");
const assert = require("node:assert/strict");
const moment = require("moment-timezone");
const {
  calculateDailyGuestBalance,
  getDailyReportRange,
  getDailyActiveGuestFilter,
} = require("../controllers/reports.controller");

const timezone = process.env.APP_TIMEZONE || "Asia/Tashkent";
const reportDay = moment.tz("2026-08-24", "YYYY-MM-DD", timezone);
const dayStart = reportDay.clone().hour(12).toDate();
const nextDayStart = reportDay.clone().add(1, "day").hour(12).toDate();

const calculate = (checkInAt, payments = []) => calculateDailyGuestBalance({
  guest: { checkInAt, payments },
  reportDay,
  dayStart,
  nextDayStart,
  dailyRate: 300000,
});

test("new guest starts with zero and carries today's unpaid rate as debt", () => {
  const result = calculate("2026-08-24T13:00:00+05:00");

  assert.deepEqual(result.opening, { prepayment: 0, debt: 0 });
  assert.deepEqual(result.closing, { prepayment: 0, debt: 300000 });
});

test("only payments made during the report day appear in payment columns", () => {
  const result = calculate("2026-08-24T13:00:00+05:00", [
    { amount: 500000, type: "naqd", createdAt: "2026-08-24T14:00:00+05:00" },
  ]);

  assert.equal(result.payments.cash, 500000);
  assert.deepEqual(result.closing, { prepayment: 200000, debt: 0 });
});

test("returning guest opening and closing balances include prior days", () => {
  const result = calculate("2026-08-22T13:00:00+05:00", [
    { amount: 400000, type: "naqd", createdAt: "2026-08-22T13:30:00+05:00" },
    { amount: 250000, type: "karta", createdAt: "2026-08-24T16:00:00+05:00" },
  ]);

  assert.deepEqual(result.opening, { prepayment: 0, debt: 200000 });
  assert.equal(result.payments.card, 250000);
  assert.deepEqual(result.closing, { prepayment: 0, debt: 250000 });
});

test("Click payments have their own daily report column", () => {
  const result = calculate("2026-08-24T13:00:00+05:00", [
    { amount: 350000, type: "click", createdAt: "2026-08-24T15:00:00+05:00" },
  ]);

  assert.equal(result.payments.click, 350000);
  assert.equal(result.payments.card, 0);
  assert.deepEqual(result.closing, { prepayment: 50000, debt: 0 });
});

test("unused old payment is carried as opening and closing prepayment", () => {
  const result = calculate("2026-08-23T13:00:00+05:00", [
    { amount: 700000, type: "naqd", createdAt: "2026-08-23T14:00:00+05:00" },
  ]);

  assert.deepEqual(result.opening, { prepayment: 400000, debt: 0 });
  assert.deepEqual(result.closing, { prepayment: 100000, debt: 0 });
});

test("payments after the report cutoff are excluded", () => {
  const result = calculate("2026-08-24T13:00:00+05:00", [
    { amount: 300000, type: "bank", createdAt: "2026-08-25T12:00:00+05:00" },
  ]);

  assert.equal(result.payments.transfer, 0);
  assert.deepEqual(result.closing, { prepayment: 0, debt: 300000 });
});

test("checkout exactly at operational day start belongs to the previous day", () => {
  const filter = getDailyActiveGuestFilter({ dayStart, nextDayStart });

  assert.deepEqual(filter, {
    checkInAt: { $lt: nextDayStart },
    $or: [
      { status: "active" },
      { status: "checked_out", checkOutAt: { $gt: dayStart } },
    ],
  });
});

test("expense daily report uses the same operational day as guests", () => {
  const expenseReportDay = moment.tz("2026-09-06", "YYYY-MM-DD", timezone);
  const range = getDailyReportRange(expenseReportDay, "09:30", "14:15");
  const beforeCheckInBoundary = new Date("2026-09-06T09:29:59+05:00");
  const afterCheckInBoundary = new Date("2026-09-06T09:30:00+05:00");
  const beforeCheckoutBoundary = new Date("2026-09-07T14:14:59+05:00");
  const atCheckoutBoundary = new Date("2026-09-07T14:15:00+05:00");

  assert.equal(beforeCheckInBoundary >= range.start, false);
  assert.equal(afterCheckInBoundary >= range.start, true);
  assert.equal(beforeCheckoutBoundary < range.end, true);
  assert.equal(atCheckoutBoundary < range.end, false);
});
