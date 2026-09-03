const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getStayDayForDate,
  getTodayExpectedBilling,
} = require("../controllers/dashboard.controller");

test("dashboard expected billing uses the current hotel stay day", () => {
  const settings = { checkinTime: "09:00", checkoutTime: "12:00" };
  const targetAt = new Date("2026-09-03T23:00:00+05:00");
  const guests = [
    {
      status: "active",
      vip: false,
      checkInAt: "2026-09-03T18:21:18+05:00",
      stayDays: 1,
      dailyRate: 600000,
      dailyRates: [],
      payments: [],
    },
    {
      status: "active",
      vip: false,
      checkInAt: "2026-09-02T13:08:15+05:00",
      stayDays: 2,
      dailyRate: 400000,
      dailyRates: [],
      payments: [],
    },
    {
      status: "active",
      vip: false,
      checkInAt: "2026-09-03T16:08:15+05:00",
      stayDays: 1,
      dailyRate: 380000,
      dailyRates: [],
      payments: [{ amount: 380000, type: "naqd", createdAt: "2026-09-03T16:10:00+05:00" }],
    },
  ];

  assert.equal(
    getStayDayForDate(guests[1].checkInAt, targetAt, "12:00", "09:00"),
    2,
  );
  assert.deepEqual(getTodayExpectedBilling(guests, targetAt, settings), {
    expected: 1380000,
    paid: 380000,
  });
});
