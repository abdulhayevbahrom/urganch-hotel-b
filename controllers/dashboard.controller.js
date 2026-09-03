const moment = require("moment-timezone");
const Guest = require("../model/Guest");
const Expense = require("../model/Expense");
const Room = require("../model/Room");
const response = require("../utils/response");
const { getDailyRateForDay } = require("../utils/guestDailyRates");
const { getHotelSettings, parseTime } = require("../utils/hotelSettings");

const TIMEZONE = process.env.APP_TIMEZONE || "Asia/Tashkent";
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const WEEKDAY_LABELS = ["Yak", "Dush", "Sesh", "Chor", "Pay", "Ju", "Shan"];
const PAYMENT_TYPES = [
  { type: "naqd", label: "Naqd pul" },
  { type: "karta", label: "Plastik karta" },
  { type: "bank", label: "Bank o'tkazma" },
];

const formatChange = (current, previous) => {
  const curr = Number(current || 0);
  const prev = Number(previous || 0);

  if (prev <= 0 && curr <= 0) return { percent: 0, up: true };
  if (prev <= 0 && curr > 0) return { percent: 100, up: true };

  const percent = Math.abs(((curr - prev) / prev) * 100);
  return {
    percent: Number(percent.toFixed(1)),
    up: curr >= prev,
  };
};

const getMonthBase = (monthQuery) => {
  if (MONTH_PATTERN.test(String(monthQuery || ""))) {
    return moment.tz(`${monthQuery}-01`, "YYYY-MM-DD", TIMEZONE).startOf("month");
  }
  return moment.tz(TIMEZONE).startOf("month");
};

const getHistoricalRevenue = async (
  previousMonthStart,
  monthStart,
  previousDayStart,
  anchorDayStart,
) => {
  const [result] = await Guest.aggregate([
    { $unwind: "$payments" },
    {
      $match: {
        "payments.createdAt": {
          $gte: previousMonthStart,
          $lt: monthStart,
        },
      },
    },
    {
      $facet: {
        previousMonthTotal: [
          {
            $group: {
              _id: null,
              total: { $sum: { $ifNull: ["$payments.amount", 0] } },
            },
          },
        ],
        previousDayTotal: [
          {
            $match: {
              "payments.createdAt": {
                $gte: previousDayStart,
                $lt: anchorDayStart,
              },
            },
          },
          {
            $group: {
              _id: null,
              total: { $sum: { $ifNull: ["$payments.amount", 0] } },
            },
          },
        ],
      },
    },
  ]);

  return {
    previousMonthRevenue: Number(result?.previousMonthTotal?.[0]?.total || 0),
    previousDayRevenue: Number(result?.previousDayTotal?.[0]?.total || 0),
  };
};

const getStayDayForDate = (
  checkInAt,
  targetAt,
  checkoutTime = "12:00",
  checkinTime = "09:00",
) => {
  const checkIn = moment(checkInAt).tz(TIMEZONE);
  const target = moment(targetAt).tz(TIMEZONE);
  if (!checkIn.isValid() || !target.isValid()) return 1;

  const checkin = parseTime(checkinTime);
  const checkout = parseTime(checkoutTime);
  const checkinMinutes = checkin.hour * 60 + checkin.minute;
  const checkoutMinutes = checkout.hour * 60 + checkout.minute;
  const checkInMinutes = checkIn.hour() * 60 + checkIn.minute();
  const targetMinutes = target.hour() * 60 + target.minute();
  const checkInOperationalDay = checkIn.clone().startOf("day");
  const targetOperationalDay = target.clone().startOf("day");

  if (checkInMinutes < checkinMinutes) checkInOperationalDay.subtract(1, "day");
  if (targetMinutes <= checkoutMinutes) targetOperationalDay.subtract(1, "day");

  return Math.max(targetOperationalDay.diff(checkInOperationalDay, "day") + 1, 1);
};

const getTodayExpectedBilling = (guests = [], targetAt, settings = {}) => {
  return guests.reduce(
    (totals, guest) => {
      if (guest?.vip) return totals;
      const day = getStayDayForDate(
        guest.checkInAt,
        targetAt,
        settings.checkoutTime || "12:00",
        settings.checkinTime || "09:00",
      );
      const expectedAmount = getDailyRateForDay(guest, day);
      const paidAmount = (guest.payments || []).reduce((sum, payment) => {
        const paidAt = moment(payment?.createdAt).tz(TIMEZONE);
        if (
          paidAt.isValid() &&
          paidAt.isSame(moment(targetAt).tz(TIMEZONE), "day")
        ) {
          return sum + Number(payment?.amount || 0);
        }
        return sum;
      }, 0);

      totals.expected += Number(expectedAmount || 0);
      totals.paid += Number(paidAmount || 0);
      return totals;
    },
    { expected: 0, paid: 0 },
  );
};

