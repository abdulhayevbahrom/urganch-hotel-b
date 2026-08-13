const Guest = require("../model/Guest");
const Room = require("../model/Room");
const VipRequest = require("../model/VipRequest");
const Employee = require("../model/Employee");
const Service = require("../model/Service");
const mongoose = require("mongoose");
const response = require("../utils/response");
const {
  getHotelSettings,
  applyTimeToDate,
} = require("../utils/hotelSettings");

const DAY_MS = 24 * 60 * 60 * 1000;
const VIP_REQUEST_FIELDS = "status guest requestedBy decidedBy decidedAt note createdAt";
const VIP_GUEST_FIELDS = "firstname lastname passport room vip vipRequestStatus";

const emitPendingVipCount = async (io) => {
  if (!io) return;
  const count = await VipRequest.countDocuments({ status: "pending" });
  io.to("vip-admins").emit("vip_pending_count", { count });
};

const emitGuestChanged = (io, payload = {}) => {
  if (!io) return;
  io.emit("guest_updated", {
    ...payload,
    emittedAt: new Date(),
  });
};

const buildActionBy = async (user) => {
  if (!user) return null;

  const action = {
    userId: String(user.id || ""),
    role: String(user.role || ""),
    login: String(user.login || ""),
    firstname: "",
    lastname: "",
  };

  if (!action.userId) return action;

  const employee = await Employee.findById(action.userId)
    .select("firstname lastname")
    .lean();

  action.firstname = String(employee?.firstname || "");
  action.lastname = String(employee?.lastname || "");

  return action;
};

const canManageVip = (user) => {
  if (!user) return false;
  return String(user.role || "").toLowerCase() === "admin";
};

const escapeRegex = (value) =>
  String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const buildBillingState = (
  checkInAt,
  stayDays,
  now = new Date(),
  hotelSettings = {},
) => {
  const safeStayDays = Math.max(Number(stayDays || 1), 1);

  const checkoutDueAt = applyTimeToDate(
    checkInAt,
    hotelSettings.checkoutTime || "15:00",
  );
  checkoutDueAt.setDate(checkoutDueAt.getDate() + safeStayDays);

  const checkoutReminderAt = applyTimeToDate(
    checkoutDueAt,
    hotelSettings.reminderTime || "12:00",
  );

  const overdueMs = now.getTime() - checkoutDueAt.getTime();
  const extraDays = overdueMs > 0 ? Math.floor(overdueMs / DAY_MS) + 1 : 0;
  const billableDays = safeStayDays + extraDays;

  return {
    stayDays: safeStayDays,
    billableDays,
    checkoutDueAt,
    checkoutReminderAt,
    isCheckoutReminderTime:
      now.getTime() >= checkoutReminderAt.getTime() &&
      now.getTime() < checkoutDueAt.getTime(),
    isCheckoutOverdue: overdueMs > 0,
  };
};

const recalcAmounts = (guest) => {
  if (guest.vip) {
    guest.debtAmount = 0;
    return;
  }
  const paid = Number(guest.paidAmount || 0);
  const total = Number(guest.totalAmount || 0);
  guest.debtAmount = Math.max(total - paid, 0);
};

const syncGuestBilling = async (
  guest,
  now = new Date(),
  hotelSettings = null,
) => {
  if (!guest || guest.status !== "active") return false;
  const settings = hotelSettings || (await getHotelSettings());

  const billing = buildBillingState(
    guest.checkInAt,
    guest.stayDays,
    now,
    settings,
  );
  const nextTotalAmount =
    Number(guest.dailyRate || 0) * Number(billing.billableDays || 1);

  const changed =
    Number(guest.billableDays || 0) !== Number(billing.billableDays) ||
    Number(guest.stayDays || 0) !== Number(billing.stayDays) ||
    Number(guest.totalAmount || 0) !== Number(nextTotalAmount) ||
    new Date(guest.checkoutDueAt || 0).getTime() !==
      billing.checkoutDueAt.getTime() ||
    new Date(guest.checkoutReminderAt || 0).getTime() !==
      billing.checkoutReminderAt.getTime();

  if (!changed) return false;

  guest.stayDays = billing.stayDays;
  guest.billableDays = billing.billableDays;
  guest.checkoutDueAt = billing.checkoutDueAt;
  guest.checkoutReminderAt = billing.checkoutReminderAt;
  guest.totalAmount = nextTotalAmount;
  recalcAmounts(guest);
  await guest.save();
  return true;
};

const syncAllActiveGuestsBilling = async () => {
  const hotelSettings = await getHotelSettings();
  const activeGuests = await Guest.find({ status: "active" });
  for (const guest of activeGuests) {
    // eslint-disable-next-line no-await-in-loop
    await syncGuestBilling(guest, new Date(), hotelSettings);
  }
};

