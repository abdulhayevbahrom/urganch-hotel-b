const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const connectDB = require("../config/dbConfig");
const Room = require("../model/Room");
const Guest = require("../model/Guest");

const syncRoomOccupancy = async () => {
  const [rooms, activeCounts] = await Promise.all([
    Room.find({}).select("_id capacity status activeGuestsCount").lean(),
    Guest.aggregate([
      {
        $match: {
          status: "active",
          room: { $exists: true, $ne: null },
        },
      },
      {
        $group: {
          _id: "$room",
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const activeMap = new Map(
    activeCounts.map((item) => [String(item?._id || ""), Number(item?.count || 0)]),
  );

  const ops = [];
  for (const room of rooms) {
    const activeCount = Number(activeMap.get(String(room._id)) || 0);
    const nextStatus =
      room.status === "remont"
        ? "remont"
        : activeCount >= Number(room.capacity || 0)
          ? "band"
          : "bosh";

    if (
      Number(room.activeGuestsCount || 0) === activeCount &&
      String(room.status || "") === nextStatus
    ) {
      continue;
    }

    ops.push({
      updateOne: {
        filter: { _id: room._id },
        update: {
          $set: {
            activeGuestsCount: activeCount,
            status: nextStatus,
          },
        },
      },
    });
  }

  if (ops.length) {
    await Room.bulkWrite(ops, { ordered: false });
  }

  return {
    scannedRooms: rooms.length,
    updatedRooms: ops.length,
  };
};

const main = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI topilmadi");
  }

  await connectDB();
  const result = await syncRoomOccupancy();
  // eslint-disable-next-line no-console
  console.log(
    `Room occupancy repair tugadi: ${result.updatedRooms} ta xona yangilandi, ${result.scannedRooms} ta xona tekshirildi`,
  );
  await mongoose.disconnect();
};

if (require.main === module) {
  main().catch(async (error) => {
    // eslint-disable-next-line no-console
    console.error("Room occupancy repair xatoligi:", error.message);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}