const getDashboardSummary = async (req, res) => {
  try {
    const base = getMonthBase(req.query.month);
    const monthKey = base.format("YYYY-MM");
    const monthStart = base.clone().startOf("month");
    const nextMonthStart = base.clone().add(1, "month").startOf("month");
    const monthEnd = base.clone().endOf("month");
    const previousMonthStart = base.clone().subtract(1, "month").startOf("month");
    const now = moment.tz(TIMEZONE);

    let anchor = now.clone();
    if (now.isBefore(monthStart)) anchor = monthStart.clone().endOf("day");
    if (now.isAfter(monthEnd)) anchor = monthEnd.clone().endOf("day");

    const anchorDayStart = anchor.clone().startOf("day");
    const nextDayStart = anchorDayStart.clone().add(1, "day");
    const previousDayStart = anchorDayStart.clone().subtract(1, "day");
    const dayAfterNextStart = nextDayStart.clone().add(1, "day");

    const [paymentsFacetResult = {}] = await Guest.aggregate([
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
        $facet: {
          daily: [
            {
              $group: {
                _id: {
                  $dayOfMonth: {
                    date: "$payments.createdAt",
                    timezone: TIMEZONE,
                  },
                },
                total: { $sum: { $ifNull: ["$payments.amount", 0] } },
              },
            },
          ],
          paymentTypes: [
            {
              $group: {
                _id: "$payments.type",
                total: { $sum: { $ifNull: ["$payments.amount", 0] } },
              },
            },
          ],
          monthlyTotal: [
            {
              $group: {
                _id: null,
                total: { $sum: { $ifNull: ["$payments.amount", 0] } },
              },
            },
          ],
          recentPayments: [
            { $sort: { "payments.createdAt": -1 } },
            { $limit: 6 },
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
              $project: {
                _id: 0,
                guestId: "$_id",
                guestName: {
                  $trim: {
                    input: {
                      $concat: [
                        { $ifNull: ["$firstname", ""] },
                        " ",
                        { $ifNull: ["$lastname", ""] },
                      ],
                    },
                  },
                },
                roomNumber: { $ifNull: ["$roomDoc.roomNumber", "-"] },
                status: { $ifNull: ["$status", "active"] },
                vip: { $ifNull: ["$vip", false] },
                amount: { $ifNull: ["$payments.amount", 0] },
                type: { $ifNull: ["$payments.type", "naqd"] },
                createdAt: "$payments.createdAt",
              },
            },
          ],
        },
      },
    ]);

    const dailyMap = new Map(
      (paymentsFacetResult?.daily || []).map((item) => [
        Number(item?._id || 0),
        Number(item?.total || 0),
      ]),
    );

    const daysInMonth = base.daysInMonth();
    const monthlySeries = Array.from({ length: daysInMonth }, (_, index) => ({
      day: index + 1,
      value: Number(dailyMap.get(index + 1) || 0),
    }));

    const monthRevenue = Number(paymentsFacetResult?.monthlyTotal?.[0]?.total || 0);
    const { previousMonthRevenue, previousDayRevenue } = await getHistoricalRevenue(
      previousMonthStart.toDate(),
      monthStart.toDate(),
      previousDayStart.toDate(),
      anchorDayStart.toDate(),
    );

    const todayRevenue =
      Number(dailyMap.get(anchorDayStart.date()) || 0);

    const yesterdayRevenue =
      previousDayStart.isSame(monthStart, "month")
        ? Number(dailyMap.get(previousDayStart.date()) || 0)
        : previousDayRevenue;

    const paymentTypeMap = {};
    for (const item of paymentsFacetResult?.paymentTypes || []) {
      const key = String(item?._id || "");
      paymentTypeMap[key] = Number(item?.total || 0);
    }

    let paymentShareTotal = 0;
    for (const value of Object.values(paymentTypeMap)) {
      paymentShareTotal += Number(value || 0);
    }

    const paymentShare = PAYMENT_TYPES.map((item) => {
      const amount = Number(paymentTypeMap[item.type] || 0);
      const percent =
        paymentShareTotal > 0 ? Math.round((amount / paymentShareTotal) * 100) : 0;
      return {
        type: item.type,
        label: item.label,
        amount,
        percent,
      };
    });

    const weeklyRevenue = Array.from({ length: 7 }, (_, index) => {
      const dayMoment = anchorDayStart.clone().subtract(6 - index, "day");
      const isInMonth = dayMoment.isSame(monthStart, "month");
      const amount = isInMonth ? Number(dailyMap.get(dayMoment.date()) || 0) : 0;

      return {
        date: dayMoment.format("YYYY-MM-DD"),
        label: WEEKDAY_LABELS[dayMoment.day()],
        amount,
      };
    });
    const weeklyPeakAmount = Math.max(...weeklyRevenue.map((item) => Number(item?.amount || 0)), 1);
    const weeklyRevenueReady = weeklyRevenue.map((item) => ({
      ...item,
      heightPercent: Math.max((Number(item?.amount || 0) / weeklyPeakAmount) * 100, 3),
    }));

    const overlapMonthFilter = {
      checkInAt: { $lte: monthEnd.toDate() },
      $or: [{ checkOutAt: null }, { checkOutAt: { $gte: monthStart.toDate() } }],
    };

    const [hotelSettings, activeGuests, bookedGuests, debtorsAgg = {}, arrivedCount, leftCount, pendingNextDayCount, vipCount, activeTodayGuests, expensesFacet = {}, roomsFacet = {}] =
      await Promise.all([
        getHotelSettings(),
        Guest.countDocuments({
          ...overlapMonthFilter,
          status: "active",
        }),
        Guest.countDocuments({
          status: "booked",
          bookedForAt: { $gte: monthStart.toDate(), $lt: nextMonthStart.toDate() },
        }),
        Guest.aggregate([
          {
            $match: {
              ...overlapMonthFilter,
              debtAmount: { $gt: 0 },
            },
          },
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              totalDebt: { $sum: "$debtAmount" },
            },
          },
        ]).then((result) => result?.[0] || {}),
        Guest.countDocuments({
          checkInAt: { $gte: anchorDayStart.toDate(), $lt: nextDayStart.toDate() },
        }),
        Guest.countDocuments({
          checkOutAt: { $gte: anchorDayStart.toDate(), $lt: nextDayStart.toDate() },
        }),
        Guest.countDocuments({
          status: "booked",
          bookedForAt: { $gte: nextDayStart.toDate(), $lt: dayAfterNextStart.toDate() },
        }),
        Guest.countDocuments({
          vip: true,
          checkInAt: { $lte: nextDayStart.toDate() },
          $or: [{ checkOutAt: null }, { checkOutAt: { $gte: anchorDayStart.toDate() } }],
        }),
        Guest.find({
          status: "active",
          checkInAt: { $lt: nextDayStart.toDate() },
          $or: [
            { checkoutDueAt: null },
            { checkoutDueAt: { $gt: anchorDayStart.toDate() } },
          ],
        })
          .select("checkInAt checkoutDueAt dailyRate dailyRates stayDays payments vip")
          .lean(),
        Expense.aggregate([
          {
            $match: {
              spentAt: { $gte: monthStart.toDate(), $lt: nextMonthStart.toDate() },
            },
          },
          {
            $facet: {
              daily: [
                {
                  $group: {
                    _id: {
                      $dayOfMonth: {
                        date: "$spentAt",
                        timezone: TIMEZONE,
                      },
                    },
                    total: { $sum: { $ifNull: ["$amount", 0] } },
                  },
                },
              ],
              monthlyTotal: [
                {
                  $group: {
                    _id: null,
                    total: { $sum: { $ifNull: ["$amount", 0] } },
                  },
                },
              ],
              salaryTotal: [
                {
                  $match: {
                    $expr: {
                      $or: [
                        {
                          $regexMatch: {
                            input: { $ifNull: ["$category", ""] },
                            regex: "oylik|maosh|salary",
                            options: "i",
                          },
                        },
                        {
                          $regexMatch: {
                            input: { $ifNull: ["$title", ""] },
                            regex: "oylik|maosh|salary",
                            options: "i",
                          },
                        },
                      ],
                    },
                  },
                },
                {
                  $group: {
                    _id: null,
                    total: { $sum: { $ifNull: ["$amount", 0] } },
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
              capacityTotal: { $sum: { $ifNull: ["$capacity", 0] } },
            },
          },
          {
            $group: {
              _id: null,
              total: { $sum: "$count" },
              capacityTotal: { $sum: "$capacityTotal" },
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
              capacityTotal: 1,
              byStatus: { $arrayToObject: "$byStatus" },
            },
          },
        ]).then((result) => result?.[0] || {}),
      ]);

    const todayExpectedBilling = getTodayExpectedBilling(
      activeTodayGuests,
      anchor.toDate(),
      hotelSettings,
    );
    const todayExpectedRevenue = Number(todayExpectedBilling.expected || 0);
    const todayExpectedPaid = Number(todayExpectedBilling.paid || 0);
    const todayExpectedDebt = Math.max(
      todayExpectedRevenue - todayExpectedPaid,
      0,
    );

    const expenseDailyMap = new Map(
      (expensesFacet?.daily || []).map((item) => [
        Number(item?._id || 0),
        Number(item?.total || 0),
      ]),
    );
    const monthlyExpenseSeries = Array.from({ length: daysInMonth }, (_, index) => ({
      day: index + 1,
      value: Number(expenseDailyMap.get(index + 1) || 0),
    }));
    const expensesTotal = Number(expensesFacet?.monthlyTotal?.[0]?.total || 0);
    const salariesPaid = Number(expensesFacet?.salaryTotal?.[0]?.total || 0);
    const monthlyExpenses = Math.max(expensesTotal - salariesPaid, 0);
    const balance = monthRevenue - monthlyExpenses - salariesPaid;
    const monthlyChart = {
      labels: Array.from({ length: daysInMonth }, (_, index) => String(index + 1)),
      revenue: monthlySeries.map((item) => Number(item?.value || 0)),
      expense: monthlyExpenseSeries.map((item) => Number(item?.value || 0)),
      totalRevenue: monthRevenue,
      totalExpense: expensesTotal,
      width: Math.max(760, daysInMonth * 34),
    };
    const totalRooms = Number(roomsFacet?.total || 0);
    const totalCapacity = Number(roomsFacet?.capacityTotal || 0);
    const occupiedRooms = Number(roomsFacet?.byStatus?.band || 0);
    const freeRooms = Number(roomsFacet?.byStatus?.bosh || 0);
    const repairRooms = Number(roomsFacet?.byStatus?.remont || 0);
    const roomOverview = {
      total: totalRooms,
      occupied: occupiedRooms,
      free: freeRooms,
      repair: repairRooms,
      occupancyPercent:
        totalRooms > 0
          ? Number(((occupiedRooms / totalRooms) * 100).toFixed(1))
          : 0,
      chart: {
        labels: ["Band", "Bo'sh", "Remont"],
        values: [occupiedRooms, freeRooms, repairRooms],
        colors: ["#c55b4c", "#2f786f", "#d1a13c"],
      },
    };

    const recentPayments = (paymentsFacetResult?.recentPayments || []).map((item) => ({
      ...item,
      guestName: item?.guestName || "-",
    }));

    return response.success(res, "Dashboard ma'lumotlari", {
      month: monthKey,
      timezone: TIMEZONE,
      generatedAt: new Date().toISOString(),
      kpis: {
        todayRevenue,
        todayExpectedRevenue,
        todayExpectedPaid,
        todayExpectedDebt,
        yesterdayRevenue,
        todayChange: formatChange(todayRevenue, yesterdayRevenue),
        monthRevenue,
        previousMonthRevenue,
        monthChange: formatChange(monthRevenue, previousMonthRevenue),
        activeGuests: Number(activeGuests || 0),
        totalCapacity,
        bookedGuests: Number(bookedGuests || 0),
        debtorsCount: Number(debtorsAgg?.count || 0),
        debtorsAmount: Number(debtorsAgg?.totalDebt || 0),
        monthlyExpenses,
        salariesPaid,
        balance,
      },
      dailySnapshot: {
        date: anchorDayStart.format("YYYY-MM-DD"),
        arrived: Number(arrivedCount || 0),
        left: Number(leftCount || 0),
        pendingNextDay: Number(pendingNextDayCount || 0),
        vip: Number(vipCount || 0),
      },
      weeklyRevenue: weeklyRevenueReady,
      paymentShare,
      recentPayments,
      monthlyChart,
      roomOverview,
      expensesTotal,
      salariesPaid,
    });
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

module.exports = {
  getDashboardSummary,
  getStayDayForDate,
  getTodayExpectedBilling,
};
