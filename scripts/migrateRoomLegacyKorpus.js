const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const Room = require("../model/Room");
const applyTimezone = require("../model/mongoose-timezone");

mongoose.plugin(applyTimezone);

const parseLegacyRoomNumber = (value) => {
  const raw = String(value || "").trim().toUpperCase();
  const match = raw.match(/^(\d+)([AB])$/);
  if (!match) return null;
  return { roomNumber: match[1], korpus: match[2] };
};

const main = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI topilmadi");
  }

  await mongoose.connect(process.env.MONGO_URI);

  try {
    await Room.collection.dropIndex("roomNumber_1");
    console.log("Eski roomNumber_1 index o'chirildi");
  } catch (error) {
    if (!String(error?.message || "").includes("index not found")) {
      throw error;
    }
  }

  try {
    await Room.collection.createIndex({ korpus: 1, roomNumber: 1 }, { unique: true });
    console.log("Yangi korpus_roomNumber index yaratildi");
  } catch (error) {
    if (!String(error?.message || "").includes("already exists")) {
      throw error;
    }
  }

  const rooms = await Room.find({
    $or: [
      { korpus: { $exists: false } },
      { korpus: "" },
      { roomNumber: { $regex: /[AB]$/i } },
    ],
  }).sort({ roomNumber: 1 });

  const updates = [];

  for (const room of rooms) {
    const legacy = parseLegacyRoomNumber(room.roomNumber);
    const normalizedKorpus = String(room.korpus || "").trim().toUpperCase();

    if (!legacy && ["A", "B"].includes(normalizedKorpus)) continue;

    const nextRoomNumber = legacy?.roomNumber || String(room.roomNumber || "").trim().toUpperCase();
    const nextKorpus = legacy?.korpus || normalizedKorpus;

    if (!nextKorpus) continue;

    updates.push({
      _id: room._id,
      before: { roomNumber: room.roomNumber, korpus: room.korpus || "" },
      after: { roomNumber: nextRoomNumber, korpus: nextKorpus },
    });
  }

  if (!updates.length) {
    console.log("Yangilashga xona topilmadi");
    await mongoose.disconnect();
    return;
  }

  for (const item of updates) {
    // eslint-disable-next-line no-await-in-loop
    await Room.updateOne(
      { _id: item._id },
      { $set: { roomNumber: item.after.roomNumber, korpus: item.after.korpus } },
    );
    console.log(
      `${item.before.roomNumber} (${item.before.korpus || "-"}) -> ${item.after.roomNumber} (${item.after.korpus})`,
    );
  }

  console.log(`Jami yangilangan xona: ${updates.length}`);
  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error("Migration xatosi:", error.message);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});
