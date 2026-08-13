require("dotenv").config();

const mongoose = require("mongoose");
const applyTimezone = require("../model/mongoose-timezone");
const Guest = require("../model/Guest");
const Room = require("../model/Room");
const { getHotelSettings, applyTimeToDate } = require("../utils/hotelSettings");

mongoose.plugin(applyTimezone);

const DAY_MS = 24 * 60 * 60 * 1000;
const PASSPORT_PREFIX = "TEST-OYDIN-";

const makeDate = (dayOffset, hour = 10, minute = 0) => {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  date.setHours(hour, minute, 0, 0);
  return date;
};

const makeBirthDate = (year, month, day) => {
  const date = new Date(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  return date;
};

const buildBilling = (checkInAt, stayDays, dailyRate, settings, now = new Date()) => {
  const safeStayDays = Math.max(Number(stayDays || 1), 1);
  const checkoutDueAt = applyTimeToDate(
    checkInAt,
    settings.checkoutTime || "15:00",
  );
  checkoutDueAt.setDate(checkoutDueAt.getDate() + safeStayDays);

  const checkoutReminderAt = applyTimeToDate(
    checkoutDueAt,
    settings.reminderTime || "12:00",
  );

  const overdueMs = now.getTime() - checkoutDueAt.getTime();
  const extraDays = overdueMs > 0 ? Math.floor(overdueMs / DAY_MS) + 1 : 0;
  const billableDays = safeStayDays + extraDays;

  return {
    billableDays,
    checkoutDueAt,
    checkoutReminderAt,
    totalAmount: Number(dailyRate || 0) * billableDays,
  };
};

const syncRoomsOccupancy = async (roomIds) => {
  const objectRoomIds = [...new Set(roomIds.map(String))]
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  if (!objectRoomIds.length) return;

  const [rooms, activeCounts] = await Promise.all([
    Room.find({ _id: { $in: objectRoomIds } }).select("_id capacity status").lean(),
    Guest.aggregate([
      { $match: { status: "active", room: { $in: objectRoomIds } } },
      { $group: { _id: "$room", count: { $sum: 1 } } },
    ]),
  ]);

  const activeMap = new Map(
    activeCounts.map((item) => [String(item._id), Number(item.count || 0)]),
  );

  await Promise.all(
    rooms.map((room) => {
      const activeGuestsCount = Number(activeMap.get(String(room._id)) || 0);
      const status =
        room.status === "remont"
          ? "remont"
          : activeGuestsCount >= Number(room.capacity || 0)
            ? "band"
            : "bosh";

      return Room.updateOne(
        { _id: room._id },
        { $set: { activeGuestsCount, status } },
      );
    }),
  );
};

const getDailyRate = (room, guestType) => {
  if (guestType === "chetellik") return Number(room.prices?.chetEllik || 0);
  return Number(room.prices?.oddiy || 0);
};

const main = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI .env faylida topilmadi");
  }

  await mongoose.connect(process.env.MONGO_URI);

  const settings = await getHotelSettings();
  const rooms = await Room.find({ status: { $ne: "remont" } })
    .sort({ roomNumber: 1 })
    .lean();

  if (!rooms.length) {
    throw new Error("Test mijozlar uchun faol xona topilmadi");
  }

  const activeCounts = await Guest.aggregate([
    { $match: { status: "active", room: { $in: rooms.map((room) => room._id) } } },
    { $group: { _id: "$room", count: { $sum: 1 } } },
  ]);
  const activeMap = new Map(
    activeCounts.map((item) => [String(item._id), Number(item.count || 0)]),
  );

  const activeRoom =
    rooms.find((room) => {
      const activeGuestsCount = Number(activeMap.get(String(room._id)) || 0);
      return activeGuestsCount < Number(room.capacity || 0);
    }) || rooms[0];
  const firstRoom = rooms[0];
  const secondRoom = rooms[1] || rooms[0];

  const templates = [
    ["Azizbek", "Karimov", "uzb", "+998901110001", makeBirthDate(1991, 3, 12), "active", activeRoom, 2],
    ["Madina", "Tursunova", "uzb", "+998901110002", makeBirthDate(1994, 7, 25), "booked", secondRoom, 1],
    ["Jasur", "Rasulov", "uzb", "+998901110003", makeBirthDate(1988, 11, 2), "booked", firstRoom, 2],
    ["Dilnoza", "Saidova", "uzb", "+998901110004", makeBirthDate(1997, 5, 19), "booked", secondRoom, 3],
    ["Timur", "Nazarov", "uzb", "+998901110005", makeBirthDate(1985, 9, 30), "booked", firstRoom, 1],
    ["Emily", "Johnson", "chetellik", "+12025550101", makeBirthDate(1990, 1, 9), "checked_out", secondRoom, 2],
    ["Mehmet", "Yilmaz", "chetellik", "+905551110102", makeBirthDate(1983, 4, 17), "checked_out", firstRoom, 1],
    ["Oybek", "Xolmatov", "uzb", "+998901110008", makeBirthDate(1992, 8, 6), "checked_out", secondRoom, 4],
    ["Sevara", "Aliyeva", "uzb", "+998901110009", makeBirthDate(1996, 12, 14), "checked_out", firstRoom, 2],
    ["Daniel", "Smith", "chetellik", "+442071110010", makeBirthDate(1979, 2, 21), "checked_out", secondRoom, 3],
    ["Nigora", "Usmonova", "uzb", "+998901110011", makeBirthDate(1989, 6, 4), "checked_out", firstRoom, 1],
    ["Rustam", "Qodirov", "uzb", "+998901110012", makeBirthDate(1993, 10, 10), "checked_out", secondRoom, 2],
    ["Anna", "Petrova", "chetellik", "+77015550113", makeBirthDate(1987, 3, 27), "checked_out", firstRoom, 5],
    ["Sarvar", "Abdullayev", "uzb", "+998901110014", makeBirthDate(1995, 7, 7), "checked_out", secondRoom, 1],
    ["Lola", "Ergasheva", "uzb", "+998901110015", makeBirthDate(1998, 9, 16), "checked_out", firstRoom, 3],
  ];

  const passports = templates.map((_, index) => {
    return `${PASSPORT_PREFIX}${String(index + 1).padStart(3, "0")}`;
  });
  const existingGuests = await Guest.find({ passport: { $in: passports } })
    .select("passport")
    .lean();
  const existingPassports = new Set(existingGuests.map((guest) => guest.passport));

  const now = new Date();
  const documents = templates
    .map(([firstname, lastname, guestType, phone, birthDate, status, room, stayDays], index) => {
      const passport = passports[index];
      if (existingPassports.has(passport)) return null;

      const isBooked = status === "booked";
      const isCheckedOut = status === "checked_out";
      const dailyRate = getDailyRate(room, guestType);
      const checkInAt = isBooked
        ? makeDate(index, 10)
        : isCheckedOut
          ? makeDate(-30 + index * 2, 9)
          : makeDate(0, 10);
      const billing = buildBilling(checkInAt, stayDays, dailyRate, settings, now);
      const paidAmount = isBooked
        ? 0
        : isCheckedOut
          ? index % 4 === 0
            ? Math.floor(billing.totalAmount / 2)
            : billing.totalAmount
          : Math.floor(billing.totalAmount / 3);
      const debtAmount = status === "booked" ? 0 : Math.max(billing.totalAmount - paidAmount, 0);

      return {
        firstname,
        lastname,
        passport,
        birthDate,
        phone,
        guestType,
        room: room._id,
        stayDays,
        billableDays: billing.billableDays,
        checkoutReminderAt: billing.checkoutReminderAt,
        checkoutDueAt: billing.checkoutDueAt,
        dailyRate,
        totalAmount: billing.totalAmount,
        paidAmount,
        debtAmount,
        payments: paidAmount
          ? [
              {
                amount: paidAmount,
                type: index % 2 === 0 ? "naqd" : "karta",
                note: "Test to'lov",
                createdAt: checkInAt,
              },
            ]
          : [],
        status,
        bookedForAt: isBooked ? checkInAt : null,
        checkInAt,
        checkOutAt: isCheckedOut ? makeDate(-28 + index * 2, 11) : null,
        note: "Test uchun qo'shilgan mijoz",
      };
    })
    .filter(Boolean);

  if (documents.length) {
    await Guest.insertMany(documents, { ordered: false });
  }

  await syncRoomsOccupancy(rooms.map((room) => room._id));

  const counts = await Guest.aggregate([
    { $match: { passport: { $regex: `^${PASSPORT_PREFIX}` } } },
    { $group: { _id: "$status", count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);

  console.log(
    JSON.stringify(
      {
        inserted: documents.length,
        skippedExisting: existingGuests.length,
        totalTestGuests: counts.reduce((sum, item) => sum + item.count, 0),
        byStatus: counts,
      },
      null,
      2,
    ),
  );
};

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
