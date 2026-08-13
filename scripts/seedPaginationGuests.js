require("dotenv").config();

const mongoose = require("mongoose");
const applyTimezone = require("../model/mongoose-timezone");
const Guest = require("../model/Guest");
const Room = require("../model/Room");
const { getHotelSettings, applyTimeToDate } = require("../utils/hotelSettings");

mongoose.plugin(applyTimezone);

const DAY_MS = 24 * 60 * 60 * 1000;
const PASSPORT_PREFIX = "TEST-PAGE-";

const firstNames = [
  "Abror",
  "Malika",
  "Behruz",
  "Zarina",
  "Akmal",
  "Shahnoza",
  "Ulugbek",
  "Rayhona",
  "Doston",
  "Gulbahor",
  "Farruh",
  "Munisa",
  "Bobur",
  "Nilufar",
  "Sardor",
  "Maftuna",
  "Ibrohim",
  "Shirin",
  "Azamat",
  "Kamola",
  "Javohir",
  "Diyora",
  "Sherzod",
  "Latofat",
  "Mirjalol",
  "Nozima",
  "Alisher",
  "Gulnoza",
  "Bekzod",
  "Marjona",
  "Otabek",
  "Farida",
  "Jamshid",
  "Ruxshona",
  "Anvar",
  "Mohira",
  "Siroj",
  "Laziza",
  "Asadbek",
  "Sitora",
];

const lastNames = [
  "Karimov",
  "Saidova",
  "Rasulov",
  "Toshmatova",
  "Nazarov",
  "Qodirova",
  "Aliyev",
  "Usmonova",
  "Xolmatov",
  "Abdullayeva",
];

const makeDate = (dayOffset, hour = 10, minute = 0) => {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  date.setHours(hour, minute, 0, 0);
  return date;
};

const makeBirthDate = (index) => {
  const date = new Date(1982 + (index % 20), index % 12, (index % 27) + 1);
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
    throw new Error("Test mijozlar uchun xona topilmadi");
  }

  const passports = Array.from({ length: 40 }, (_, index) => {
    return `${PASSPORT_PREFIX}${String(index + 1).padStart(3, "0")}`;
  });
  const existingGuests = await Guest.find({ passport: { $in: passports } })
    .select("passport")
    .lean();
  const existingPassports = new Set(existingGuests.map((guest) => guest.passport));

  const now = new Date();
  const documents = passports
    .map((passport, index) => {
      if (existingPassports.has(passport)) return null;

      const room = rooms[index % rooms.length];
      const guestType = index % 7 === 0 ? "chetellik" : "uzb";
      const stayDays = (index % 5) + 1;
      const dailyRate = getDailyRate(room, guestType);
      const isBooked = index < 20;
      const status = isBooked ? "booked" : "checked_out";
      const checkInAt = isBooked ? makeDate(index + 1, 10) : makeDate(-50 + index, 9);
      const checkOutAt = isBooked ? null : makeDate(-48 + index, 11);
      const billing = buildBilling(checkInAt, stayDays, dailyRate, settings, now);
      const paidAmount = isBooked
        ? 0
        : Math.max(Math.floor(billing.totalAmount * 0.45), 1);
      const debtAmount = isBooked
        ? 0
        : Math.max(billing.totalAmount - paidAmount, 1);

      return {
        firstname: firstNames[index],
        lastname: lastNames[index % lastNames.length],
        passport,
        birthDate: makeBirthDate(index),
        phone: `+99890222${String(index + 1).padStart(4, "0")}`,
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
                note: "Pagination test to'lov",
                createdAt: checkInAt,
              },
            ]
          : [],
        status,
        bookedForAt: isBooked ? checkInAt : null,
        checkInAt,
        checkOutAt,
        note: "Pagination test uchun qo'shilgan mijoz",
      };
    })
    .filter(Boolean);

  if (documents.length) {
    await Guest.insertMany(documents, { ordered: false });
  }

  const [byStatus, debtorsCount, totalPageGuests] = await Promise.all([
    Guest.aggregate([
      { $match: { passport: { $regex: `^${PASSPORT_PREFIX}` } } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    Guest.countDocuments({
      passport: { $regex: `^${PASSPORT_PREFIX}` },
      debtAmount: { $gt: 0 },
    }),
    Guest.countDocuments({ passport: { $regex: `^${PASSPORT_PREFIX}` } }),
  ]);

  console.log(
    JSON.stringify(
      {
        inserted: documents.length,
        skippedExisting: existingGuests.length,
        totalPageGuests,
        byStatus,
        debtorsCount,
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
