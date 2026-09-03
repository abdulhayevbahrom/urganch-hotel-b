const GroupBooking = require("../model/GroupBooking");
const Guest = require("../model/Guest");
const Room = require("../model/Room");
const VipRequest = require("../model/VipRequest");
const response = require("../utils/response");
const { syncRoomsOccupancyByIds } = require("../utils/roomOccupancy");
const { getHotelSettings, applyTimeToDate } = require("../utils/hotelSettings");

const parseBookingStart = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(12, 0, 0, 0);
  return date;
};

const buildBookingEnd = (start, stayDays, checkoutTime) => {
  const end = applyTimeToDate(start, checkoutTime || "12:00");
  end.setDate(end.getDate() + Math.max(Number(stayDays || 1), 1));
  return end;
};

const createGroupBooking = async (req, res) => {
  let group = null;
  try {
    const assignments = req.body.roomAssignments || [];
    const roomIds = assignments.map((item) => item.room);
    if (new Set(roomIds).size !== roomIds.length) {
      return response.error(res, "Bir xona guruhga faqat bir marta tanlanadi");
    }

    const bookedForAt = parseBookingStart(req.body.bookedForDate);
    if (!bookedForAt) return response.error(res, "Bron sanasi noto'g'ri");
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (bookedForAt < today) {
      return response.error(res, "Bron sanasi bugundan oldin bo'lishi mumkin emas");
    }

    const passports = assignments
      .flatMap((item) => item.guests)
      .map((guest) => String(guest.passport || "").trim())
      .filter(Boolean);
    if (passports.length) {
      const blacklistedGuest = await Guest.findOne({
        passport: { $in: passports.map((passport) => new RegExp(`^${passport.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i")) },
        isBlacklisted: true,
      }).lean();
      if (blacklistedGuest) {
        return response.error(
          res,
          `${blacklistedGuest.firstname} ${blacklistedGuest.lastname} qora ro'yxatda`,
        );
      }
    }

    const settings = await getHotelSettings();
    const stayDays = Math.max(Number(req.body.stayDays || 1), 1);
    const checkoutDueAt = buildBookingEnd(
      bookedForAt,
      stayDays,
      settings.checkoutTime,
    );
    const rooms = await Room.find({ _id: { $in: roomIds } }).lean();
    if (rooms.length !== roomIds.length) {
      return response.error(res, "Tanlangan xonalardan biri topilmadi");
    }

    const roomMap = new Map(rooms.map((room) => [String(room._id), room]));
    for (const assignment of assignments) {
      const room = roomMap.get(String(assignment.room));
      if (room.status === "remont") {
        return response.error(res, `${room.roomNumber}-xona remont holatida`);
      }
      if (assignment.guests.length > Number(room.capacity || 0)) {
        return response.error(
          res,
          `${room.roomNumber}-xonada ${room.capacity} tadan ko'p joy yo'q`,
        );
      }
    }

    const conflict = await Guest.findOne({
      room: { $in: roomIds },
      status: { $in: ["active", "booked"] },
      checkInAt: { $lt: checkoutDueAt },
      checkoutDueAt: { $gt: bookedForAt },
    })
      .populate("room", "roomNumber korpus")
      .lean();
    if (conflict) {
      return response.error(
        res,
        `${conflict.room?.roomNumber || "Tanlangan"}-xonada shu muddatda bron yoki bandlik bor`,
      );
    }

    group = await GroupBooking.create({
      name: req.body.name,
      phone: req.body.phone || "",
      email: req.body.email || "",
      bookedForAt,
      stayDays,
      dailyRate: Number(req.body.dailyRate || 0),
      mainPaymentType: req.body.mainPaymentType || "naqd",
      note: req.body.note || "",
      rooms: roomIds,
      createdBy: {
        userId: String(req.admin?.id || ""),
        role: String(req.admin?.role || ""),
        login: String(req.admin?.login || ""),
      },
    });

    const guestDocs = assignments.flatMap((assignment) =>
      assignment.guests.map((guest) => ({
        ...guest,
        firstname: String(guest.firstname || req.body.name || "Guruh").trim(),
        lastname: String(guest.lastname || "-").trim(),
        group: group._id,
        room: assignment.room,
        stayDays,
        billableDays: stayDays,
        dailyRate: Number(req.body.dailyRate || 0),
        mainPaymentType: req.body.mainPaymentType || "naqd",
        totalAmount: Number(req.body.dailyRate || 0) * stayDays,
        paidAmount: 0,
        debtAmount: Number(req.body.dailyRate || 0) * stayDays,
        status: "booked",
        bookedForAt,
        checkInAt: bookedForAt,
        checkoutDueAt,
        checkoutReminderAt: applyTimeToDate(
          checkoutDueAt,
          settings.reminderTime || "12:00",
        ),
        note: guest.note || req.body.note || "",
      })),
    );
    const guests = await Guest.insertMany(guestDocs, { ordered: true });
    group.guests = guests.map((guest) => guest._id);
    await group.save();

    req.app.get("socket")?.emit("guest_updated", {
      reason: "group_booking_created",
      groupId: String(group._id),
      guestIds: guests.map((guest) => String(guest._id)),
    });
    const populated = await GroupBooking.findById(group._id)
      .populate("rooms", "roomNumber floor korpus category capacity")
      .populate("guests", "firstname lastname status dailyRate room")
      .lean();
    return response.created(res, "Guruh muvaffaqiyatli bron qilindi", populated);
  } catch (error) {
    if (group?._id) {
      try {
        await Guest.deleteMany({ group: group._id });
        await GroupBooking.findByIdAndDelete(group._id);
      } catch (cleanupError) {
        // Asosiy saqlash xatosi klientga qaytishi uchun rollback xatosini yutamiz.
      }
    }
    return response.serverError(res, error.message);
  }
};

const getGroupBookings = async (req, res) => {
  try {
    const tab = String(req.query.tab || "active");
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);
    const groups = await GroupBooking.find()
      .populate("rooms", "roomNumber floor korpus category capacity")
      .populate(
        "guests",
        "firstname lastname passport birthDate phone email note status vip dailyRate totalAmount paidAmount debtAmount room checkInAt checkOutAt",
      )
      .sort({ bookedForAt: -1, createdAt: -1 })
      .lean();

    const filteredItems = groups
      .map((group) => {
        const liveGuests = (group.guests || []).filter(Boolean);
        const statuses = liveGuests.map((guest) => guest.status);
        const isHistory = statuses.length === 0 || statuses.every((status) => status === "checked_out");
        return {
          ...group,
          guests: liveGuests,
          totalAmount: liveGuests.reduce(
            (sum, guest) => sum + Number(guest.totalAmount || 0),
            0,
          ),
          paidAmount: liveGuests.reduce(
            (sum, guest) => sum + Number(guest.paidAmount || 0),
            0,
          ),
          debtAmount: liveGuests.reduce(
            (sum, guest) => sum + Number(guest.debtAmount || 0),
            0,
          ),
          status: isHistory ? "history" : "active",
        };
      })
      .filter((group) => group.status === (tab === "history" ? "history" : "active"));
    const total = filteredItems.length;
    const totalPages = Math.max(Math.ceil(total / limit), 1);
    const items = filteredItems.slice((page - 1) * limit, page * limit);

    return response.success(res, "Guruhlar ro'yxati", {
      items,
      pagination: { page, limit, total, totalPages },
    });
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const addGroupPayment = async (req, res) => {
  try {
    const group = await GroupBooking.findById(req.params.id);
    if (!group) return response.notFound(res, "Guruh topilmadi");

    const guests = await Guest.find({ group: group._id, vip: { $ne: true } });
    if (!guests.length) {
      return response.error(res, "Guruhda to'lov olinadigan mehmon yo'q");
    }

    const amount = Number(req.body.amount || 0);
    const groupDebt = guests.reduce(
      (sum, guest) => sum + Number(guest.debtAmount || 0),
      0,
    );
    if (amount > groupDebt) {
      return response.error(
        res,
        `To'lov guruh qarzidan oshmasligi kerak (${groupDebt.toLocaleString()} so'm)`,
      );
    }

    const baseShare = Math.floor(amount / guests.length);
    let remainder = amount - baseShare * guests.length;
    for (const guest of guests) {
      const share = baseShare + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder -= 1;
      guest.payments.push({
        amount: share,
        type: req.body.type,
        note: req.body.note || `Guruh to'lovi: ${group.name}`,
      });
      guest.paidAmount = Number(guest.paidAmount || 0) + share;
      guest.debtAmount = Math.max(
        Number(guest.totalAmount || 0) - guest.paidAmount,
        0,
      );
      await guest.save();
    }

    group.payments.push({
      amount,
      type: req.body.type,
      note: req.body.note || "",
    });
    await group.save();

    req.app.get("socket")?.emit("guest_updated", {
      reason: "group_payment_added",
      groupId: String(group._id),
      amount,
    });
    return response.success(res, "Guruh to'lovi qabul qilindi", {
      amount,
      guestCount: guests.length,
      remainingDebt: Math.max(groupDebt - amount, 0),
    });
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const updateGroupBooking = async (req, res) => {
  try {
    const group = await GroupBooking.findById(req.params.id);
    if (!group) return response.notFound(res, "Guruh topilmadi");

    const allowedFields = [
      "name",
      "phone",
      "email",
      "dailyRate",
      "mainPaymentType",
      "note",
    ];
    allowedFields.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        group[field] = req.body[field];
      }
    });
    await group.save();

    const guestUpdates = {};
    if (Object.prototype.hasOwnProperty.call(req.body, "mainPaymentType")) {
      guestUpdates.mainPaymentType = req.body.mainPaymentType;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "dailyRate")) {
      const guests = await Guest.find({ group: group._id });
      for (const guest of guests) {
        guest.dailyRate = Number(req.body.dailyRate || 0);
        guest.totalAmount =
          guest.dailyRate * Math.max(Number(guest.billableDays || guest.stayDays || 1), 1);
        guest.debtAmount = guest.vip
          ? 0
          : Math.max(guest.totalAmount - Number(guest.paidAmount || 0), 0);
        if (guestUpdates.mainPaymentType) {
          guest.mainPaymentType = guestUpdates.mainPaymentType;
        }
        await guest.save();
      }
    } else if (Object.keys(guestUpdates).length) {
      await Guest.updateMany({ group: group._id }, { $set: guestUpdates });
    }

    req.app.get("socket")?.emit("guest_updated", {
      reason: "group_booking_updated",
      groupId: String(group._id),
    });
    return response.success(res, "Guruh ma'lumotlari yangilandi", group);
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const syncGroupRooms = async (roomIds) => {
  await syncRoomsOccupancyByIds(roomIds);
};

const deleteGroupBooking = async (req, res) => {
  try {
    const group = await GroupBooking.findById(req.params.id).lean();
    if (!group) return response.notFound(res, "Guruh topilmadi");

    const guests = await Guest.find({ group: group._id }).select("_id room").lean();
    const guestIds = guests.map((guest) => guest._id);
    const roomIds = guests.map((guest) => guest.room).filter(Boolean);
    await VipRequest.deleteMany({ guest: { $in: guestIds } });
    await Guest.deleteMany({ group: group._id });
    await GroupBooking.deleteOne({ _id: group._id });
    await syncGroupRooms(roomIds);

    req.app.get("socket")?.emit("guest_updated", {
      reason: "group_booking_deleted",
      groupId: String(group._id),
      roomIds: roomIds.map(String),
    });
    return response.success(res, "Guruh va uning mehmonlari o'chirildi");
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

module.exports = {
  createGroupBooking,
  getGroupBookings,
  updateGroupBooking,
  deleteGroupBooking,
  addGroupPayment,
};
