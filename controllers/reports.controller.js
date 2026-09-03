const moment = require("moment-timezone");
const Guest = require("../model/Guest");
const Expense = require("../model/Expense");
const Room = require("../model/Room");
const Employee = require("../model/Employee");
const Service = require("../model/Service");
const VipRequest = require("../model/VipRequest");
const HallBooking = require("../model/HallBooking");
const response = require("../utils/response");
const { getDailyRateForDay, getLodgingTotal } = require("../utils/guestDailyRates");

const TIMEZONE = process.env.APP_TIMEZONE || "Asia/Tashkent";
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

const getReportDay = (dateQuery) => {
  const value = String(dateQuery || "");
  if (!DATE_PATTERN.test(value)) return null;

  const day = moment.tz(value, "YYYY-MM-DD", true, TIMEZONE);
  return day.isValid() && day.format("YYYY-MM-DD") === value ? day : null;
};

const getMonthBase = (monthQuery) => {
  if (MONTH_PATTERN.test(String(monthQuery || ""))) {
    return moment.tz(`${monthQuery}-01`, "YYYY-MM-DD", TIMEZONE).startOf("month");
  }
  return moment.tz(TIMEZONE).startOf("month");
};

const compareRoomRows = (a, b) => {
  const korpusA = String(a?.korpus || "").trim();
  const korpusB = String(b?.korpus || "").trim();
  const korpusCompare = korpusA.localeCompare(korpusB, "uz", {
    numeric: true,
    sensitivity: "base",
  });
  if (korpusCompare !== 0) return korpusCompare;

  const roomA = String(a?.roomNumber || "").trim();
  const roomB = String(b?.roomNumber || "").trim();
  const roomNumericA = Number(roomA);
  const roomNumericB = Number(roomB);
  const roomAIsNumeric = Number.isFinite(roomNumericA) && roomA !== "";
  const roomBIsNumeric = Number.isFinite(roomNumericB) && roomB !== "";
  if (roomAIsNumeric && roomBIsNumeric && roomNumericA !== roomNumericB) {
    return roomNumericA - roomNumericB;
  }

  return roomA.localeCompare(roomB, "uz", {
    numeric: true,
    sensitivity: "base",
  });
};

const splitBalance = (balance) => ({
  prepayment: Math.max(0, balance),
  debt: Math.max(0, -balance),
});

const getOperationalDay = (date) => {
  const localDate = moment(date).tz(TIMEZONE);
  if (localDate.hour() < 12) localDate.subtract(1, "day");
  return localDate.startOf("day");
};

const calculateDailyGuestBalance = ({ guest, reportDay, dayStart, nextDayStart, dailyRate }) => {
  const checkInOperationalDay = getOperationalDay(guest.checkInAt || dayStart);
  const previousBillableDays = Math.max(
    0,
    reportDay.clone().startOf("day").diff(checkInOperationalDay, "day"),
  );
  const payments = (guest.payments || []).reduce(
    (totals, payment) => {
      const createdAt = new Date(payment.createdAt);
      const amount = Number(payment.amount || 0);
      if (Number.isNaN(createdAt.getTime()) || createdAt >= nextDayStart) return totals;

      if (createdAt < dayStart) {
        totals.beforeDay += amount;
        return totals;
      }

      const type = String(payment.type || "").toLowerCase();
      if (type === "naqd" || type === "cash") totals.cash += amount;
      else if (type === "karta" || type === "card" || type === "click") totals.card += amount;
      else if (type === "bank" || type === "transfer") totals.transfer += amount;
      return totals;
    },
    { beforeDay: 0, cash: 0, card: 0, transfer: 0 },
  );

  const billableGuest = { ...guest, dailyRate };
  const currentDayRate = getDailyRateForDay(
    billableGuest,
    previousBillableDays + 1,
  );
  const previousLodgingAmount = previousBillableDays
    ? getLodgingTotal(billableGuest, previousBillableDays)
    : 0;
  const opening = splitBalance(payments.beforeDay - previousLodgingAmount);
  const todayPayments = payments.cash + payments.card + payments.transfer;
  const closing = splitBalance(
    opening.prepayment - opening.debt + todayPayments - currentDayRate,
  );

  return { opening, closing, payments };
};

const getDailyActiveGuestFilter = ({ dayStart, nextDayStart }) => ({
  checkInAt: { $lt: nextDayStart },
  $or: [
    { status: "active" },
    // Occupancy intervals are half-open: a checkout exactly at dayStart
    // belongs to the previous operational day, not the new one.
    { status: "checked_out", checkOutAt: { $gt: dayStart } },
  ],
});

