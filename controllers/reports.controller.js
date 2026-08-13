const moment = require("moment-timezone");
const Guest = require("../model/Guest");
const Expense = require("../model/Expense");
const Room = require("../model/Room");
const Employee = require("../model/Employee");
const Service = require("../model/Service");
const VipRequest = require("../model/VipRequest");
const HallBooking = require("../model/HallBooking");
const response = require("../utils/response");

const TIMEZONE = process.env.APP_TIMEZONE || "Asia/Tashkent";
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

const getMonthBase = (monthQuery) => {
  if (MONTH_PATTERN.test(String(monthQuery || ""))) {
    return moment.tz(`${monthQuery}-01`, "YYYY-MM-DD", TIMEZONE).startOf("month");
  }
  return moment.tz(TIMEZONE).startOf("month");
};

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

module.exports = {
  getReportsSummary,
};
