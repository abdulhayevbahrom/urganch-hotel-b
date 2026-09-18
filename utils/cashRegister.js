const CashTransaction = require("../model/CashTransaction");

const buildCashActor = (user = {}) => ({
  userId: String(user.id || ""),
  role: String(user.role || ""),
  login: String(user.login || ""),
  firstname: String(user.firstname || ""),
  lastname: String(user.lastname || ""),
});

const isCashierUser = (user = {}) =>
  String(user.role || "").toLowerCase().trim() === "kassir";

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
  session = null,
}) => {
  if (!user?.id || !isCashierUser(user)) return null;
  const payload = {
    sourceType,
    sourceId,
    sourcePaymentIndex,
    title: String(title || "").trim() || "To'lov",
    amount: Number(amount || 0),
    paymentType: String(paymentType || "naqd"),
    paidAt,
    note: String(note || "").trim(),
    cashier: buildCashActor(user),
  };

  if (sourcePaymentIndex === null || sourcePaymentIndex === undefined) {
    const docs = await CashTransaction.create([payload], { session });
    return docs[0];
  }

  return CashTransaction.findOneAndUpdate(
    { sourceType, sourceId, sourcePaymentIndex },
    { $setOnInsert: payload },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true, session },
  );
};

const updateCashTransaction = async ({
  sourceType,
  sourceId,
  sourcePaymentIndex,
  amount,
  paymentType,
  paidAt,
  note,
  session = null,
}) => {
  const transaction = await CashTransaction.findOne({
    sourceType,
    sourceId,
    sourcePaymentIndex,
  }).session(session);
  if (!transaction) return null;
  if (transaction.status !== "open") {
    const error = new Error("Topshirilgan yoki tasdiqlangan to'lovni o'zgartirib bo'lmaydi");
    error.code = "CASH_TRANSACTION_LOCKED";
    throw error;
  }
  transaction.amount = Number(amount || 0);
  transaction.paymentType = String(paymentType || "naqd");
  if (paidAt) transaction.paidAt = paidAt;
  transaction.note = String(note || "").trim();
  await transaction.save({ session });
  return transaction;
};

module.exports = {
  buildCashActor,
  isCashierUser,
  recordCashTransaction,
  updateCashTransaction,
};
