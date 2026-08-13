require("dotenv").config();

const mongoose = require("mongoose");
const applyTimezone = require("../model/mongoose-timezone");
const Guest = require("../model/Guest");
const Room = require("../model/Room");
const Employee = require("../model/Employee");
const Service = require("../model/Service");
const Expense = require("../model/Expense");
const HallBooking = require("../model/HallBooking");
const VipRequest = require("../model/VipRequest");
const { getHotelSettings, applyTimeToDate } = require("../utils/hotelSettings");

mongoose.plugin(applyTimezone);

const DAY_MS = 24 * 60 * 60 * 1000;
const TEST_NOTE = "Demo ma'lumot";
const DEMO_PASSPORT_PREFIX = "DEMO-PLAZA-";
const DEMO_ROOM_PREFIX = "D-";
const DEMO_EMPLOYEE_PREFIX = "Demo ";
const SERVICE_PREFIX = "Demo xizmat - ";
const EXPENSE_PREFIX = "Demo xarajat - ";
const HALL_EVENT_PREFIX = "Demo tadbir - ";

const makeDate = (dayOffset, hour = 10, minute = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d;
};

const makeBirthDate = (year, month, day) => {
  const d = new Date(year, month - 1, day);
  d.setHours(0, 0, 0, 0);
  return d;
};

const makeCurrentMonthDate = (dayIndex, hour = 10, minute = 0) => {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), 1);
  d.setDate(Math.min(dayIndex + 1, now.getDate()));
  d.setHours(hour, minute, 0, 0);
  return d;
};

const buildBilling = (checkInAt, stayDays, dailyRate, settings, now = new Date()) => {
  const safeStayDays = Math.max(Number(stayDays || 1), 1);
  const checkoutDueAt = applyTimeToDate(checkInAt, settings.checkoutTime || "15:00");
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
      return Room.updateOne({ _id: room._id }, { $set: { activeGuestsCount, status } });
    }),
  );
};

const getDailyRate = (room, guestType) =>
  guestType === "chetellik"
    ? Number(room.prices?.chetEllik || 0)
    : Number(room.prices?.oddiy || 0);

const ensureDemoEmployees = async () => {
  await Employee.deleteMany({ firstname: { $regex: `^${DEMO_EMPLOYEE_PREFIX}` } });

  const firstnames = [
    "Akmal",
    "Madina",
    "Sardor",
    "Nilufar",
    "Javohir",
    "Shahnoza",
    "Oybek",
    "Zarina",
    "Doston",
    "Mohira",
  ];
  const positions = [
    "Administrator",
    "Resepshn",
    "Menejer",
    "Buxgalter",
    "Xona xizmati",
    "Oshpaz",
    "Texnik",
    "Qo'riqchi",
    "Farrosh",
    "Ofitsiant",
  ];

  await Employee.insertMany(
    firstnames.map((firstname, index) => ({
      firstname: `${DEMO_EMPLOYEE_PREFIX}${firstname}`,
      lastname: `Xodimov ${String(index + 1).padStart(2, "0")}`,
      position: positions[index],
      salary: 2800000 + index * 350000,
      canLogin: false,
      sections: [],
      isActive: index !== 8,
    })),
    { ordered: false },
  );
};

const ensureDemoRooms = async () => {
  await Room.deleteMany({ roomNumber: { $regex: `^${DEMO_ROOM_PREFIX}` } });

  const categories = ["standart", "polulyuks", "lyuks", "apartament", "bir_kishilik"];
  const docs = Array.from({ length: 10 }, (_, index) => ({
    roomNumber: `${DEMO_ROOM_PREFIX}${101 + index}`,
    floor: Math.floor(index / 4) + 1,
    capacity: (index % 3) + 1,
    category: categories[index % categories.length],
    status: "bosh",
    activeGuestsCount: 0,
    prices: {
      oddiy: 300000 + index * 50000,
      chetEllik: 450000 + index * 65000,
    },
    description: `${TEST_NOTE}: ${index + 1}-xona`,
  }));

  return Room.insertMany(docs, { ordered: false });
};

const ensureDemoServices = async () => {
  await Service.deleteMany({ name: { $regex: `^${SERVICE_PREFIX}` } });

  const docs = [
    ["Nonushta", 45000],
    ["Spa", 180000],
    ["Kir yuvish", 35000],
    ["Aeroport transfer", 220000],
    ["Kechki ovqat", 95000],
    ["Tushlik", 75000],
    ["Mini-bar", 60000],
    ["Fitness", 80000],
    ["Ekskursiya", 250000],
    ["Xonaga taom", 55000],
  ].map(([name, defaultPrice]) => ({
    name: `${SERVICE_PREFIX}${name}`,
    defaultPrice,
    isActive: true,
    note: TEST_NOTE,
  }));

  const inserted = await Service.insertMany(docs, { ordered: false });
  return inserted;
};