const syncRoomsOccupancyBatch = async (roomIds = []) => {
  const uniqueRoomIds = [
    ...new Set(
      roomIds
        .map((id) => String(id || "").trim())
        .filter((id) => mongoose.Types.ObjectId.isValid(id)),
    ),
  ];
  if (!uniqueRoomIds.length) return;
  const objectRoomIds = uniqueRoomIds.map((id) => new mongoose.Types.ObjectId(id));

  const [rooms, activeCounts] = await Promise.all([
    Room.find({ _id: { $in: objectRoomIds } })
      .select("_id capacity status activeGuestsCount")
      .lean(),
    Guest.aggregate([
      {
        $match: {
          status: "active",
          room: { $in: objectRoomIds },
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
    const roomId = String(room?._id || "");
    const activeCount = Number(activeMap.get(roomId) || 0);
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
};

const syncRoomOccupancy = async (roomId) => {
  await syncRoomsOccupancyBatch([roomId]);
};

const createGuest = async (req, res) => {
  try {
    const {
      firstname,
      lastname,
      passport,
      birthDate,
      phone,
      guestType = "uzb",
      vip = false,
      isBooking = false,
      bookedForDate,
      room,
      dailyRate,
      stayDays,
      note = "",
    } = req.body;

    const normalizedPassport = String(passport || "").trim();
    if (normalizedPassport) {
      const blacklistedGuest = await Guest.findOne({
        passport: {
          $regex: `^${escapeRegex(normalizedPassport)}$`,
          $options: "i",
        },
        isBlacklisted: true,
      }).select("_id firstname lastname passport");
      if (blacklistedGuest) {
        return response.error(
          res,
          "Bu mijoz qora ro'yxatda. Mijozni qabul qilish mumkin emas",
        );
      }
    }

    const roomDoc = await Room.findById(room);
    if (!roomDoc) return response.notFound(res, "Xona topilmadi");
    if (roomDoc.status === "remont") {
      return response.error(
        res,
        "Bu xona remont/yopiq holatda. Mehmonni joylab bo'lmaydi",
      );
    }

    const activeCount = await Guest.countDocuments({ room, status: "active" });
    if (activeCount >= roomDoc.capacity) {
      return response.error(res, "Xonada bo'sh joy yo'q");
    }

    const hotelSettings = await getHotelSettings();
    const normalizedDailyRate = Number(dailyRate || 0);
    const normalizedStayDays = Math.max(Number(stayDays || 1), 1);
    const isReservation = Boolean(isBooking);
    const bookedForAt =
      isReservation && bookedForDate ? new Date(bookedForDate) : null;
    if (isReservation) {
      if (!bookedForAt || Number.isNaN(bookedForAt.getTime())) {
        return response.error(res, "Bron sanasi noto'g'ri");
      }

      const start = new Date(bookedForAt);
      start.setHours(0, 0, 0, 0);
      const end = new Date(bookedForAt);
      end.setHours(23, 59, 59, 999);
      const hasBooking = await Guest.exists({
        room,
        status: "booked",
        bookedForAt: { $gte: start, $lte: end },
      });
      if (hasBooking) {
        return response.error(
          res,
          "Bu xona shu kunga allaqachon bron qilingan",
        );
      }
    }

    const baseCheckInAt = isReservation ? bookedForAt : new Date();
    const billing = buildBillingState(
      baseCheckInAt,
      normalizedStayDays,
      new Date(),
      hotelSettings,
    );

    const isVipRequested = !isReservation && Boolean(vip);
    const acceptedBy = await buildActionBy(req.admin);

    const guest = await Guest.create({
      firstname,
      lastname,
      passport: normalizedPassport,
      birthDate,
      phone: String(phone || "").trim(),
      guestType,
      vip: false,
      vipRequestStatus: isVipRequested ? "pending" : "none",
      vipRequestedBy: isVipRequested ? acceptedBy : null,
      room,
      stayDays: billing.stayDays,
      billableDays: billing.billableDays,
      checkoutReminderAt: billing.checkoutReminderAt,
      checkoutDueAt: billing.checkoutDueAt,
      bookedForAt,
      dailyRate: normalizedDailyRate,
      totalAmount: normalizedDailyRate * billing.billableDays,
      paidAmount: 0,
      debtAmount: isReservation ? 0 : normalizedDailyRate * billing.billableDays,
      payments: [],
      status: isReservation ? "booked" : "active",
      acceptedBy,
      checkInAt: baseCheckInAt,
      note,
    });

    let vipRequest = null;
    if (isVipRequested) {
      vipRequest = await VipRequest.create({
        guest: guest._id,
        status: "pending",
        requestedBy: acceptedBy,
      });

      const io = req.app.get("socket");
      if (io) {
        io.to("vip-admins").emit("vip_request_created", {
          id: vipRequest._id,
          guestId: guest._id,
          guestName: `${guest.firstname} ${guest.lastname}`,
          roomId: guest.room,
          requestedBy: acceptedBy,
          createdAt: vipRequest.createdAt,
        });
        await emitPendingVipCount(io);
      }
    }

    if (!isReservation) {
      await syncRoomOccupancy(roomDoc._id);
    }

    emitGuestChanged(req.app.get("socket"), {
      guestId: String(guest._id),
      roomId: String(guest.room || ""),
      status: guest.status,
      reason: isReservation ? "guest_booked" : "guest_created",
    });

    const populated = await Guest.findById(guest._id).populate("room");
    if (vipRequest) {
      return response.created(
        res,
        "Mehmon qabul qilindi. VIP so'rovi adminga yuborildi",
        populated,
      );
    }

    return response.created(
      res,
      isReservation
        ? "Mehmon muvaffaqiyatli bron qilindi"
        : "Mehmon muvaffaqiyatli qabul qilindi",
      populated,
    );
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const createGuestsBulk = async (req, res) => {
  try {
    const {
      room,
      dailyRate,
      stayDays,
      guestType = "uzb",
      isBooking = false,
      bookedForDate,
      guests = [],
    } = req.body;

    if (!Array.isArray(guests) || guests.length < 1) {
      return response.error(res, "Kamida 1 ta mijoz ma'lumoti yuborilishi kerak");
    }

    const roomDoc = await Room.findById(room);
    if (!roomDoc) return response.notFound(res, "Xona topilmadi");
    if (roomDoc.status === "remont") {
      return response.error(
        res,
        "Bu xona remont/yopiq holatda. Mehmonni joylab bo'lmaydi",
      );
    }

    const isReservation = Boolean(isBooking);
    const normalizedDailyRate = Number(dailyRate || 0);
    const normalizedStayDays = Math.max(Number(stayDays || 1), 1);
    const bookedForAt =
      isReservation && bookedForDate ? new Date(bookedForDate) : null;

    if (isReservation) {
      if (!bookedForAt || Number.isNaN(bookedForAt.getTime())) {
        return response.error(res, "Bron sanasi noto'g'ri");
      }
      const start = new Date(bookedForAt);
      start.setHours(0, 0, 0, 0);
      const end = new Date(bookedForAt);
      end.setHours(23, 59, 59, 999);
      const hasBooking = await Guest.exists({
        room,
        status: "booked",
        bookedForAt: { $gte: start, $lte: end },
      });
      if (hasBooking) {
        return response.error(
          res,
          "Bu xona shu kunga allaqachon bron qilingan",
        );
      }
    } else {
      const activeCount = await Guest.countDocuments({ room, status: "active" });
      if (activeCount + guests.length > Number(roomDoc.capacity || 0)) {
        return response.error(res, "Xonada barcha mijozlar uchun bo'sh joy yo'q");
      }
    }

    const normalizedGuests = guests.map((guest) => ({
      firstname: String(guest.firstname || "").trim(),
      lastname: String(guest.lastname || "").trim(),
      passport: String(guest.passport || "").trim(),
      birthDate: guest.birthDate,
      phone: String(guest.phone || "").trim(),
      note: String(guest.note || "").trim(),
      vip: Boolean(guest.vip),
    }));

    const passports = normalizedGuests
      .map((guest) => guest.passport)
      .filter(Boolean);
    if (passports.length) {
      const orConditions = passports.map((passport) => ({
        passport: { $regex: `^${escapeRegex(passport)}$`, $options: "i" },
      }));
      const blacklistedGuest = await Guest.findOne({
        isBlacklisted: true,
        $or: orConditions,
      }).select("_id firstname lastname passport");
      if (blacklistedGuest) {
        return response.error(
          res,
          "Mijozlardan biri qora ro'yxatda. Qabul qilish mumkin emas",
        );
      }
    }

    const hotelSettings = await getHotelSettings();
    const acceptedBy = await buildActionBy(req.admin);
    const baseCheckInAt = isReservation ? bookedForAt : new Date();
    const billing = buildBillingState(
      baseCheckInAt,
      normalizedStayDays,
      new Date(),
      hotelSettings,
    );

    const docs = normalizedGuests.map((guest) => {
      const isVipRequested = !isReservation && Boolean(guest.vip);
      return {
        firstname: guest.firstname,
        lastname: guest.lastname,
        passport: guest.passport,
        birthDate: guest.birthDate,
        phone: guest.phone,
        guestType,
        vip: false,
        vipRequestStatus: isVipRequested ? "pending" : "none",
        vipRequestedBy: isVipRequested ? acceptedBy : null,
        room,
        stayDays: billing.stayDays,
        billableDays: billing.billableDays,
        checkoutReminderAt: billing.checkoutReminderAt,
        checkoutDueAt: billing.checkoutDueAt,
        bookedForAt,
        dailyRate: normalizedDailyRate,
        totalAmount: normalizedDailyRate * billing.billableDays,
        paidAmount: 0,
        debtAmount: isReservation ? 0 : normalizedDailyRate * billing.billableDays,
        payments: [],
        status: isReservation ? "booked" : "active",
        acceptedBy,
        checkInAt: baseCheckInAt,
        note: guest.note,
      };
    });

    const createdGuests = await Guest.insertMany(docs, { ordered: true });
    const vipCandidates = createdGuests.filter(
      (_, index) => !isReservation && Boolean(normalizedGuests[index]?.vip),
    );
    if (vipCandidates.length) {
      await VipRequest.insertMany(
        vipCandidates.map((guest) => ({
          guest: guest._id,
          status: "pending",
          requestedBy: acceptedBy,
        })),
        { ordered: true },
      );
      const io = req.app.get("socket");
      if (io) await emitPendingVipCount(io);
    }

    if (!isReservation) await syncRoomOccupancy(roomDoc._id);

    emitGuestChanged(req.app.get("socket"), {
      roomId: String(room || ""),
      reason: isReservation ? "guest_bulk_booked" : "guest_bulk_created",
      count: createdGuests.length,
    });

    const ids = createdGuests.map((item) => item._id);
    const populatedGuests = await Guest.find({ _id: { $in: ids } }).populate("room");

    return response.created(
      res,
      isReservation
        ? `${createdGuests.length} ta mehmon muvaffaqiyatli bron qilindi`
        : `${createdGuests.length} ta mehmon muvaffaqiyatli qabul qilindi`,
      populatedGuests,
    );
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const buildGuestsFilter = async ({
  tab,
  query,
  guestType,
  vip,
  roomNumber,
  floor,
  category,
  startDate,
  endDate,
}) => {
  const filter = {};

  if (tab === "active") filter.status = { $in: ["active", "booked"] };
  if (tab === "history") filter.status = "checked_out";
  if (tab === "booked") filter.status = "booked";
  if (tab === "debtors") filter.debtAmount = { $gt: 0 };

  if (guestType && ["uzb", "chetellik"].includes(guestType)) {
    filter.guestType = guestType;
  }

  if (vip === "true") filter.vip = true;
  if (vip === "false") filter.vip = false;

  if (startDate || endDate) {
    filter.checkInAt = {};
    if (startDate) {
      const from = new Date(startDate);
      if (!Number.isNaN(from.getTime())) filter.checkInAt.$gte = from;
    }
    if (endDate) {
      const to = new Date(endDate);
      if (!Number.isNaN(to.getTime())) {
        to.setHours(23, 59, 59, 999);
        filter.checkInAt.$lte = to;
      }
    }
    if (Object.keys(filter.checkInAt).length === 0) delete filter.checkInAt;
  }

  const roomFilter = {};
  if (roomNumber) {
    roomFilter.roomNumber = { $regex: escapeRegex(roomNumber), $options: "i" };
  }
  if (floor !== undefined && floor !== "") roomFilter.floor = Number(floor);
  if (category) roomFilter.category = category;

  let roomIdsByFilter = null;
  if (Object.keys(roomFilter).length > 0) {
    const roomDocs = await Room.find(roomFilter).select("_id").lean();
    roomIdsByFilter = roomDocs.map((room) => room._id);
    if (!roomIdsByFilter.length) return { filter: { _id: null } };
    filter.room = { $in: roomIdsByFilter };
  }

  const search = String(query || "").trim();
  if (search) {
    const searchRegex = { $regex: escapeRegex(search), $options: "i" };
    const roomSearchIds = await Room.find({ roomNumber: searchRegex })
      .select("_id")
      .lean();

    const roomIds = roomSearchIds.map((room) => room._id);
    const searchOr = [
      { firstname: searchRegex },
      { lastname: searchRegex },
      { passport: searchRegex },
    ];
    if (roomIds.length) searchOr.push({ room: { $in: roomIds } });
    filter.$or = searchOr;
  }

  return { filter };
};

const attachGuestRuntimeFlags = (guest) => {
  const now = Date.now();
  const checkoutReminderAt = new Date(guest.checkoutReminderAt || 0).getTime();
  const checkoutDueAt = new Date(guest.checkoutDueAt || 0).getTime();
  return {
    ...guest,
    isCheckoutReminderTime: now >= checkoutReminderAt && now < checkoutDueAt,
    isCheckoutOverdue: checkoutDueAt > 0 && now > checkoutDueAt,
  };
};

const getGuests = async (req, res) => {
  try {
    const tab = String(req.query.tab || "active").toLowerCase();
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 25), 1), 100);
    const { filter } = await buildGuestsFilter({
      tab,
      query: req.query.query,
      guestType: req.query.guestType,
      vip: req.query.vip,
      roomNumber: req.query.roomNumber,
      floor: req.query.floor,
      category: req.query.category,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    });
    const sort =
      tab === "active"
        ? { checkoutDueAt: 1, checkoutReminderAt: 1, createdAt: -1 }
        : { createdAt: -1 };

    const [itemsRaw, total] = await Promise.all([
      Guest.find(filter)
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("room", "roomNumber floor category")
        .lean(),
      Guest.countDocuments(filter),
    ]);

    const totalPages = Math.max(Math.ceil(total / limit), 1);
    const items = itemsRaw.map(attachGuestRuntimeFlags);
    if (tab === "active") {
      items.sort((a, b) => {
        const aReminder = a.isCheckoutReminderTime ? 1 : 0;
        const bReminder = b.isCheckoutReminderTime ? 1 : 0;
        if (bReminder !== aReminder) return bReminder - aReminder;
        const aOverdue = a.isCheckoutOverdue ? 1 : 0;
        const bOverdue = b.isCheckoutOverdue ? 1 : 0;
        if (bOverdue !== aOverdue) return bOverdue - aOverdue;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
    }
    const floors = [];
    const roomNumbers = [];
    const categories = [];
    const floorSet = new Set();
    const roomSet = new Set();
    const categorySet = new Set();

    for (const guest of items) {
      const floor = guest?.room?.floor;
      const roomNumber = guest?.room?.roomNumber;
      const category = guest?.room?.category;

      if (floor !== undefined && floor !== null && !floorSet.has(floor)) {
        floorSet.add(floor);
        floors.push(floor);
      }
      if (roomNumber && !roomSet.has(roomNumber)) {
        roomSet.add(roomNumber);
        roomNumbers.push(roomNumber);
      }
      if (category && !categorySet.has(category)) {
        categorySet.add(category);
        categories.push(category);
      }
    }

    floors.sort((a, b) => Number(a) - Number(b));
    roomNumbers.sort();
    categories.sort();

    return response.success(res, "Mehmonlar ro'yxati", {
      items,
      filterOptions: {
        floors,
        roomNumbers,
        categories,
      },
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    });
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

// Shaxmatka uchun alohida, faqat o'qish endpointi. U mavjud mijoz/bron
// oqimlariga ta'sir qilmaydi va tanlangan davr bilan kesishgan yozuvlarni qaytaradi.
const getOccupancy = async (req, res) => {
  try {
    const from = new Date(req.query.from);
    const to = new Date(req.query.to);

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return response.error(res, "Boshlanish va tugash sanasi noto'g'ri");
    }

    from.setHours(0, 0, 0, 0);
    to.setHours(0, 0, 0, 0);
    if (to <= from) {
      return response.error(res, "Tugash sanasi boshlanish sanasidan keyin bo'lishi kerak");
    }

    const guests = await Guest.find({
      status: { $in: ["active", "booked"] },
      checkInAt: { $lt: to },
      checkoutDueAt: { $gt: from },
    })
      .select(
        "firstname lastname room status checkInAt bookedForAt checkoutDueAt stayDays note",
      )
      .populate("room", "roomNumber floor category")
      .sort({ checkInAt: 1 })
      .lean();

    return response.success(res, "Xonalar bandligi", guests);
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const getGuestById = async (req, res) => {
  try {
    const guest = await Guest.findById(req.params.id).populate("room");
    if (!guest) return response.notFound(res, "Mehmon topilmadi");
    if (guest.status === "active") await syncGuestBilling(guest);

    const next = await Guest.findById(req.params.id).populate("room").lean();
    return response.success(
      res,
      "Mehmon ma'lumotlari",
      attachGuestRuntimeFlags(next),
    );
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const getGuestByPassport = async (req, res) => {
  try {
    const passport = String(req.params.passport || "").trim();
    if (!passport) return response.error(res, "Passport majburiy");

    const guest = await Guest.findOne({
      passport: { $regex: `^${escapeRegex(passport)}$`, $options: "i" },
    })
      .sort({ createdAt: -1 })
      .select("firstname lastname phone birthDate passport isBlacklisted");

    if (!guest)
      return response.notFound(res, "Passport bo'yicha mehmon topilmadi");

    return response.success(res, "Passport bo'yicha ma'lumot topildi", guest);
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const updateGuest = async (req, res) => {
  try {
    const guest = await Guest.findById(req.params.id);
    if (!guest) return response.notFound(res, "Mehmon topilmadi");
    const previousRoomId = String(guest.room);

    if (Object.prototype.hasOwnProperty.call(req.body, "vipRequestStatus")) {
      return response.error(
        res,
        "VIP so'rov holatini to'g'ridan-to'g'ri o'zgartirib bo'lmaydi",
      );
    }

    const updates = { ...req.body };
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    let nextBookedForAt = guest.bookedForAt;

    if (Object.prototype.hasOwnProperty.call(updates, "bookedForAt")) {
      if (guest.status !== "booked") {
        return response.error(
          res,
          "Bron sanani faqat bron qilingan mijozda o'zgartirish mumkin",
        );
      }
      const parsedBookedDate = new Date(updates.bookedForAt);
      if (Number.isNaN(parsedBookedDate.getTime())) {
        return response.error(res, "Bron sanasi noto'g'ri");
      }
      if (parsedBookedDate < todayStart) {
        return response.error(
          res,
          "Bron sanasi bugundan oldin bo'lishi mumkin emas",
        );
      }
      updates.bookedForAt = parsedBookedDate;
      nextBookedForAt = parsedBookedDate;
    }

    if (updates.room && String(updates.room) !== String(guest.room)) {
      const targetRoom = await Room.findById(updates.room).lean();
      if (!targetRoom) return response.notFound(res, "Xona topilmadi");
      if (targetRoom.status === "remont") {
        return response.error(
          res,
          "Bu xona remont/yopiq holatda. Mehmonni joylab bo'lmaydi",
        );
      }

      if (guest.status !== "booked") {
        const targetActiveCount = await Guest.countDocuments({
          room: targetRoom._id,
          status: "active",
          _id: { $ne: guest._id },
        });
        if (targetActiveCount >= Number(targetRoom.capacity || 0)) {
          return response.error(res, "Xonada bo'sh joy yo'q");
        }
      }
    }

    if (guest.status === "booked") {
      const nextRoomId = updates.room ? String(updates.room) : String(guest.room);
      if (!nextBookedForAt) {
        return response.error(res, "Bron sanasi topilmadi");
      }
      const dayStart = new Date(nextBookedForAt);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(nextBookedForAt);
      dayEnd.setHours(23, 59, 59, 999);

      const hasBookingConflict = await Guest.exists({
        _id: { $ne: guest._id },
        room: nextRoomId,
        status: "booked",
        bookedForAt: { $gte: dayStart, $lte: dayEnd },
      });
      if (hasBookingConflict) {
        return response.error(
          res,
          "Bu xona shu kunga allaqachon bron qilingan",
        );
      }
    }

    const wantsVipRequest = Object.prototype.hasOwnProperty.call(updates, "vip")
      ? Boolean(updates.vip)
      : false;
    delete updates.vip;

    Object.assign(guest, updates);

    if (Object.prototype.hasOwnProperty.call(req.body, "stayDays")) {
      guest.stayDays = Math.max(Number(req.body.stayDays || 1), 1);
    }

    if (wantsVipRequest && !guest.vip && guest.vipRequestStatus !== "pending") {
      const requestedBy = await buildActionBy(req.admin);
      guest.vipRequestStatus = "pending";
      guest.vipRequestedBy = requestedBy;

      const vipRequest = await VipRequest.create({
        guest: guest._id,
        status: "pending",
        requestedBy,
      });

      const io = req.app.get("socket");
      if (io) {
        io.to("vip-admins").emit("vip_request_created", {
          id: vipRequest._id,
          guestId: guest._id,
          guestName: `${guest.firstname} ${guest.lastname}`,
          roomId: guest.room,
          requestedBy,
          createdAt: vipRequest.createdAt,
        });
        await emitPendingVipCount(io);
      }
    }

    if (guest.status === "active") {
      const billingChanged = await syncGuestBilling(guest);
      if (!billingChanged) {
        await guest.save();
      }
    }

    if (
      Object.prototype.hasOwnProperty.call(req.body, "dailyRate") &&
      guest.status !== "active"
    ) {
      guest.totalAmount =
        Number(req.body.dailyRate || 0) *
        Math.max(Number(guest.billableDays || 1), 1);
      recalcAmounts(guest);
      await guest.save();
    }

    if (
      guest.status !== "active" &&
      !Object.prototype.hasOwnProperty.call(req.body, "dailyRate")
    ) {
      await guest.save();
    }

    const nextRoomId = String(guest.room);
    if (previousRoomId !== nextRoomId) {
      await syncRoomsOccupancyBatch([previousRoomId, nextRoomId]);
    } else {
      await syncRoomOccupancy(nextRoomId);
    }

    emitGuestChanged(req.app.get("socket"), {
      guestId: String(guest._id),
      roomId: nextRoomId,
      previousRoomId,
      status: guest.status,
      debtAmount: Number(guest.debtAmount || 0),
      reason: "guest_updated",
    });

    const populated = await Guest.findById(guest._id).populate("room").lean();
    return response.success(
      res,
      "Mehmon ma'lumotlari yangilandi",
      attachGuestRuntimeFlags(populated),
    );
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const getVipRequests = async (req, res) => {
  try {
    if (!canManageVip(req.admin)) {
      return response.forbidden(res, "VIP so'rovlarni ko'rishga ruxsat yo'q");
    }

    const status = String(req.query.status || "pending").toLowerCase();
    const filter = {};
    if (["pending", "approved", "rejected"].includes(status)) {
      filter.status = status;
    }

    const requests = await VipRequest.find(filter)
      .select(VIP_REQUEST_FIELDS)
      .populate({
        path: "guest",
        select: VIP_GUEST_FIELDS,
        options: { lean: true },
        populate: {
          path: "room",
          select: "roomNumber",
          options: { lean: true },
        },
      })
      .sort({ createdAt: -1 })
      .lean();

    return response.success(res, "VIP so'rovlar ro'yxati", requests);
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const getVipRequestsCount = async (req, res) => {
  try {
    if (!canManageVip(req.admin)) {
      return response.forbidden(res, "VIP so'rovlarni ko'rishga ruxsat yo'q");
    }

    const status = String(req.query.status || "pending").toLowerCase();
    const filter = {};
    if (["pending", "approved", "rejected"].includes(status)) {
      filter.status = status;
    }

    const count = await VipRequest.countDocuments(filter);
    return response.success(res, "VIP so'rovlar soni", { count });
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const decideVipRequest = async (req, res) => {
  try {
    if (!canManageVip(req.admin)) {
      return response.forbidden(res, "VIP so'rovni tasdiqlashga ruxsat yo'q");
    }

    const action = String(req.body.action || "").toLowerCase();
    if (!["approve", "reject"].includes(action)) {
      return response.error(res, "action approve yoki reject bo'lishi kerak");
    }

    const request = await VipRequest.findById(req.params.id);
    if (!request) return response.notFound(res, "VIP so'rov topilmadi");
    if (request.status !== "pending") {
      return response.error(res, "VIP so'rov allaqachon ko'rib chiqilgan");
    }

    const guest = await Guest.findById(request.guest);
    if (!guest) return response.notFound(res, "Bog'langan mehmon topilmadi");

    const decisionBy = await buildActionBy(req.admin);
    request.status = action === "approve" ? "approved" : "rejected";
    request.decidedBy = decisionBy;
    request.decidedAt = new Date();
    request.note = String(req.body.note || "").trim();
    await request.save();

    if (action === "approve") {
      guest.vip = true;
      guest.vipRequestStatus = "approved";
      guest.vipApprovedBy = decisionBy;
      guest.vipApprovedAt = new Date();
      guest.paidAmount = 0;
      guest.payments = [];
      guest.debtAmount = 0;
    } else {
      guest.vip = false;
      guest.vipRequestStatus = "rejected";
      guest.vipApprovedBy = null;
      guest.vipApprovedAt = null;
      recalcAmounts(guest);
    }

    await guest.save();

    const io = req.app.get("socket");
    if (io) {
      // Adminlar uchun VIP so'rov yangilanishi
      io.to("vip-admins").emit("vip_request_updated", {
        id: request._id,
        guestId: guest._id,
        status: request.status,
        decidedBy: decisionBy,
        decidedAt: request.decidedAt,
      });

      // Barcha ulangan klientlarga mehmon holati yangilangani haqida signal
      io.emit("guest_updated", {
        guestId: String(guest._id),
        reason: "vip_decision",
        vip: guest.vip,
        vipRequestStatus: guest.vipRequestStatus,
        debtAmount: guest.debtAmount,
      });

      await emitPendingVipCount(io);
    }

    const populatedGuest = await Guest.findById(guest._id).populate("room");
    return response.success(
      res,
      action === "approve" ? "VIP so'rov tasdiqlandi" : "VIP so'rov rad etildi",
      {
        request,
        guest: populatedGuest,
      },
    );
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const addGuestPayment = async (req, res) => {
  try {
    const { amount, type, note = "" } = req.body;
    const guest = await Guest.findById(req.params.id);
    if (!guest) return response.notFound(res, "Mehmon topilmadi");
    // if (guest.status !== "active") return response.error(res, "Faqat active mehmon uchun to'lov qo'shiladi");
    if (guest.vip)
      return response.error(res, "VIP mehmon uchun to'lov olinmaydi");

    await syncGuestBilling(guest);

    guest.payments.push({ amount: Number(amount), type, note });
    guest.paidAmount = Number(guest.paidAmount || 0) + Number(amount);
    recalcAmounts(guest);
    await guest.save();

    emitGuestChanged(req.app.get("socket"), {
      guestId: String(guest._id),
      roomId: String(guest.room || ""),
      status: guest.status,
      paidAmount: Number(guest.paidAmount || 0),
      debtAmount: Number(guest.debtAmount || 0),
      reason: "guest_payment_added",
    });

    const populated = await Guest.findById(guest._id).populate("room").lean();
    return response.success(
      res,
      "To'lov qo'shildi",
      attachGuestRuntimeFlags(populated),
    );
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const addGuestService = async (req, res) => {
  try {
    const guest = await Guest.findById(req.params.id);
    if (!guest) return response.notFound(res, "Mehmon topilmadi");
    if (guest.status === "checked_out") {
      return response.error(
        res,
        "Checkout qilingan mijozga xizmat qo'shib bo'lmaydi",
      );
    }

    await syncGuestBilling(guest);

    let serviceDoc = null;
    if (req.body.serviceId) {
      serviceDoc = await Service.findById(req.body.serviceId).lean();
    }

    const name = String(req.body.name || serviceDoc?.name || "").trim();
    const price = Number(
      Object.prototype.hasOwnProperty.call(req.body, "price")
        ? req.body.price
        : serviceDoc?.defaultPrice || 0,
    );
    const quantity = Math.max(Number(req.body.quantity || 1), 1);
    const totalAmount = price * quantity;

    if (!name) return response.error(res, "Xizmat nomi majburiy");

    guest.services.push({
      serviceId: serviceDoc?._id,
      name,
      price,
      quantity,
      totalAmount,
      usedAt: req.body.usedAt ? new Date(req.body.usedAt) : new Date(),
      note: String(req.body.note || "").trim(),
      createdBy: await buildActionBy(req.admin),
    });

    guest.totalAmount = Number(guest.totalAmount || 0) + totalAmount;
    recalcAmounts(guest);
    await guest.save();

    emitGuestChanged(req.app.get("socket"), {
      guestId: String(guest._id),
      roomId: String(guest.room || ""),
      status: guest.status,
      totalAmount: Number(guest.totalAmount || 0),
      debtAmount: Number(guest.debtAmount || 0),
      reason: "guest_service_added",
    });

    const populated = await Guest.findById(guest._id).populate("room").lean();
    return response.success(
      res,
      "Mehmon xizmati qo'shildi",
      attachGuestRuntimeFlags(populated),
    );
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const checkoutGuest = async (req, res) => {
  try {
    const guest = await Guest.findById(req.params.id);
    if (!guest) return response.notFound(res, "Mehmon topilmadi");
    if (guest.status === "checked_out") {
      return response.error(res, "Mehmon allaqachon checkout qilingan");
    }

    await syncGuestBilling(guest);

    guest.status = "checked_out";
    guest.checkoutBy = await buildActionBy(req.admin);
    guest.checkOutAt = new Date();
    await guest.save();

    await syncRoomOccupancy(guest.room);

    emitGuestChanged(req.app.get("socket"), {
      guestId: String(guest._id),
      roomId: String(guest.room || ""),
      status: guest.status,
      debtAmount: Number(guest.debtAmount || 0),
      reason: "guest_checked_out",
    });

    const populated = await Guest.findById(guest._id).populate("room").lean();
    return response.success(
      res,
      "Mehmon checkout qilindi",
      attachGuestRuntimeFlags(populated),
    );
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const deleteGuest = async (req, res) => {
  try {
    if (String(req?.admin?.role || "").toLowerCase() !== "manager") {
      return response.forbidden(res, "Mehmonni faqat manager o'chira oladi");
    }

    const guest = await Guest.findByIdAndDelete(req.params.id);
    if (!guest) return response.notFound(res, "Mehmon topilmadi");

    const deleteResult = await VipRequest.deleteMany({ guest: guest._id });
    if (deleteResult?.deletedCount > 0) {
      const io = req.app.get("socket");
      if (io) {
        await emitPendingVipCount(io);
      }
    }

    if (guest.status === "active") {
      await syncRoomOccupancy(guest.room);
    }

    emitGuestChanged(req.app.get("socket"), {
      guestId: String(guest._id),
      roomId: String(guest.room || ""),
      status: guest.status,
      reason: "guest_deleted",
    });

    return response.success(res, "Mehmon o'chirildi");
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

module.exports = {
  createGuest,
  createGuestsBulk,
  getGuests,
  getOccupancy,
  getGuestById,
  getGuestByPassport,
  getVipRequests,
  getVipRequestsCount,
  decideVipRequest,
  updateGuest,
  addGuestPayment,
  addGuestService,
  checkoutGuest,
  deleteGuest,
};
