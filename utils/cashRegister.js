const CashTransaction = require("../model/CashTransaction");

const buildCashActor = (user = {}) => ({
  userId: String(user.id || ""),
  role: String(user.role || ""),
  login: String(user.login || ""),
  firstname: String(user.firstname || ""),
  lastname: String(user.lastname || ""),
});

const recordCashTransaction = async ({
  user,
  sourceType,
  sourceId,
  sourcePaymentIndex = null,
  title,
  amount,
  paymentType,
  paidAt = new Date(),
  note = "",
}) => {
  if (!user?.id) return null;
  return CashTransaction.create({
    sourceType,
    sourceId,
    sourcePaymentIndex,
    title: String(title || "").trim() || "To'lov",
    amount: Number(amount || 0),
    paymentType: String(paymentType || "naqd"),
    paidAt,
    note: String(note || "").trim(),
    cashier: buildCashActor(user),
  });
};

module.exports = {
  buildCashActor,
  recordCashTransaction,
};