const seedGuests = async (rooms, settings, demoServices) => {
  const oldDemoGuests = await Guest.find({
    passport: { $regex: `^${DEMO_PASSPORT_PREFIX}` },
  }).select("_id");
  await VipRequest.deleteMany({ guest: { $in: oldDemoGuests.map((guest) => guest._id) } });
  await Guest.deleteMany({ passport: { $regex: `^${DEMO_PASSPORT_PREFIX}` } });
  const now = new Date();
  const firstnames = [
    "Aziz", "Malika", "Jasur", "Dilnoza", "Bekzod",
    "Nodira", "Sardor", "Zarina", "Oybek", "Mohira",
    "Umid", "Shahnoza", "Doston", "Madina", "Akmal",
    "Nilufar", "Javohir", "Feruza", "Kamol", "Lola",
  ];
  const lastnames = [
    "Karimov", "Saidova", "Rasulov", "Abdullayeva", "Xolmatov",
    "Aliyeva", "Qodirov", "Tursunova", "Ergashev", "Rahimova",
    "Usmonov", "Yusupova", "Olimov", "Hamidova", "Nazarov",
    "Sobirova", "Murodov", "Tohirova", "Salimov", "Oripova",
  ];

  const templates = Array.from({ length: 20 }, (_, index) => {
    const isActive = index < 10;
    const owesMoney = index % 2 === 0;
    const checkInOffset = isActive ? -(index + 1) : -(index + 12);
    const stayDays = (index % 4) + 1;

    return {
      firstname: firstnames[index],
      lastname: lastnames[index],
      passport: `${DEMO_PASSPORT_PREFIX}${String(index + 1).padStart(3, "0")}`,
      guestType: index % 3 === 0 ? "chetellik" : "uzb",
      phone: `+99890${String(1234000 + index + 1).padStart(7, "0")}`,
      birthDate: makeBirthDate(1985 + (index % 15), (index % 12) + 1, (index % 27) + 1),
      room: rooms[index % rooms.length],
      stayDays,
      status: isActive ? "active" : "checked_out",
      checkInAt: makeDate(checkInOffset, 9 + (index % 5), 10),
      checkOutAt: isActive ? null : makeDate(checkInOffset + stayDays, 14, 0),
      paidPart: owesMoney ? 0.45 : 1,
      services: [{ service: demoServices[index % demoServices.length], qty: (index % 2) + 1 }],
      vip: index % 4 === 0,
      note: isActive ? "Demo faol mehmon" : "Demo chiqib ketgan mehmon",
    };
  });

  const docs = templates.map((t, idx) => {
    const dailyRate = getDailyRate(t.room, t.guestType);
    const billing = buildBilling(t.checkInAt, t.stayDays, dailyRate, settings, now);
    const baseTotal = Number(billing.totalAmount || 0);

    const guestServices = (t.services || []).map((item) => ({
      serviceId: item.service?._id,
      name: item.service?.name || "Demo xizmat",
      price: Number(item.service?.defaultPrice || 0),
      quantity: Number(item.qty || 1),
      totalAmount: Number(item.service?.defaultPrice || 0) * Number(item.qty || 1),
      usedAt: makeDate(-Math.max(idx, 1), 16, 10),
      note: TEST_NOTE,
      createdBy: { role: "seed", login: "demo-seed" },
    }));
    const servicesTotal = guestServices.reduce((sum, s) => sum + Number(s.totalAmount || 0), 0);
    const totalAmount = baseTotal + servicesTotal;
    const paidAmount = Math.floor(totalAmount * Number(t.paidPart || 0));
    const debtAmount = Math.max(totalAmount - paidAmount, 0);
    const paymentTypes = ["naqd", "karta", "click", "bank"];
    const firstPayment = Math.floor(paidAmount * 0.6);
    const secondPayment = paidAmount - firstPayment;
    const payments =
      paidAmount > 0
        ? [
            {
              amount: firstPayment,
              type: paymentTypes[idx % paymentTypes.length],
              note: "Demo to'lov - avans",
              createdAt: makeCurrentMonthDate(idx, 9 + (idx % 8), 10),
            },
            ...(secondPayment > 0
              ? [
                  {
                    amount: secondPayment,
                    type: paymentTypes[(idx + 1) % paymentTypes.length],
                    note: "Demo to'lov - yakuniy",
                    createdAt: makeCurrentMonthDate(idx, 15 + (idx % 5), 30),
                  },
                ]
              : []),
          ]
        : [];

    return {
      firstname: t.firstname,
      lastname: t.lastname,
      passport: t.passport,
      birthDate: t.birthDate,
      phone: t.phone,
      guestType: t.guestType,
      room: t.room._id,
      stayDays: t.stayDays,
      billableDays: billing.billableDays,
      checkoutReminderAt: billing.checkoutReminderAt,
      checkoutDueAt: billing.checkoutDueAt,
      dailyRate,
      totalAmount,
      paidAmount,
      debtAmount,
      payments,
      services: guestServices,
      status: t.status,
      bookedForAt: t.status === "booked" ? t.checkInAt : null,
      checkInAt: t.checkInAt,
      checkOutAt: t.checkOutAt || null,
      vip: Boolean(t.vip),
      note: t.note || TEST_NOTE,
    };
  });

  const insertedGuests = await Guest.insertMany(docs, { ordered: false });
  await syncRoomsOccupancy(rooms.map((r) => r._id));
  return insertedGuests;
};

