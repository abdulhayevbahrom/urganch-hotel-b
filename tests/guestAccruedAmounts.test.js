const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getAccruedStayDays,
  getAccruedGuestAmounts,
  getGuestPayableAmount,
  buildContinuedGuestState,
  getCompletedStayDays,
} = require("../controllers/guest.controller");

const guest = {
  status: "active",
  checkInAt: "2026-08-17T17:17:00+05:00",
  checkoutDueAt: "2026-08-29T12:00:00+05:00",
  stayDays: 12,
  dailyRate: 260000,
  paidAmount: 0,
  vip: false,
  services: [],
};

test("active guest total uses elapsed stay days instead of planned stay days", () => {
  const now = new Date("2026-08-25T13:00:00+05:00");

  assert.equal(getAccruedStayDays(guest, now), 9);
  assert.deepEqual(getAccruedGuestAmounts(guest, now), {
    accruedStayDays: 9,
    totalAmount: 2340000,
    debtAmount: 2340000,
  });
});

test("payments reduce accrued debt and services remain included", () => {
  const now = new Date("2026-08-25T13:00:00+05:00");
  const result = getAccruedGuestAmounts(
    {
      ...guest,
      paidAmount: 1000000,
      services: [{ totalAmount: 150000 }],
    },
    now,
  );

  assert.deepEqual(result, {
    accruedStayDays: 9,
    totalAmount: 2490000,
    debtAmount: 1490000,
  });
});

test("individual stay-day prices are included in the accrued total", () => {
  const result = getAccruedGuestAmounts(
    {
      ...guest,
      stayDays: 3,
      checkoutDueAt: "2026-08-20T12:00:00+05:00",
      dailyRates: [
        { day: 1, amount: 200000 },
        { day: 2, amount: 200000 },
        { day: 3, amount: 340000 },
      ],
    },
    new Date("2026-08-19T13:00:00+05:00"),
  );

  assert.equal(result.accruedStayDays, 3);
  assert.equal(result.totalAmount, 740000);
  assert.equal(result.debtAmount, 740000);
});

test("accrued days do not exceed the planned stay before checkout", () => {
  const now = new Date("2026-08-29T12:00:00+05:00");

  assert.equal(getAccruedStayDays(guest, now), 12);
});

test("guest can prepay the full planned stay while current debt stays accrued", () => {
  const sixDayGuest = {
    ...guest,
    stayDays: 6,
    dailyRate: 260000,
    totalAmount: 1560000,
    paidAmount: 0,
    checkoutDueAt: "2026-08-23T12:00:00+05:00",
  };

  assert.equal(getGuestPayableAmount(sixDayGuest), 1560000);
});

test("continuing a checked-out guest preserves one history and extends checkout", () => {
  const continued = buildContinuedGuestState({
    guest: {
      checkInAt: new Date(2026, 7, 26, 12, 35),
      stayDays: 1,
      dailyRate: 300000,
      paidAmount: 300000,
      vip: false,
      services: [],
    },
    additionalDays: 1,
    now: new Date(2026, 7, 27, 12, 0, 45),
    hotelSettings: { checkoutTime: "12:00", reminderTime: "11:00" },
  });

  assert.equal(continued.stayDays, 2);
  assert.equal(continued.billableDays, 2);
  assert.equal(continued.checkoutDueAt.getDate(), 28);
  assert.equal(continued.checkoutDueAt.getHours(), 12);
  assert.equal(continued.totalAmount, 600000);
  assert.equal(continued.debtAmount, 300000);
});

test("continuation at noon starts day two for a guest who arrived before noon", () => {
  const preNoonGuest = {
    checkInAt: new Date(2026, 7, 26, 1, 45),
    checkoutDueAt: new Date(2026, 7, 27, 12, 0),
    stayDays: 2,
  };

  assert.equal(
    getAccruedStayDays(preNoonGuest, new Date(2026, 7, 26, 12, 0, 45)),
    2,
  );
});

test("edited checkout date recalculates completed hotel days", () => {
  assert.equal(
    getCompletedStayDays(
      new Date(2026, 7, 26, 1, 45),
      new Date(2026, 7, 26, 12, 0),
      "12:00",
    ),
    1,
  );
  assert.equal(
    getCompletedStayDays(
      new Date(2026, 7, 26, 1, 45),
      new Date(2026, 7, 27, 12, 0),
      "12:00",
    ),
    2,
  );
});
