const test = require("node:test");
const assert = require("node:assert/strict");
const { summarizeTransactions } = require("../controllers/cash.controller");
const { isCashierUser } = require("../utils/cashRegister");

test("cash summary separates payment types and total", () => {
  assert.deepEqual(
    summarizeTransactions([
      { amount: 100000, paymentType: "naqd" },
      { amount: 250000, paymentType: "karta" },
      { amount: 125000, paymentType: "click" },
      { amount: 300000, paymentType: "bank" },
      { amount: 50000, paymentType: "naqd" },
    ]),
    {
      naqd: 150000,
      karta: 250000,
      click: 125000,
      bank: 300000,
      total: 825000,
    },
  );
});

test("only kassir profile is treated as a cash collector", () => {
  assert.equal(isCashierUser({ role: "kassir" }), true);
  assert.equal(isCashierUser({ role: " KASSIR " }), true);
  assert.equal(isCashierUser({ role: "owner" }), false);
  assert.equal(isCashierUser({ role: "admin" }), false);
  assert.equal(isCashierUser({ role: "administrator" }), false);
  assert.equal(isCashierUser({}), false);
});
