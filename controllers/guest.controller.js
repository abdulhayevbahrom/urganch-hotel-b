const Guest = require("../model/Guest");
const Room = require("../model/Room");
const VipRequest = require("../model/VipRequest");
const Employee = require("../model/Employee");
const Service = require("../model/Service");
const mongoose = require("mongoose");
const moment = require("moment-timezone");
const response = require("../utils/response");
const { hasFullAccess } = require("../utils/roleAccess");
const {
  getHotelSettings,
  applyTimeToDate,
  calculateCheckoutDueAt,
} = require("../utils/hotelSettings");
const {
  syncRoomsOccupancyByIds,
} = require("../utils/roomOccupancy");
const {
  normalizeDailyRates,
  compactDailyRates,
  getDailyRateForDay,
  getLodgingTotal,
} = require("../utils/guestDailyRates");

const DAY_MS = 24 * 60 * 60 * 1000;
const TIMEZONE = process.env.APP_TIMEZONE || "Asia/Tashkent";
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

const parseDateTimeInput = (value, fallback = null) => {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed;
};

const canManageVip = (user) => {
  if (!user) return false;
  return hasFullAccess(user.role);
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

  const checkoutDueAt = calculateCheckoutDueAt(
    checkInAt,
    safeStayDays,
    hotelSettings.checkoutTime || "12:00",
  );

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

const getCompletedStayDays = (
  checkInAt,
  checkOutAt,
  checkoutTime = "12:00",
) => {
  const checkIn = moment(checkInAt).tz(TIMEZONE);
  const checkOut = moment(checkOutAt).tz(TIMEZONE);
  if (!checkIn.isValid() || !checkOut.isValid()) return 1;

  const [checkoutHour = 12, checkoutMinute = 0] = String(checkoutTime)
    .split(":")
    .map(Number);
  const cutoffMinutes = checkoutHour * 60 + checkoutMinute;
  const checkInMinutes = checkIn.hour() * 60 + checkIn.minute();
  const checkOutMinutes = checkOut.hour() * 60 + checkOut.minute();
  const checkInOperationalDay = checkIn.clone().startOf("day");
  const checkOutOperationalDay = checkOut.clone().startOf("day");

  if (checkInMinutes < cutoffMinutes) checkInOperationalDay.subtract(1, "day");
  if (checkOutMinutes <= cutoffMinutes) {
    checkOutOperationalDay.subtract(1, "day");
  }

  return Math.max(
    checkOutOperationalDay.diff(checkInOperationalDay, "day") + 1,
    1,
  );
};

const splitDailyRate = (totalDailyRate, guestCount = 1) => {
  const total = Number(totalDailyRate || 0);
  const count = Math.max(Number(guestCount || 1), 1);
  return Math.round(total / count);
};

const intervalsOverlap = (startA, endA, startB, endB) => {
  const aStart = new Date(startA).getTime();
  const aEnd = new Date(endA).getTime();
  const bStart = new Date(startB).getTime();
  const bEnd = new Date(endB).getTime();
  if ([aStart, aEnd, bStart, bEnd].some((value) => Number.isNaN(value))) {
    return false;
  }
  return aStart < bEnd && bStart < aEnd;
};

const hasRoomStayConflict = async ({
  roomId,
  stayStart,
  stayEnd,
  excludeGuestId = null,
  includeActive = false,
}) => {
  const query = {
    room: roomId,
    status: { $in: includeActive ? ["active", "booked"] : ["booked"] },
  };
  if (excludeGuestId) {
    query._id = { $ne: excludeGuestId };
  }

  const conflicts = await Guest.find(query)
    .select("_id status bookedForAt checkInAt checkoutDueAt stayDays billableDays")
    .lean();

  return conflicts.some((guest) => {
    const guestStart =
      guest.status === "booked"
        ? guest.bookedForAt
        : guest.checkInAt;
    const guestEnd = guest.checkoutDueAt || guest.checkInAt;
    return intervalsOverlap(stayStart, stayEnd, guestStart, guestEnd);
  });
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
  let normalizedDailyRates = normalizeDailyRates(
    guest.dailyRates,
    billing.stayDays,
    guest.dailyRate,
  );
  const uniqueDailyAmounts = new Set(
    normalizedDailyRates.map((item) => Number(item.amount || 0)),
  );
  // An old generated schedule may retain the former uniform rate after the
  // standard daily rate was changed. Bring it back in sync automatically.
  if (
    uniqueDailyAmounts.size === 1 &&
    Number(normalizedDailyRates[0]?.amount || 0) !== Number(guest.dailyRate || 0)
  ) {
    normalizedDailyRates = normalizeDailyRates(
      [],
      billing.stayDays,
      guest.dailyRate,
    );
  }
  const persistedDailyRates = compactDailyRates(
    normalizedDailyRates,
    billing.stayDays,
    guest.dailyRate,
  );
  const servicesTotal = (guest.services || []).reduce(
    (sum, service) => sum + Number(service?.totalAmount || 0),
    0,
  );
  const nextTotalAmount =
    getLodgingTotal(
      { ...guest.toObject(), dailyRates: normalizedDailyRates },
      billing.billableDays,
    ) + servicesTotal;

  const changed =
    Number(guest.billableDays || 0) !== Number(billing.billableDays) ||
    Number(guest.stayDays || 0) !== Number(billing.stayDays) ||
    Number(guest.totalAmount || 0) !== Number(nextTotalAmount) ||
    new Date(guest.checkoutDueAt || 0).getTime() !==
      billing.checkoutDueAt.getTime() ||
    new Date(guest.checkoutReminderAt || 0).getTime() !==
      billing.checkoutReminderAt.getTime() ||
    JSON.stringify(guest.dailyRates || []) !== JSON.stringify(persistedDailyRates);

  if (!changed) return false;

  guest.stayDays = billing.stayDays;
  guest.billableDays = billing.billableDays;
  guest.checkoutDueAt = billing.checkoutDueAt;
  guest.checkoutReminderAt = billing.checkoutReminderAt;
  guest.dailyRates = persistedDailyRates;
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
  await syncRoomsOccupancyByIds(roomIds);
};

const syncRoomOccupancy = async (roomId) => {
  await syncRoomsOccupancyBatch([roomId]);
};

const buildContinuedGuestState = ({
  guest,
  additionalDays,
  now = new Date(),
  hotelSettings = {},
}) => {
  const extraDays = Math.max(Number(additionalDays || 1), 1);
  const nextStayDays = Math.max(Number(guest?.stayDays || 1), 1) + extraDays;
  const billing = buildBillingState(
    guest.checkInAt,
    nextStayDays,
    now,
    hotelSettings,
  );
  const servicesTotal = (guest?.services || []).reduce(
    (sum, service) => sum + Number(service?.totalAmount || 0),
    0,
  );
  const totalAmount =
    getLodgingTotal(guest, billing.billableDays) +
    servicesTotal;
  const debtAmount = guest?.vip
    ? 0
    : Math.max(totalAmount - Number(guest?.paidAmount || 0), 0);

  return { ...billing, totalAmount, debtAmount };
};

const createGuest = async (req, res) => {
  try {
    const {
      firstname,
      lastname,
      passport,
      birthDate,
      phone,
      email = "",
      organization = "",
      organizationInn = "",
      guestType = "uzb",
      vip = false,
      isBooking = false,
      bookedForDate,
      checkInAt,
      room,
      dailyRate,
      mainPaymentType = "naqd",
      stayDays,
      note = "",
      initialPaymentAmount = 0,
      initialPaymentType = "naqd",
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
      bookedForAt.setHours(12, 0, 0, 0);

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

    const baseCheckInAt = isReservation
      ? bookedForAt
      : parseDateTimeInput(checkInAt, new Date());
    const billing = buildBillingState(
      baseCheckInAt,
      normalizedStayDays,
      new Date(),
      hotelSettings,
    );

    const stayConflict = await hasRoomStayConflict({
      roomId: room,
      stayStart: baseCheckInAt,
      stayEnd: billing.checkoutDueAt,
      includeActive: isReservation,
    });
    if (stayConflict) {
      return response.error(
        res,
        "Bu xonada tanlangan muddat oralig'ida bron yoki bandlik mavjud",
      );
    }

    const isVipRequested = !isReservation && Boolean(vip);
    const acceptedBy = await buildActionBy(req.admin);
    const guestDailyRate = splitDailyRate(normalizedDailyRate, 1);
    const initialPayment = Math.max(Number(initialPaymentAmount || 0), 0);
    if (initialPayment > 0 && isVipRequested) {
      return response.error(res, "VIP mehmon uchun to'lov olinmaydi");
    }

    const guest = await Guest.create({
      firstname,
      lastname,
      passport: normalizedPassport,
      birthDate: birthDate || null,
      phone: String(phone || "").trim(),
      email: String(email || "").trim(),
      organization: String(organization || "").trim(),
      organizationInn: String(organizationInn || "").trim(),
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
      dailyRate: guestDailyRate,
      dailyRates: [],
      mainPaymentType: String(mainPaymentType || "naqd"),
      totalAmount: guestDailyRate * billing.billableDays,
      paidAmount: isReservation ? 0 : initialPayment,
      debtAmount: isReservation
        ? 0
        : Math.max(guestDailyRate * billing.billableDays - initialPayment, 0),
      payments:
        !isReservation && initialPayment > 0
          ? [{ amount: initialPayment, type: initialPaymentType, note: "Qabul qilish paytidagi to'lov" }]
          : [],
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
      mainPaymentType = "naqd",
      stayDays,
      guestType = "uzb",
      isBooking = false,
      bookedForDate,
      checkInAt,
      guests = [],
      initialPaymentAmount = 0,
      initialPaymentType = "naqd",
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
      bookedForAt.setHours(12, 0, 0, 0);
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
      birthDate: guest.birthDate || null,
      phone: String(guest.phone || "").trim(),
      email: String(guest.email || "").trim(),
      organization: String(guest.organization || "").trim(),
      organizationInn: String(guest.organizationInn || "").trim(),
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
    const baseCheckInAt = isReservation
      ? bookedForAt
      : parseDateTimeInput(checkInAt, new Date());
    const billing = buildBillingState(
      baseCheckInAt,
      normalizedStayDays,
      new Date(),
      hotelSettings,
    );

    const stayConflict = await hasRoomStayConflict({
      roomId: room,
      stayStart: baseCheckInAt,
      stayEnd: billing.checkoutDueAt,
      includeActive: isReservation,
    });
    if (stayConflict) {
      return response.error(
        res,
        "Bu xonada tanlangan muddat oralig'ida bron yoki bandlik mavjud",
      );
    }

    const guestDailyRate = splitDailyRate(normalizedDailyRate, normalizedGuests.length);
    const totalInitialPayment = Math.max(Number(initialPaymentAmount || 0), 0);
    if (totalInitialPayment > 0 && normalizedGuests.some((guest) => guest.vip)) {
      return response.error(res, "VIP mehmon uchun to'lov olinmaydi");
    }
    const paymentPerGuest = normalizedGuests.length
      ? totalInitialPayment / normalizedGuests.length
      : 0;

    const docs = normalizedGuests.map((guest) => {
      const isVipRequested = !isReservation && Boolean(guest.vip);
      return {
        firstname: guest.firstname,
        lastname: guest.lastname,
        passport: guest.passport,
        birthDate: guest.birthDate || null,
        phone: guest.phone,
        email: guest.email,
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
        dailyRate: guestDailyRate,
        dailyRates: [],
        mainPaymentType: String(mainPaymentType || "naqd"),
        totalAmount: guestDailyRate * billing.billableDays,
        paidAmount: isReservation ? 0 : paymentPerGuest,
        debtAmount: isReservation
          ? 0
          : Math.max(guestDailyRate * billing.billableDays - paymentPerGuest, 0),
        payments:
          !isReservation && paymentPerGuest > 0
            ? [{ amount: paymentPerGuest, type: initialPaymentType, note: "Qabul qilish paytidagi to'lov" }]
            : [],
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

const getAccruedStayDays = (guest, now = new Date()) => {
  const safeStayDays = Math.max(Number(guest?.stayDays || 1), 1);
  const checkIn = moment(guest?.checkInAt).tz(TIMEZONE);
  const current = moment(now).tz(TIMEZONE);
  if (!checkIn.isValid() || !current.isValid()) return 1;

  const checkoutDue = moment(guest?.checkoutDueAt).tz(TIMEZONE);
  if (checkoutDue.isValid() && current.isAfter(checkoutDue)) {
    const extraDays = Math.floor(current.diff(checkoutDue) / DAY_MS) + 1;
    return safeStayDays + extraDays;
  }

  const checkoutClock = checkoutDue.isValid()
    ? checkoutDue.format("HH:mm")
    : "12:00";
  const [checkoutHour = 12, checkoutMinute = 0] = checkoutClock
    .split(":")
    .map(Number);
  const isBeforeCheckout = (value) =>
    value.hour() < checkoutHour ||
    (value.hour() === checkoutHour && value.minute() < checkoutMinute);
  const checkInOperationalDay = checkIn.clone().startOf("day");
  if (isBeforeCheckout(checkIn)) checkInOperationalDay.subtract(1, "day");
  const currentOperationalDay = current.clone().startOf("day");
  if (isBeforeCheckout(current)) currentOperationalDay.subtract(1, "day");
  const currentStayDay = Math.max(
    currentOperationalDay.diff(checkInOperationalDay, "day") + 1,
    1,
  );

  return Math.min(currentStayDay, safeStayDays);
};

const getAccruedGuestAmounts = (guest, now = new Date()) => {
  const accruedStayDays = getAccruedStayDays(guest, now);
  const servicesTotal = (guest?.services || []).reduce(
    (sum, service) => sum + Number(service?.totalAmount || 0),
    0,
  );
  const lodgingTotal = guest?.vip
    ? 0
    : getLodgingTotal(guest, accruedStayDays);
  const totalAmount = lodgingTotal + servicesTotal;
  const debtAmount = guest?.vip
    ? 0
    : Math.max(totalAmount - Number(guest?.paidAmount || 0), 0);

  return { accruedStayDays, totalAmount, debtAmount };
};

const getGuestPayableAmount = (guest) =>
  guest?.vip
    ? 0
    : Math.max(
        Number(guest?.totalAmount || 0) - Number(guest?.paidAmount || 0),
        0,
      );

const attachGuestRuntimeFlags = (guest, nowValue = new Date()) => {
  const now = new Date(nowValue).getTime();
  const checkoutReminderAt = new Date(guest.checkoutReminderAt || 0).getTime();
  const checkoutDueAt = new Date(guest.checkoutDueAt || 0).getTime();
  const accruedAmounts =
    guest?.status === "active"
      ? getAccruedGuestAmounts(guest, new Date(now))
      : null;
  return {
    ...guest,
    ...(accruedAmounts || {}),
    currentDailyRate:
      guest?.status === "active"
        ? getDailyRateForDay(guest, getAccruedStayDays(guest, new Date(now)))
        : Number(guest?.dailyRate || 0),
    // Jami/Qarz joriy yashagan kunlar bo'yicha ko'rsatiladi, ammo mijoz
    // rejalashtirilgan barcha kunlar uchun oldindan to'lov qila olishi kerak.
    payableAmount: getGuestPayableAmount(guest),
    isCheckoutReminderTime: now >= checkoutReminderAt && now < checkoutDueAt,
    isCheckoutOverdue: checkoutDueAt > 0 && now > checkoutDueAt,
  };
};

const getGuests = async (req, res) => {
  try {
    const tab = String(req.query.tab || "active").toLowerCase();
    if (tab === "active") await syncAllActiveGuestsBilling();
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
        ? { createdAt: -1 }
        : { createdAt: -1 };

    const guestsQuery = Guest.find(filter)
      .sort(sort)
      .populate("room", "roomNumber floor korpus category")
      .populate("group", "name organization");
    if (tab !== "active") {
      guestsQuery.skip((page - 1) * limit).limit(limit);
    }

    const [itemsRaw, total] = await Promise.all([
      guestsQuery.lean(),
      Guest.countDocuments(filter),
    ]);

    const totalPages = Math.max(Math.ceil(total / limit), 1);
    let items = itemsRaw.map((guest) => attachGuestRuntimeFlags(guest));
    if (tab === "active") {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const tomorrowStart = new Date(todayStart);
      tomorrowStart.setDate(tomorrowStart.getDate() + 1);
      const isCheckoutToday = (guest) => {
        const checkoutAt = new Date(guest.checkoutDueAt || 0).getTime();
        return (
          checkoutAt >= todayStart.getTime() &&
          checkoutAt < tomorrowStart.getTime()
        );
      };

      items.sort((a, b) => {
        const aCheckoutToday = isCheckoutToday(a) ? 1 : 0;
        const bCheckoutToday = isCheckoutToday(b) ? 1 : 0;
        if (bCheckoutToday !== aCheckoutToday) {
          return bCheckoutToday - aCheckoutToday;
        }
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
      items = items.slice((page - 1) * limit, page * limit);
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
      status: { $in: ["active", "booked", "checked_out"] },
      checkInAt: { $lt: to },
      $or: [
        { status: { $in: ["active", "booked"] }, checkoutDueAt: { $gt: from } },
        { status: "checked_out", checkOutAt: { $gt: from } },
      ],
    })
      .select(
        "firstname lastname room status checkInAt checkOutAt bookedForAt checkoutDueAt stayDays note",
      )
      .populate("room", "roomNumber floor korpus category")
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
    const dailyRateChanged =
      Object.prototype.hasOwnProperty.call(req.body, "dailyRate") &&
      Number(req.body.dailyRate || 0) !== Number(guest.dailyRate || 0);

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
    let bookedStayBilling = null;

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
      // Bronlar kelish kunining o'rtasida boshlanadi. Bu vaqt mavjud bron
      // oralig'i bilan to'qnashuvni aniq hisoblash uchun ishlatiladi.
      parsedBookedDate.setHours(12, 0, 0, 0);
      updates.bookedForAt = parsedBookedDate;
      nextBookedForAt = parsedBookedDate;
    }

    if (Object.prototype.hasOwnProperty.call(updates, "checkInAt")) {
      const parsedCheckInAt = parseDateTimeInput(updates.checkInAt, null);
      if (!parsedCheckInAt) {
        return response.error(res, "Kelgan sana vaqti noto'g'ri");
      }
      updates.checkInAt = parsedCheckInAt;
    }

    let editedCheckOutAt = null;
    if (Object.prototype.hasOwnProperty.call(updates, "checkOutAt")) {
      if (guest.status !== "checked_out") {
        return response.error(
          res,
          "Checkout sanasini faqat mijozlar tarixida o'zgartirish mumkin",
        );
      }
      editedCheckOutAt = parseDateTimeInput(updates.checkOutAt, null);
      if (!editedCheckOutAt) {
        return response.error(res, "Checkout sana vaqti noto'g'ri");
      }
      const nextCheckInAt = updates.checkInAt || guest.checkInAt;
      if (editedCheckOutAt.getTime() < new Date(nextCheckInAt).getTime()) {
        return response.error(
          res,
          "Checkout sanasi kelgan sanadan oldin bo'lishi mumkin emas",
        );
      }
      if (editedCheckOutAt.getTime() > Date.now()) {
        return response.error(
          res,
          "Checkout sanasi hozirgi vaqtdan keyin bo'lishi mumkin emas",
        );
      }
      updates.checkOutAt = editedCheckOutAt;
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
      const hotelSettings = await getHotelSettings();
      const nextStayDays = Math.max(
        Number(updates.stayDays ?? guest.stayDays ?? 1),
        1,
      );
      bookedStayBilling = buildBillingState(
        nextBookedForAt,
        nextStayDays,
        new Date(),
        hotelSettings,
      );
      const hasBookingConflict = await hasRoomStayConflict({
        roomId: nextRoomId,
        stayStart: nextBookedForAt,
        stayEnd: bookedStayBilling.checkoutDueAt,
        excludeGuestId: guest._id,
        includeActive: true,
      });
      if (hasBookingConflict) {
        return response.error(
          res,
          "Bu xonada tanlangan muddat oralig'ida bron yoki bandlik mavjud",
        );
      }
    }

    const wantsVipRequest = Object.prototype.hasOwnProperty.call(updates, "vip")
      ? Boolean(updates.vip)
      : false;
    delete updates.vip;

    Object.assign(guest, updates);

    if (bookedStayBilling) {
      // Bron sanasi o'zgarsa, kelish/chiqish muddatlari ham yangi sanadan
      // qayta hisoblanadi. Frontend yuborgan eski checkInAt qo'llanilmaydi.
      guest.checkInAt = nextBookedForAt;
      guest.bookedForAt = nextBookedForAt;
      guest.stayDays = bookedStayBilling.stayDays;
      guest.billableDays = bookedStayBilling.billableDays;
      guest.checkoutDueAt = bookedStayBilling.checkoutDueAt;
      guest.checkoutReminderAt = bookedStayBilling.checkoutReminderAt;
    }

    if (editedCheckOutAt) {
      const hotelSettings = await getHotelSettings();
      const completedStayDays = getCompletedStayDays(
        guest.checkInAt,
        editedCheckOutAt,
        hotelSettings.checkoutTime || "12:00",
      );
      const servicesTotal = (guest.services || []).reduce(
        (sum, service) => sum + Number(service?.totalAmount || 0),
        0,
      );
      guest.stayDays = completedStayDays;
      guest.billableDays = completedStayDays;
      guest.checkoutDueAt = editedCheckOutAt;
      guest.checkoutReminderAt = applyTimeToDate(
        editedCheckOutAt,
        hotelSettings.reminderTime || "12:00",
      );
      guest.totalAmount =
        getLodgingTotal(guest, completedStayDays) + servicesTotal;
      recalcAmounts(guest);
    }

    if (
      Object.prototype.hasOwnProperty.call(req.body, "stayDays") &&
      !editedCheckOutAt
    ) {
      guest.stayDays = Math.max(Number(req.body.stayDays || 1), 1);
    }

    // The standard rate is an "apply to all days" action. Per-day overrides
    // can then be entered in a subsequent edit without being silently mixed
    // with values left over from the former standard rate.
    if (dailyRateChanged) {
      guest.dailyRates = [];
    } else if (Object.prototype.hasOwnProperty.call(req.body, "dailyRates")) {
      guest.dailyRates = compactDailyRates(
        req.body.dailyRates,
        guest.stayDays,
        guest.dailyRate,
      );
    } else {
      guest.dailyRates = compactDailyRates(
        guest.dailyRates,
        guest.stayDays,
        guest.dailyRate,
      );
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
      (Object.prototype.hasOwnProperty.call(req.body, "dailyRate") ||
        Object.prototype.hasOwnProperty.call(req.body, "dailyRates")) &&
      guest.status !== "active"
    ) {
      const servicesTotal = (guest.services || []).reduce(
        (sum, service) => sum + Number(service?.totalAmount || 0),
        0,
      );
      guest.totalAmount =
        getLodgingTotal(guest, Math.max(Number(guest.billableDays || 1), 1)) +
        servicesTotal;
      recalcAmounts(guest);
      await guest.save();
    }

    if (
      guest.status !== "active" &&
      !Object.prototype.hasOwnProperty.call(req.body, "dailyRate") &&
      !Object.prototype.hasOwnProperty.call(req.body, "dailyRates")
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

const updateGuestPayment = async (req, res) => {
  try {
    const paymentIndex = Number(req.params.paymentIndex);
    if (!Number.isInteger(paymentIndex) || paymentIndex < 0) {
      return response.error(res, "paymentIndex noto'g'ri");
    }

    const guest = await Guest.findById(req.params.id);
    if (!guest) return response.notFound(res, "Mehmon topilmadi");
    if (!Array.isArray(guest.payments) || !guest.payments[paymentIndex]) {
      return response.notFound(res, "To'lov topilmadi");
    }
    if (guest.vip) {
      return response.error(res, "VIP mehmon uchun to'lov o'zgartirilmaydi");
    }

    const payment = guest.payments[paymentIndex];
    if (Object.prototype.hasOwnProperty.call(req.body, "amount")) {
      const nextAmount = Number(req.body.amount);
      if (!Number.isFinite(nextAmount) || nextAmount < 0) {
        return response.error(res, "To'lov summasi noto'g'ri");
      }
      payment.amount = nextAmount;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "type")) {
      payment.type = String(req.body.type || "").trim();
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "note")) {
      payment.note = String(req.body.note || "").trim();
    }

    await syncGuestBilling(guest);
    guest.paidAmount = (guest.payments || []).reduce(
      (sum, item) => sum + Number(item.amount || 0),
      0,
    );
    recalcAmounts(guest);
    await guest.save();

    emitGuestChanged(req.app.get("socket"), {
      guestId: String(guest._id),
      roomId: String(guest.room || ""),
      status: guest.status,
      paidAmount: Number(guest.paidAmount || 0),
      debtAmount: Number(guest.debtAmount || 0),
      reason: "guest_payment_updated",
    });

    const populated = await Guest.findById(guest._id).populate("room").lean();
    return response.success(res, "To'lov yangilandi", attachGuestRuntimeFlags(populated));
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

const continueGuestStay = async (req, res) => {
  try {
    const guest = await Guest.findById(req.params.id);
    if (!guest) return response.notFound(res, "Mehmon topilmadi");
    if (guest.status !== "checked_out") {
      return response.error(
        res,
        "Faqat checkout qilingan mijoz jarayonini davom ettirish mumkin",
      );
    }

    const additionalDays = Math.max(Number(req.body.additionalDays || 1), 1);
    const room = await Room.findById(guest.room).lean();
    if (!room) return response.notFound(res, "Xona topilmadi");
    if (room.status === "remont") {
      return response.error(
        res,
        "Xona remont holatida. Jarayonni davom ettirib bo'lmaydi",
      );
    }

    const activeCount = await Guest.countDocuments({
      room: room._id,
      status: "active",
      _id: { $ne: guest._id },
    });
    if (activeCount >= Number(room.capacity || 0)) {
      return response.error(
        res,
        "Xonada bo'sh joy yo'q. Jarayonni davom ettirib bo'lmaydi",
      );
    }

    const now = new Date();
    const hotelSettings = await getHotelSettings();
    const continued = buildContinuedGuestState({
      guest,
      additionalDays,
      now,
      hotelSettings,
    });
    if (continued.checkoutDueAt.getTime() <= now.getTime()) {
      return response.error(
        res,
        "Qo'shimcha kun yetarli emas. Checkout sanasi kelajakda bo'lishi kerak",
      );
    }

    guest.status = "active";
    guest.stayDays = continued.stayDays;
    guest.billableDays = continued.billableDays;
    guest.checkoutDueAt = continued.checkoutDueAt;
    guest.checkoutReminderAt = continued.checkoutReminderAt;
    guest.totalAmount = continued.totalAmount;
    guest.debtAmount = continued.debtAmount;
    guest.checkOutAt = null;
    guest.checkoutBy = null;
    await guest.save();

    await syncRoomOccupancy(guest.room);
    emitGuestChanged(req.app.get("socket"), {
      guestId: String(guest._id),
      roomId: String(guest.room || ""),
      status: guest.status,
      checkoutDueAt: guest.checkoutDueAt,
      reason: "guest_stay_continued",
    });

    const populated = await Guest.findById(guest._id).populate("room").lean();
    return response.success(
      res,
      "Mijozning yashash jarayoni davom ettirildi",
      attachGuestRuntimeFlags(populated),
    );
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const checkoutGuestsBulk = async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
    const uniqueIds = [...new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))];
    if (!uniqueIds.length) {
      return response.error(res, "Kamida 1 ta mehmon tanlang");
    }

    const guests = await Guest.find({
      _id: { $in: uniqueIds },
    }).select("_id room status checkoutDueAt");

    if (!guests.length) {
      return response.notFound(res, "Mehmon topilmadi");
    }

    const activeGuests = guests.filter((guest) => guest.status !== "checked_out");
    if (!activeGuests.length) {
      return response.error(res, "Tanlangan mehmonlar allaqachon checkout qilingan");
    }

    const checkoutBy = await buildActionBy(req.admin);
    const now = new Date();
    const roomIds = [...new Set(activeGuests.map((guest) => String(guest.room || "")))];

    await Guest.bulkWrite(
      activeGuests.map((guest) => ({
        updateOne: {
          filter: { _id: guest._id, status: { $ne: "checked_out" } },
          update: {
            $set: {
              status: "checked_out",
              checkOutAt: guest.checkoutDueAt || now,
              checkoutBy,
            },
          },
        },
      })),
      { ordered: false },
    );

    await syncRoomsOccupancyBatch(roomIds);

    emitGuestChanged(req.app.get("socket"), {
      guestIds: activeGuests.map((guest) => String(guest._id)),
      roomIds,
      status: "checked_out",
      reason: "guest_bulk_checked_out",
      count: activeGuests.length,
    });

    return response.success(
      res,
      `${activeGuests.length} ta mehmon checkout qilindi`,
      { count: activeGuests.length, ids: activeGuests.map((guest) => String(guest._id)) },
    );
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const deleteGuest = async (req, res) => {
  try {
    const guest = await Guest.findByIdAndDelete(req.params.id);
    if (!guest) return response.notFound(res, "Mehmon topilmadi");

    const deleteResult = await VipRequest.deleteMany({ guest: guest._id });
    if (deleteResult?.deletedCount > 0) {
      const io = req.app.get("socket");
      if (io) {
        await emitPendingVipCount(io);
      }
    }

    if (guest.room) {
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
  getAccruedStayDays,
  getAccruedGuestAmounts,
  getGuestPayableAmount,
  getCompletedStayDays,
  buildContinuedGuestState,
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
  updateGuestPayment,
  addGuestService,
  checkoutGuest,
  continueGuestStay,
  checkoutGuestsBulk,
  deleteGuest,
};
