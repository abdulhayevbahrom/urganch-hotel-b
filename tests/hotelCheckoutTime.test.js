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

test("one-day guest arriving before check-in time leaves the same day", () => {
  const checkout = calculateCheckoutDueAt(
    new Date(2026, 7, 26, 8, 45),
    1,
    "12:00",
    "09:00",
  );

  assertLocalDateTime(checkout, {
    year: 2026,
    month: 8,
    day: 26,
    hour: 12,
    minute: 0,
  });
});

test("one-day guest arriving after check-in time leaves the next day", () => {
  const checkout = calculateCheckoutDueAt(
    new Date(2026, 7, 26, 9, 34),
    1,
    "12:00",
    "09:00",
  );

  assertLocalDateTime(checkout, {
    year: 2026,
    month: 8,
    day: 27,
    hour: 12,
    minute: 0,
  });
});

test("arrival exactly at check-in time starts a new hotel day", () => {
  const checkout = calculateCheckoutDueAt(
    new Date(2026, 7, 26, 9, 0),
    1,
    "12:00",
    "09:00",
  );

  assertLocalDateTime(checkout, {
    year: 2026,
    month: 8,
    day: 27,
    hour: 12,
    minute: 0,
  });
});

test("user example: 02.09.2026 09:34 to 03.09.2026 12:00 is one day", () => {
  const checkout = calculateCheckoutDueAt(
    new Date(2026, 8, 2, 9, 34),
    1,
    "12:00",
    "09:00",
  );

  assertLocalDateTime(checkout, {
    year: 2026,
    month: 9,
    day: 3,
    hour: 12,
    minute: 0,
  });
});
