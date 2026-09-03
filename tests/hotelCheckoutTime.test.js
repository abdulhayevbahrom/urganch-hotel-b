const test = require("node:test");
const assert = require("node:assert/strict");
const {
  calculateCheckoutDueAt,
} = require("../utils/hotelSettings");

const assertLocalDateTime = (date, expected) => {
  assert.deepEqual(
    {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hour: date.getHours(),
      minute: date.getMinutes(),
    },
    expected,
  );
};

test("one-day guest arriving before checkout leaves the same day", () => {
  const checkout = calculateCheckoutDueAt(
    new Date(2026, 7, 26, 1, 45),
    1,
    "12:00",
  );

  assertLocalDateTime(checkout, {
    year: 2026,
    month: 8,
    day: 26,
    hour: 12,
    minute: 0,
  });
});

test("one-day guest arriving after checkout leaves the next day", () => {
  const checkout = calculateCheckoutDueAt(
    new Date(2026, 7, 26, 12, 35),
    1,
    "12:00",
  );

  assertLocalDateTime(checkout, {
    year: 2026,
    month: 8,
    day: 27,
    hour: 12,
    minute: 0,
  });
});

test("arrival exactly at checkout time starts a new hotel day", () => {
  const checkout = calculateCheckoutDueAt(
    new Date(2026, 7, 26, 12, 0),
    1,
    "12:00",
  );

  assertLocalDateTime(checkout, {
    year: 2026,
    month: 8,
    day: 27,
    hour: 12,
    minute: 0,
  });
});
