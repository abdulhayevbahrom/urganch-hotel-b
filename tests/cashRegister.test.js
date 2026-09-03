const test = require("node:test");
const assert = require("node:assert/strict");
const { summarizeTransactions } = require("../controllers/cash.controller");

test("cash summary separates payment types and total", () => {
  assert.deepEqual(
    summarizeTransactions([
      { amount: 100000, paymentType: "naqd" },
      { amount: 250000, paymentType: "karta" },
      { amount: 300000, paymentType: "bank" },
      { amount: 50000, paymentType: "naqd" },
    ]),
    {
      naqd: 150000,
      karta: 250000,
      bank: 300000,
      total: 700000,
    },
  );
});