const seedHallBookings = async () => {
  await HallBooking.deleteMany({
    $or: [
      { eventName: { $regex: `^${HALL_EVENT_PREFIX}` } },
      { note: TEST_NOTE },
    ],
  });

  const events = [
    "Nikoh marosimi", "Tug'ilgan kun", "Seminar", "Konferensiya", "Banket",
    "Trening", "Yubiley", "Taqdimot", "Uchrashuv", "Bitiruv kechasi",
  ];
  const hallNames = ["Grand Hall", "Classic Hall", "Business Hall"];
  const docs = events.map((eventName, index) => {
    const totalAmount = 5000000 + index * 750000;
    const paidAmount = index % 3 === 0 ? totalAmount : Math.floor(totalAmount * 0.4);
    return {
      hallName: hallNames[index % hallNames.length],
      eventName: `${HALL_EVENT_PREFIX}${eventName}`,
      customerFirstname: `Mijoz ${index + 1}`,
      customerLastname: "Demo",
      phone: `+99890111${String(index + 1).padStart(4, "0")}`,
      startDate: makeDate(index - 3, 9),
      endDate: makeDate(index - 3, 19),
      totalAmount,
      paidAmount,
      debtAmount: totalAmount - paidAmount,
      payments: [{ amount: paidAmount, type: ["bank", "naqd", "click", "karta"][index % 4], note: "Demo to'lov" }],
      status: index === 8 ? "canceled" : "active",
      note: TEST_NOTE,
      createdBy: { role: "seed", login: "demo-seed" },
    };
  });

  await HallBooking.insertMany(docs, { ordered: false });
};

const seedExpenses = async () => {
  await Expense.deleteMany({ title: { $regex: `^${EXPENSE_PREFIX}` } });

  const docs = [
    ["Elektr energiyasi", "Kommunal", 1450000, "bank"],
    ["Oziq-ovqat xaridi", "Oziq-ovqat", 920000, "naqd"],
    ["Tozalash vositalari", "Xo'jalik", 340000, "karta"],
    ["Internet", "Aloqa", 270000, "click"],
    ["Texnik xizmat", "Ta'mirlash", 680000, "bank"],
    ["Suv ta'minoti", "Kommunal", 410000, "bank"],
    ["Reklama", "Marketing", 850000, "karta"],
    ["Kantselyariya", "Xo'jalik", 195000, "naqd"],
    ["Transport", "Logistika", 520000, "click"],
    ["Maishiy texnika", "Jihozlar", 2300000, "bank"],
  ].map(([title, category, amount, paymentType], index) => ({
    title: `${EXPENSE_PREFIX}${title}`,
    category,
    amount,
    paymentType,
    spentAt: makeCurrentMonthDate(index, 10 + index, 15),
    note: TEST_NOTE,
    createdBy: { role: "seed", login: "demo-seed" },
  }));

  await Expense.insertMany(docs, { ordered: false });
};

const main = async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI .env faylida topilmadi");

  await mongoose.connect(process.env.MONGO_URI);
  const settings = await getHotelSettings();
  await ensureDemoEmployees();
  const rooms = await ensureDemoRooms();
  const demoServices = await ensureDemoServices();
  await seedGuests(rooms, settings, demoServices);
  await seedHallBookings();
  await seedExpenses();

  const [employeeCount, roomCount, guestCount, debtorsCount, activeCount, checkedOutCount, serviceCount, expenseCount, hallCount] =
    await Promise.all([
      Employee.countDocuments({ firstname: { $regex: `^${DEMO_EMPLOYEE_PREFIX}` } }),
      Room.countDocuments({ roomNumber: { $regex: `^${DEMO_ROOM_PREFIX}` } }),
      Guest.countDocuments({ passport: { $regex: `^${DEMO_PASSPORT_PREFIX}` } }),
      Guest.countDocuments({ passport: { $regex: `^${DEMO_PASSPORT_PREFIX}` }, debtAmount: { $gt: 0 } }),
      Guest.countDocuments({ passport: { $regex: `^${DEMO_PASSPORT_PREFIX}` }, status: "active" }),
      Guest.countDocuments({ passport: { $regex: `^${DEMO_PASSPORT_PREFIX}` }, status: "checked_out" }),
      Service.countDocuments({ name: { $regex: `^${SERVICE_PREFIX}` } }),
      Expense.countDocuments({ title: { $regex: `^${EXPENSE_PREFIX}` } }),
      HallBooking.countDocuments({ eventName: { $regex: `^${HALL_EVENT_PREFIX}` } }),
    ]);

  console.log(
    JSON.stringify(
      {
        message: "Demo ma'lumotlar tayyorlandi",
        employees: employeeCount,
        rooms: roomCount,
        guests: { total: guestCount, active: activeCount, checked_out: checkedOutCount, debtors: debtorsCount },
        services: serviceCount,
        expenses: expenseCount,
        hallBookings: hallCount,
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
