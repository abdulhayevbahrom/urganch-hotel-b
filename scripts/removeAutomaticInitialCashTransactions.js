const mongoose = require("mongoose");
require("dotenv").config();

const CashTransaction = require("../model/CashTransaction");

const shouldApply = process.argv.includes("--apply");

const automaticInitialPaymentFilter = {
  status: "open",
  sourcePaymentIndex: 0,
  $or: [
    {
      sourceType: "guest",
      note: "Qabul qilish paytidagi to'lov",
    },
    {
      sourceType: "hall",
      note: { $in: ["Oldindan to'lov", "Oldindan to'lov (zakalad)"] },
    },
  ],
};

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);

  const candidates = await CashTransaction.find(automaticInitialPaymentFilter)
    .select("sourceType sourceId sourcePaymentIndex title amount cashier paidAt note")
    .lean();
  const totalAmount = candidates.reduce(
    (sum, item) => sum + Number(item.amount || 0),
    0,
  );

  console.log(
    JSON.stringify(
      {
        mode: shouldApply ? "apply" : "dry-run",
        count: candidates.length,
        totalAmount,
      },
      null,
      2,
    ),
  );

  if (shouldApply && candidates.length) {
    const result = await CashTransaction.deleteMany({
      _id: { $in: candidates.map((item) => item._id) },
    });
    console.log(`Olib tashlandi: ${result.deletedCount} ta avtomatik boshlang'ich kassa yozuvi`);
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
