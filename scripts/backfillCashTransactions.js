const mongoose = require("mongoose");
require("dotenv").config();

const Guest = require("../model/Guest");
const GroupBooking = require("../model/GroupBooking");
const HallBooking = require("../model/HallBooking");
const CashTransaction = require("../model/CashTransaction");
const { recordCashTransaction } = require("../utils/cashRegister");

const shouldApply = process.argv.includes("--apply");

const actorToUser = (actor = {}) => ({
  id: String(actor.userId || actor.id || ""),
  role: String(actor.role || ""),
  login: String(actor.login || ""),
  firstname: String(actor.firstname || ""),
  lastname: String(actor.lastname || ""),
});

const collectMissing = async () => {
  const [guests, groups, halls, existing] = await Promise.all([
    Guest.find({ group: null, "payments.0": { $exists: true } })
      .select("firstname lastname payments acceptedBy")
      .lean(),
    GroupBooking.find({ "payments.0": { $exists: true } })
      .select("name payments createdBy")
      .lean(),
    HallBooking.find({ "payments.0": { $exists: true } })
      .select("customerFirstname customerLastname eventName payments createdBy")
      .lean(),
    CashTransaction.find({ sourcePaymentIndex: { $type: "number" } })
      .select("sourceType sourceId sourcePaymentIndex")
      .lean(),
  ]);

  const existingKeys = new Set(
    existing.map(
      (item) => `${item.sourceType}:${item.sourceId}:${item.sourcePaymentIndex}`,
    ),
  );
  const missing = [];
  const addPayments = ({ sourceType, source, payments, title }) => {
    payments.forEach((payment, sourcePaymentIndex) => {
      const user = actorToUser(payment.receivedBy);
      if (String(user.role).toLowerCase().trim() !== "kassir") return;
      const key = `${sourceType}:${source._id}:${sourcePaymentIndex}`;
      if (existingKeys.has(key)) return;
      missing.push({
        user,
        sourceType,
        sourceId: source._id,
        sourcePaymentIndex,
        title,
        amount: Number(payment.amount || 0),
        paymentType: payment.type,
        paidAt: payment.createdAt,
        note: payment.note || "",
      });
    });
  };

  guests.forEach((guest) =>
    addPayments({
      sourceType: "guest",
      source: guest,
      payments: guest.payments || [],
      title: `${guest.firstname || ""} ${guest.lastname || ""}`.trim(),
    }),
  );
  groups.forEach((group) =>
    addPayments({
      sourceType: "group",
      source: group,
      payments: group.payments || [],
      title: `Guruh: ${group.name || "-"}`,
    }),
  );
  halls.forEach((hall) =>
    addPayments({
      sourceType: "hall",
      source: hall,
      payments: hall.payments || [],
      title: `Zal: ${`${hall.customerFirstname || ""} ${hall.customerLastname || ""}`.trim() || hall.eventName || "Ijara"}`,
    }),
  );
  return missing.filter((item) => item.user.id && item.amount > 0);
};

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  await CashTransaction.syncIndexes();
  const missing = await collectMissing();
  const totalAmount = missing.reduce((sum, item) => sum + item.amount, 0);
  console.log(
    JSON.stringify(
      { mode: shouldApply ? "apply" : "dry-run", count: missing.length, totalAmount },
      null,
      2,
    ),
  );
  if (shouldApply) {
    for (const item of missing) await recordCashTransaction(item);
    console.log(`Tiklandi: ${missing.length} ta kassa tranzaksiyasi`);
  }
  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error(error);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
