const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const mongoose = require("mongoose");
require("dotenv").config();

const CashTransaction = require("../model/CashTransaction");
const CashClosure = require("../model/CashClosure");

const shouldApply = process.argv.includes("--apply");

const getSnapshot = async () => {
  const [transactions, closures, totals] = await Promise.all([
    CashTransaction.find({}).sort({ createdAt: 1 }).lean(),
    CashClosure.find({}).sort({ createdAt: 1 }).lean(),
    CashTransaction.aggregate([
      {
        $group: {
          _id: null,
          totalAmount: { $sum: "$amount" },
          openAmount: {
            $sum: { $cond: [{ $eq: ["$status", "open"] }, "$amount", 0] },
          },
        },
      },
    ]),
  ]);
  return {
    transactions,
    closures,
    summary: {
      transactionCount: transactions.length,
      closureCount: closures.length,
      totalAmount: Number(totals[0]?.totalAmount || 0),
      openAmount: Number(totals[0]?.openAmount || 0),
    },
  };
};

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  const snapshot = await getSnapshot();

  console.log(
    JSON.stringify(
      {
        mode: shouldApply ? "apply" : "dry-run",
        ...snapshot.summary,
      },
      null,
      2,
    ),
  );

  if (shouldApply) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(
      os.tmpdir(),
      `tinchlik-hotel-cash-backup-${timestamp}.json`,
    );
    await fs.writeFile(backupPath, JSON.stringify(snapshot, null, 2), "utf8");

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await CashTransaction.deleteMany({}, { session });
        await CashClosure.deleteMany({}, { session });
      });
    } finally {
      await session.endSession();
    }

    const remaining = await getSnapshot();
    console.log(
      JSON.stringify(
        {
          backupPath,
          remaining: remaining.summary,
        },
        null,
        2,
      ),
    );
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