const getReportsSummary = async (req, res) => {
  try {
    const base = getMonthBase(req.query.month);
    const monthKey = base.format("YYYY-MM");
    const monthStart = base.clone().startOf("month");
    const nextMonthStart = base.clone().add(1, "month").startOf("month");

    const [paymentsAgg = {}, expensesAgg = {}, roomStatusAgg = {}, bookingStats = {}, hallStats = {}, servicesAgg = {}, guestStats = {}, blacklistedCount, vipPendingCount, loyalGuestsCount, activeEmployees, activeServices] =
      await Promise.all([
        Guest.aggregate([
          { $unwind: "$payments" },
          {
            $match: {
              "payments.createdAt": {
                $gte: monthStart.toDate(),
                $lt: nextMonthStart.toDate(),
              },
            },
          },
          {
            $lookup: {
              from: "rooms",
              localField: "room",
              foreignField: "_id",
              as: "roomDoc",
            },
          },
          {
            $unwind: {
              path: "$roomDoc",
              preserveNullAndEmptyArrays: true,
            },
          },
          {
            $facet: {
              totals: [
                {
                  $group: {
                    _id: null,
                    count: { $sum: 1 },
                    totalAmount: { $sum: { $ifNull: ["$payments.amount", 0] } },
                  },
                },
              ],
              byRoom: [
                {
                  $group: {
                    _id: "$roomDoc.roomNumber",
                    totalAmount: { $sum: { $ifNull: ["$payments.amount", 0] } },
                  },
                },
                { $sort: { totalAmount: -1 } },
              ],
              byCategory: [
                {
                  $group: {
                    _id: "$roomDoc.category",
                    totalAmount: { $sum: { $ifNull: ["$payments.amount", 0] } },
                  },
                },
                { $sort: { totalAmount: -1 } },
              ],
            },
          },
        ]).then((result) => result?.[0] || {}),
        Expense.aggregate([
          {
            $match: {
              spentAt: {
                $gte: monthStart.toDate(),
                $lt: nextMonthStart.toDate(),
              },
            },
          },
          {
            $facet: {
              totals: [
                {
                  $group: {
                    _id: null,
                    totalAmount: { $sum: { $ifNull: ["$amount", 0] } },
                    categoriesCount: { $addToSet: "$category" },
                  },
                },
              ],
            },
          },
        ]).then((result) => result?.[0] || {}),
        Room.aggregate([
          {
            $group: {
              _id: "$status",
              count: { $sum: 1 },
            },
          },
          {
            $group: {
              _id: null,
              total: { $sum: "$count" },
              byStatus: {
                $push: {
                  k: "$_id",
                  v: "$count",
                },
              },
            },
          },
          {
            $project: {
              _id: 0,
              total: 1,
              byStatus: { $arrayToObject: "$byStatus" },
            },
          },
        ]).then((result) => result?.[0] || {}),
        Guest.aggregate([
          {
            $facet: {
              booked: [
                {
                  $match: {
                    status: "booked",
                    bookedForAt: {
                      $gte: monthStart.toDate(),
                      $lt: nextMonthStart.toDate(),
                    },
                  },
                },
                { $count: "count" },
              ],
              overdue: [
                {
                  $match: {
                    status: "active",
                    checkoutDueAt: { $lt: new Date() },
                  },
                },
                {
                  $group: {
                    _id: null,
                    count: { $sum: 1 },
                    totalDebt: { $sum: { $ifNull: ["$debtAmount", 0] } },
                  },
                },
              ],
            },
          },
        ]).then((result) => result?.[0] || {}),
        HallBooking.aggregate([
          {
            $match: {
              createdAt: {
                $gte: monthStart.toDate(),
                $lt: nextMonthStart.toDate(),
              },
            },
          },
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              totalAmount: { $sum: { $ifNull: ["$totalAmount", 0] } },
              totalDebt: { $sum: { $ifNull: ["$debtAmount", 0] } },
            },
          },
        ]).then((result) => result?.[0] || {}),
        Guest.aggregate([
          { $unwind: "$services" },
          {
            $match: {
              "services.usedAt": {
                $gte: monthStart.toDate(),
                $lt: nextMonthStart.toDate(),
              },
            },
          },
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              totalAmount: { $sum: { $ifNull: ["$services.totalAmount", 0] } },
            },
          },
        ]).then((result) => result?.[0] || {}),
        Guest.aggregate([
          {
            $facet: {
              arrived: [
                {
                  $match: {
                    checkInAt: {
                      $gte: monthStart.toDate(),
                      $lt: nextMonthStart.toDate(),
                    },
                  },
                },
                { $count: "count" },
              ],
              left: [
                {
                  $match: {
                    checkOutAt: {
                      $gte: monthStart.toDate(),
                      $lt: nextMonthStart.toDate(),
                    },
                  },
                },
                { $count: "count" },
              ],
              debtors: [
                { $match: { debtAmount: { $gt: 0 } } },
                {
                  $group: {
                    _id: null,
                    count: { $sum: 1 },
                    totalDebt: { $sum: { $ifNull: ["$debtAmount", 0] } },
                    over7Days: {
                      $sum: {
                        $cond: [
                          {
                            $lt: [
                              "$checkInAt",
                              moment().tz(TIMEZONE).subtract(7, "days").toDate(),
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                    },
                  },
                },
              ],
              vip: [
                { $match: { vip: true } },
                { $count: "count" },
              ],
            },
          },
        ]).then((result) => result?.[0] || {}),
        Guest.countDocuments({ isBlacklisted: true }),
        VipRequest.countDocuments({ status: "pending" }),
        Guest.aggregate([
          {
            $group: {
              _id: "$passport",
              visits: { $sum: 1 },
            },
          },
          {
            $match: {
              _id: { $nin: [null, ""] },
              visits: { $gt: 1 },
            },
          },
          { $count: "count" },
        ]).then((result) => Number(result?.[0]?.count || 0)),
        Employee.countDocuments({ isActive: true }),
        Service.countDocuments({ isActive: true }),
      ]);

    const paymentTotals = paymentsAgg?.totals?.[0] || {};
    const topRoom = paymentsAgg?.byRoom?.[0] || {};
    const topCategory = paymentsAgg?.byCategory?.[0] || {};
    const expenseTotals = expensesAgg?.totals?.[0] || {};
    const occupiedRooms = Number(roomStatusAgg?.byStatus?.band || 0);
    const totalRooms = Number(roomStatusAgg?.total || 0);
    const occupancyPercent =
      totalRooms > 0
        ? Number(((occupiedRooms / totalRooms) * 100).toFixed(1))
        : 0;
    const bookedCount = Number(bookingStats?.booked?.[0]?.count || 0);
    const overdue = bookingStats?.overdue?.[0] || {};
    const arrivedCount = Number(guestStats?.arrived?.[0]?.count || 0);
    const leftCount = Number(guestStats?.left?.[0]?.count || 0);
    const debtors = guestStats?.debtors?.[0] || {};
    const vipCount = Number(guestStats?.vip?.[0]?.count || 0);

    return response.success(res, "Hisobotlar summary ma'lumotlari", {
      month: monthKey,
      timezone: TIMEZONE,
      generatedAt: new Date().toISOString(),
      sections: {
        finance: {
          paymentRegistry: {
            count: Number(paymentTotals?.count || 0),
            totalAmount: Number(paymentTotals?.totalAmount || 0),
          },
          roomRevenue: {
            activeRoomsCount: Number(paymentsAgg?.byRoom?.length || 0),
            topRoomNumber: topRoom?._id || "-",
            topRoomAmount: Number(topRoom?.totalAmount || 0),
          },
          categoryRevenue: {
            categoriesCount: Number(paymentsAgg?.byCategory?.length || 0),
            topCategory: topCategory?._id || "-",
            topCategoryAmount: Number(topCategory?.totalAmount || 0),
          },
          profitLoss: {
            revenue: Number(paymentTotals?.totalAmount || 0),
            expense: Number(expenseTotals?.totalAmount || 0),
            net:
              Number(paymentTotals?.totalAmount || 0) -
              Number(expenseTotals?.totalAmount || 0),
          },
          expenseBreakdown: {
            totalAmount: Number(expenseTotals?.totalAmount || 0),
            categoriesCount: Number(expenseTotals?.categoriesCount?.length || 0),
          },
        },
        operations: {
          occupancyHistory: {
            occupancyPercent,
            occupiedRooms,
            totalRooms,
          },
          bookings: {
            count: bookedCount,
          },
          checkoutDelays: {
            count: Number(overdue?.count || 0),
            totalDebt: Number(overdue?.totalDebt || 0),
          },
          hallBookings: {
            count: Number(hallStats?.count || 0),
            totalAmount: Number(hallStats?.totalAmount || 0),
            totalDebt: Number(hallStats?.totalDebt || 0),
          },
        },
        guests: {
          guestFlow: {
            arrived: arrivedCount,
            left: leftCount,
          },
          debtAging: {
            count: Number(debtors?.count || 0),
            totalDebt: Number(debtors?.totalDebt || 0),
            over7Days: Number(debtors?.over7Days || 0),
          },
          vipGuests: {
            count: vipCount,
            pendingRequests: Number(vipPendingCount || 0),
          },
          blacklist: {
            count: Number(blacklistedCount || 0),
          },
          loyalGuests: {
            repeatGuests: Number(loyalGuestsCount || 0),
          },
        },
        extra: {
          servicesRevenue: {
            count: Number(servicesAgg?.count || 0),
            totalAmount: Number(servicesAgg?.totalAmount || 0),
            activeServices: Number(activeServices || 0),
          },
          employeeActivity: {
            activeEmployees: Number(activeEmployees || 0),
          },
        },
      },
    });
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const getDailyReport = async (req, res) => {
  try {
    const day = getReportDay(req.query.date);
    if (!day) {
      return response.error(res, "Sana YYYY-MM-DD formatida bo'lishi kerak");
    }

    const today = moment.tz(TIMEZONE).startOf("day");
    if (day.isAfter(today, "day")) {
      return response.error(res, "Kelajak sanasi uchun hisobot olib bo'lmaydi");
    }

    // Hotel daily reports follow the operational day: 12:00 to 12:00.
    const dayStart = day.clone().hour(12).minute(0).second(0).millisecond(0).toDate();
    const nextDayStart = day.clone().add(1, "day").hour(12).minute(0).second(0).millisecond(0).toDate();

    const [guestPaymentRows, hallPaymentRows, expenses, servicesAgg, activeGuests, totalRooms] =
      await Promise.all([
        Guest.aggregate([
          { $unwind: "$payments" },
          { $match: { "payments.createdAt": { $gte: dayStart, $lt: nextDayStart } } },
          { $lookup: { from: "rooms", localField: "room", foreignField: "_id", as: "roomDoc" } },
          { $unwind: { path: "$roomDoc", preserveNullAndEmptyArrays: true } },
          { $sort: { "payments.createdAt": 1 } },
          { $project: {
            _id: 0,
            amount: { $ifNull: ["$payments.amount", 0] },
            type: "$payments.type",
            createdAt: "$payments.createdAt",
            source: {
              $concat: [
                "Xona ", { $ifNull: ["$roomDoc.roomNumber", "-"] }, " - ",
                { $ifNull: ["$firstname", ""] }, " ", { $ifNull: ["$lastname", ""] },
              ],
            },
          } },
        ]),
        HallBooking.aggregate([
          { $unwind: "$payments" },
          { $match: { "payments.createdAt": { $gte: dayStart, $lt: nextDayStart } } },
          { $sort: { "payments.createdAt": 1 } },
          { $project: {
            _id: 0,
            amount: { $ifNull: ["$payments.amount", 0] },
            type: "$payments.type",
            createdAt: "$payments.createdAt",
            source: { $concat: [{ $ifNull: ["$hallName", "Zal"] }, " - ", { $ifNull: ["$eventName", ""] }] },
          } },
        ]),
        Expense.find({ spentAt: { $gte: dayStart, $lt: nextDayStart } })
          .select("title category amount paymentType spentAt")
          .sort({ spentAt: 1 })
          .lean(),
        Guest.aggregate([
          { $unwind: "$services" },
          { $match: { "services.usedAt": { $gte: dayStart, $lt: nextDayStart } } },
          { $group: { _id: null, totalAmount: { $sum: { $ifNull: ["$services.totalAmount", 0] } } } },
        ]).then((rows) => rows?.[0] || {}),
        Guest.find(getDailyActiveGuestFilter({ dayStart, nextDayStart }))
          .populate("room", "roomNumber floor korpus capacity activeGuestsCount category prices status")
          .select(
            "firstname lastname organization room stayDays billableDays dailyRate dailyRates totalAmount paidAmount debtAmount payments status vip checkInAt checkOutAt checkoutDueAt",
          )
          .sort({ "room.roomNumber": 1, createdAt: 1 })
          .lean(),
        Room.countDocuments({ createdAt: { $lt: nextDayStart } }),
      ]);

    const payments = [...guestPaymentRows, ...hallPaymentRows]
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const paymentTotals = payments.reduce(
      (totals, payment) => {
        const amount = Number(payment.amount || 0);
        totals.total += amount;
        totals[payment.type] = Number(totals[payment.type] || 0) + amount;
        return totals;
      },
      { total: 0, naqd: 0, karta: 0, click: 0, bank: 0 },
    );
    const expenseTotal = expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const activeGuestRows = activeGuests.map((guest) => {
      const roomDoc = guest.room || {};
      const fullName = `${guest.firstname || ""} ${guest.lastname || ""}`.trim();
      const baseDailyRate = Number(guest.dailyRate || roomDoc.prices?.oddiy || 0);
      const checkInOperationalDay = getOperationalDay(guest.checkInAt || dayStart);
      const dayNumber = Math.max(
        1,
        day.clone().startOf("day").diff(checkInOperationalDay, "day") + 1,
      );
      const dailyRate = guest.vip
        ? 0
        : getDailyRateForDay({ ...guest, dailyRate: baseDailyRate }, dayNumber);
      const balance = calculateDailyGuestBalance({
        guest,
        reportDay: day,
        dayStart,
        nextDayStart,
        dailyRate,
      });
      return {
        roomId: roomDoc._id,
        roomNumber: roomDoc.roomNumber || "-",
        floor: roomDoc.floor || "-",
        korpus: roomDoc.korpus || "-",
        organization: String(guest.organization || "").trim(),
        guestCount: 1,
        dailyRate,
        breakfast: 0,
        openingPrepayment: balance.opening.prepayment,
        openingDebt: balance.opening.debt,
        cash: balance.payments.cash,
        card: balance.payments.card,
        transfer: balance.payments.transfer,
        fullName,
        closingPrepayment: balance.closing.prepayment,
        closingDebt: balance.closing.debt,
      };
    });
    const groupedGuestRows = Array.from(
      activeGuestRows.reduce((rooms, guest) => {
        const key = String(guest.roomId || guest.roomNumber || "");
        const current = rooms.get(key);
        if (!current) {
          rooms.set(key, { ...guest, fullName: [guest.fullName] });
          return rooms;
        }
        current.fullName.push(guest.fullName);
        current.guestCount += guest.guestCount;
        current.openingPrepayment += guest.openingPrepayment;
        current.openingDebt += guest.openingDebt;
        current.cash += guest.cash;
        current.card += guest.card;
        current.transfer += guest.transfer;
        current.closingPrepayment += guest.closingPrepayment;
        current.closingDebt += guest.closingDebt;
        current.dailyRate += guest.dailyRate;
        current.organization = current.organization || guest.organization;
        return rooms;
      }, new Map()).values(),
    ).map((guest) => ({
      ...guest,
      fullName: guest.fullName.filter(Boolean).join("\n"),
    })).sort(compareRoomRows);
    const occupiedRooms = groupedGuestRows.length;
    const arrivals = await Guest.countDocuments({ checkInAt: { $gte: dayStart, $lt: nextDayStart } });
    const departures = await Guest.countDocuments({ checkOutAt: { $gte: dayStart, $lt: nextDayStart } });

    return response.success(res, "Kunlik hisobot ma'lumotlari", {
      date: day.format("YYYY-MM-DD"),
      timezone: TIMEZONE,
      generatedAt: new Date().toISOString(),
      revenue: {
        total: paymentTotals.total,
        room: guestPaymentRows.reduce((sum, item) => sum + Number(item.amount || 0), 0),
        services: Number(servicesAgg.totalAmount || 0),
        hall: hallPaymentRows.reduce((sum, item) => sum + Number(item.amount || 0), 0),
      },
      expenses: {
        total: expenseTotal,
        items: expenses.map((item) => ({
          title: item.title,
          category: item.category,
          amount: Number(item.amount || 0),
          paymentType: item.paymentType,
        })),
      },
      balance: paymentTotals.total - expenseTotal,
      paymentTypes: {
        cash: paymentTotals.naqd,
        card: paymentTotals.karta + paymentTotals.click,
        transfer: paymentTotals.bank,
      },
      operations: {
        occupiedRooms,
        availableRooms: Math.max(0, Number(totalRooms || 0) - occupiedRooms),
        arrivals,
        departures,
        guests: activeGuests.length,
      },
      debt: {
        debtors: groupedGuestRows.filter((row) => row.closingDebt > 0).length,
        total: groupedGuestRows.reduce((sum, row) => sum + row.closingDebt, 0),
      },
      guests: groupedGuestRows,
    });
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

module.exports = {
  calculateDailyGuestBalance,
  getDailyActiveGuestFilter,
  getDailyReport,
  getReportsSummary,
};
