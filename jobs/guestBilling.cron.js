const moment = require("moment-timezone");
const mongoose = require("mongoose");
const Guest = require("../model/Guest");
const Room = require("../model/Room");
const {
  applyTimeToDate,
  calculateCheckoutDueAt,
  getHotelSettings,
  parseTime,
} = require("../utils/hotelSettings");
const {
  syncRoomsOccupancyByIds,
} = require("../utils/roomOccupancy");

const DAY_MS = 24 * 60 * 60 * 1000;
const APP_TIMEZONE = process.env.APP_TIMEZONE || "Asia/Tashkent";

const emitGuestChanged = (io, payload = {}) => {
  if (!io) return;
  io.emit("guest_updated", {
    ...payload,
    emittedAt: new Date(),
  });
};

// Mijozning billing holatini joriy vaqtga nisbatan hisoblaydi
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
  };
};

const syncAllRoomsOccupancy = async () => {
  const rooms = await Room.find({}).select("_id").lean();
  if (!rooms.length) return;
  await syncRoomsOccupancyByIds(rooms.map((room) => room._id));
};

const runActivateDueBookingsJob = async (io) => {
  const now = new Date();
  const dueBookings = await Guest.find({
    status: "booked",
    bookedForAt: { $lte: now },
  })
    .select("_id room stayDays dailyRate paidAmount vip bookedForAt")
    .sort({ bookedForAt: 1, createdAt: 1 })
    .lean();

  if (!dueBookings.length) return;

  const roomIds = [
    ...new Set(
      dueBookings
        .map((item) => String(item?.room || "").trim())
        .filter((id) => mongoose.Types.ObjectId.isValid(id)),
    ),
  ];
  if (!roomIds.length) return;
  const objectRoomIds = roomIds.map((id) => new mongoose.Types.ObjectId(id));

  const [hotelSettings, rooms, activeCounts] = await Promise.all([
    getHotelSettings(),
    Room.find({
      _id: { $in: objectRoomIds },
      status: { $ne: "remont" },
    })
      .select("_id capacity")
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

  const roomCapacityMap = new Map(
    rooms.map((room) => [String(room?._id || ""), Number(room?.capacity || 0)]),
  );
  const roomActiveMap = new Map(
    activeCounts.map((item) => [String(item?._id || ""), Number(item?.count || 0)]),
  );

  const ops = [];
  const affectedRoomIds = new Set();
  for (const guest of dueBookings) {
    const roomId = String(guest?.room || "");
    if (!roomCapacityMap.has(roomId)) continue;

    const capacity = Number(roomCapacityMap.get(roomId) || 0);
    const currentActive = Number(roomActiveMap.get(roomId) || 0);
    if (currentActive >= capacity) continue;

    const baseCheckInAt = guest.bookedForAt ? new Date(guest.bookedForAt) : now;
    const billing = buildBillingState(
      baseCheckInAt,
      guest.stayDays,
      now,
      hotelSettings,
    );
    const nextTotalAmount =
      Number(guest.dailyRate || 0) * Number(billing.billableDays || 1);
    const nextDebtAmount = guest.vip
      ? 0
      : Math.max(nextTotalAmount - Number(guest.paidAmount || 0), 0);

    ops.push({
      updateOne: {
        filter: { _id: guest._id, status: "booked" },
        update: {
          $set: {
            status: "active",
            checkInAt: baseCheckInAt,
            stayDays: billing.stayDays,
            billableDays: billing.billableDays,
            checkoutDueAt: billing.checkoutDueAt,
            checkoutReminderAt: billing.checkoutReminderAt,
            totalAmount: nextTotalAmount,
            debtAmount: nextDebtAmount,
          },
        },
      },
    });
    roomActiveMap.set(roomId, currentActive + 1);
    affectedRoomIds.add(roomId);
  }

  if (!ops.length) return;
  await Guest.bulkWrite(ops, { ordered: false });
  await syncRoomsOccupancyByIds([...affectedRoomIds]);
  emitGuestChanged(io, {
    reason: "guest_bookings_activated",
    count: ops.length,
    roomIds: [...affectedRoomIds],
  });
};

// Sozlamadagi checkout vaqtida active mijozlarning o'tib ketgan kunlarini avtomatik oshiradi
const runOverdueBillingJob = async (io) => {
  const now = new Date();
  const hotelSettings = await getHotelSettings();
  const guests = await Guest.find({
    status: "active",
    $or: [
      { checkoutDueAt: { $lte: now } },
      { checkoutDueAt: null },
      { checkoutReminderAt: null },
    ],
  })
    .select(
      "_id checkInAt stayDays billableDays dailyRate totalAmount paidAmount debtAmount vip checkoutDueAt checkoutReminderAt",
    )
    .lean();

  if (!guests.length) return;

  const ops = [];
  for (const guest of guests) {
    const billing = buildBillingState(
      guest.checkInAt,
      guest.stayDays,
      now,
      hotelSettings,
    );
    const nextTotalAmount =
      Number(guest.dailyRate || 0) * Number(billing.billableDays || 1);

    const changed =
      Number(guest.billableDays || 0) !== Number(billing.billableDays) ||
      Number(guest.totalAmount || 0) !== Number(nextTotalAmount) ||
      new Date(guest.checkoutDueAt || 0).getTime() !==
        billing.checkoutDueAt.getTime() ||
      new Date(guest.checkoutReminderAt || 0).getTime() !==
        billing.checkoutReminderAt.getTime();

    if (!changed) continue;

    const nextDebtAmount = guest.vip
      ? 0
      : Math.max(nextTotalAmount - Number(guest.paidAmount || 0), 0);
    ops.push({
      updateOne: {
        filter: { _id: guest._id },
        update: {
          $set: {
            billableDays: billing.billableDays,
            checkoutDueAt: billing.checkoutDueAt,
            checkoutReminderAt: billing.checkoutReminderAt,
            totalAmount: nextTotalAmount,
            debtAmount: nextDebtAmount,
          },
        },
      },
    });
  }

  if (ops.length) {
    await Guest.bulkWrite(ops, { ordered: false });
    emitGuestChanged(io, {
      reason: "guest_billing_synced",
      count: ops.length,
    });
  }
};

// Sozlamadagi ogohlantirish vaqtida active mijozlarni socketga yuboradi
const runReminderJob = async (io, targetDate) => {
  if (!io) return;

  const nowTz = targetDate ? moment(targetDate).tz(APP_TIMEZONE) : moment().tz(APP_TIMEZONE);
  const start = nowTz.clone().startOf("minute");
  const end = start.clone().add(1, "minute");

  const guests = await Guest.find({
    status: "active",
    checkoutReminderAt: { $gte: start.toDate(), $lt: end.toDate() },
  })
    .select("_id firstname lastname room checkoutReminderAt checkoutDueAt")
    .populate("room", "roomNumber floor");

  if (!guests.length) return;

  io.emit("guests_checkout_reminder", {
    type: "checkout_reminder",
    timezone: APP_TIMEZONE,
    count: guests.length,
    guests: guests.map((guest) => ({
      id: guest._id,
      fullname: `${guest.firstname} ${guest.lastname}`.trim(),
      roomNumber: guest.room?.roomNumber || "",
      floor: guest.room?.floor || null,
      checkoutReminderAt: guest.checkoutReminderAt,
      checkoutDueAt: guest.checkoutDueAt,
    })),
  });
};

const runAutomaticCheckoutJob = async (io, cutoffAt = new Date()) => {
  const cutoff = new Date(cutoffAt);
  const guests = await Guest.find({
    status: "active",
    checkoutDueAt: { $lte: cutoff },
  })
    .select("_id room checkoutDueAt")
    .lean();

  if (!guests.length) return;

  const roomIds = [];
  const ops = guests.map((guest) => {
    if (guest?.room) roomIds.push(String(guest.room));
    return {
      updateOne: {
        filter: { _id: guest._id, status: "active" },
        update: {
          $set: {
            status: "checked_out",
            checkOutAt: getAutomaticCheckoutAt(guest.checkoutDueAt, cutoff),
            checkoutBy: {
              userId: "system",
              role: "system",
              login: "system",
              firstname: "Auto",
              lastname: "Checkout",
            },
          },
        },
      },
    };
  });

  if (!ops.length) return;

  await Guest.bulkWrite(ops, { ordered: false });
  await syncRoomsOccupancyByIds(roomIds);
  await syncAllRoomsOccupancy();
  emitGuestChanged(io, {
    reason: "guest_auto_checked_out",
    count: ops.length,
    roomIds,
  });
};

const getAutomaticCheckoutAt = (checkoutDueAt, executedAt = new Date()) => {
  const scheduled = new Date(checkoutDueAt);
  if (!Number.isNaN(scheduled.getTime())) return scheduled;
  return new Date(executedAt);
};

const getAutomaticCheckoutWindow = (
  now = new Date(),
  checkoutTime = "12:00",
) => {
  const nowTz = moment(now).tz(APP_TIMEZONE);
  const checkout = parseTime(checkoutTime);
  const scheduledCheckout = nowTz
    .clone()
    .hour(checkout.hour)
    .minute(checkout.minute)
    .second(0)
    .millisecond(0);
  const nextMinute = nowTz.clone().add(1, "minute").startOf("minute");
  const isEarlyMinute =
    nextMinute.hour() === checkout.hour &&
    nextMinute.minute() === checkout.minute;
  const isExactMinute =
    nowTz.hour() === checkout.hour && nowTz.minute() === checkout.minute;
  const isDueOrPast =
    isExactMinute || nowTz.isAfter(scheduledCheckout);
  const cutoff = isEarlyMinute
    ? nextMinute
    : nowTz.clone();

  return {
    isEarlyMinute,
    isExactMinute,
    isDueOrPast,
    cutoffAt: cutoff.toDate(),
    key: `${cutoff.format("YYYY-MM-DD")}-${checkoutTime}`,
  };
};

// Har daqiqada tekshiradi va sozlamadagi vaqtlar bo'yicha vazifalarni bir martadan ishga tushiradi
const startGuestBillingCron = (io) => {
  const state = {
    reminderKey: "",
    overdueKey: "",
    checkoutKey: "",
    activating: false,
    overdueRunning: false,
    checkoutRunning: false,
  };

  const tick = async () => {
    try {
      const nowTz = moment().tz(APP_TIMEZONE);
      const dayKey = nowTz.format("YYYY-MM-DD");
      const hour = nowTz.hour();
      const minute = nowTz.minute();
      const hotelSettings = await getHotelSettings();
      const reminder = parseTime(hotelSettings.reminderTime);
      const automaticCheckout = getAutomaticCheckoutWindow(
        nowTz.toDate(),
        hotelSettings.checkoutTime,
      );

      if (hour === reminder.hour && minute === reminder.minute) {
        const reminderKey = `${dayKey}-${hotelSettings.reminderTime}`;
        if (state.reminderKey !== reminderKey) {
          state.reminderKey = reminderKey;
          await runReminderJob(io, nowTz.toDate());
        }
      }

      if (!state.activating) {
        state.activating = true;
        try {
          await runActivateDueBookingsJob(io);
        } finally {
          state.activating = false;
        }
      }

      // Belgilangan checkout vaqtidan bir daqiqa oldin avtomatik checkout
      // qilamiz. checkOutAt baribir rejalashtirilgan checkoutDueAt bo'lib qoladi.
      if (
        automaticCheckout.isEarlyMinute &&
        state.checkoutKey !== automaticCheckout.key &&
        !state.checkoutRunning
      ) {
        state.checkoutRunning = true;
        try {
          await runAutomaticCheckoutJob(io, automaticCheckout.cutoffAt);
          state.checkoutKey = automaticCheckout.key;
        } finally {
          state.checkoutRunning = false;
        }
      }

      if (automaticCheckout.isDueOrPast && !automaticCheckout.isEarlyMinute) {
        const overdueKey = automaticCheckout.key;

        // 11:59 trigger o'tmay qolsa, 12:00 da ham avval checkout qilinadi.
        // Shundan keyingina overdue hisoblash ishlaydi va ortiqcha kun yozilmaydi.
        if (state.checkoutKey !== overdueKey && !state.checkoutRunning) {
          state.checkoutRunning = true;
          try {
            await runAutomaticCheckoutJob(io, nowTz.toDate());
            state.checkoutKey = overdueKey;
          } finally {
            state.checkoutRunning = false;
          }
        }

        if (state.overdueKey !== overdueKey && !state.overdueRunning) {
          state.overdueRunning = true;
          state.overdueKey = overdueKey;
          try {
            await runOverdueBillingJob(io);
          } finally {
            state.overdueRunning = false;
          }
        }

      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Guest billing cron error:", error.message);
    }
  };

  // Server yoqilganda ham checkout overdue hisobidan oldin ishlashi shart.
  // Aks holda server 12:00 dan bir necha soniya keyin ishga tushsa,
  // chiqayotgan mijozga ortiqcha kun yozilishi mumkin.
  const runStartupJobs = async () => {
    await runActivateDueBookingsJob(io);
    await runAutomaticCheckoutJob(io);
    await runOverdueBillingJob(io);
  };
  runStartupJobs().catch((error) => {
    // eslint-disable-next-line no-console
    console.error("Guest billing startup error:", error.message);
  });
  // Har 30 sekundda vaqt triggerini tekshiradi
  const interval = setInterval(tick, 30 * 1000);
  return interval;
};

module.exports = {
  getAutomaticCheckoutAt,
  getAutomaticCheckoutWindow,
  startGuestBillingCron,
};
