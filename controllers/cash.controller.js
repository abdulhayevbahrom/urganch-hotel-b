const mongoose = require("mongoose");
const moment = require("moment-timezone");
const CashClosure = require("../model/CashClosure");
const CashTransaction = require("../model/CashTransaction");
const response = require("../utils/response");
const { buildCashActor } = require("../utils/cashRegister");
const { hasFullAccess } = require("../utils/roleAccess");
const { getHotelSettings, parseTime } = require("../utils/hotelSettings");

const PAYMENT_TYPES = ["naqd", "karta", "bank", "click"];
const TIMEZONE = process.env.APP_TIMEZONE || "Asia/Tashkent";
const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

const canSeeAllCash = (user) => hasFullAccess(user?.role);

const emptyTotals = () => ({ naqd: 0, karta: 0, click: 0, bank: 0, total: 0 });

const summarizeTransactions = (transactions = []) =>
  transactions.reduce((totals, item) => {
    const type = PAYMENT_TYPES.includes(item.paymentType) ? item.paymentType : "naqd";
    const amount = Number(item.amount || 0);
    totals[type] += amount;
    totals.total += amount;
    return totals;
  }, emptyTotals());

const buildCashFilter = (req, extra = {}) => {
  const filter = { ...extra };
  if (!canSeeAllCash(req.admin)) {
    filter["cashier.userId"] = String(req.admin.id || "");
  }
  return filter;
};

const getTotalsAggregation = (filter) => [
  { $match: filter },
  {
    $group: {
      _id: null,
      naqd: { $sum: { $cond: [{ $eq: ["$paymentType", "naqd"] }, "$amount", 0] } },
      karta: { $sum: { $cond: [{ $eq: ["$paymentType", "karta"] }, "$amount", 0] } },
      click: { $sum: { $cond: [{ $eq: ["$paymentType", "click"] }, "$amount", 0] } },
      bank: { $sum: { $cond: [{ $eq: ["$paymentType", "bank"] }, "$amount", 0] } },
      total: { $sum: "$amount" },
      count: { $sum: 1 },
    },
  },
];

const getCashSummary = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 100);
    const ownOpenFilter = {
      status: "open",
      "cashier.userId": String(req.admin.id || ""),
    };
    const [openTransactions, ownTotalsRows, submittedClosures, recentClosures, cashierSummaries] = await Promise.all([
      CashTransaction.find(ownOpenFilter)
        .sort({ paidAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      CashTransaction.aggregate(getTotalsAggregation(ownOpenFilter)),
      CashClosure.find(buildCashFilter(req, { status: "submitted" }))
        .sort({ createdAt: -1 })
        .lean(),
      CashClosure.find(buildCashFilter(req))
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
      canSeeAllCash(req.admin)
        ? CashTransaction.aggregate([
            { $match: { status: "open" } },
            {
              $group: {
                _id: "$cashier.userId",
                cashier: { $first: "$cashier" },
                naqd: { $sum: { $cond: [{ $eq: ["$paymentType", "naqd"] }, "$amount", 0] } },
                karta: { $sum: { $cond: [{ $eq: ["$paymentType", "karta"] }, "$amount", 0] } },
                click: { $sum: { $cond: [{ $eq: ["$paymentType", "click"] }, "$amount", 0] } },
                bank: { $sum: { $cond: [{ $eq: ["$paymentType", "bank"] }, "$amount", 0] } },
                total: { $sum: "$amount" },
                count: { $sum: 1 },
              },
            },
            { $sort: { total: -1 } },
          ])
        : Promise.resolve([]),
    ]);

    const ownTotals = ownTotalsRows[0] || { ...emptyTotals(), count: 0 };
    const totalPages = Math.max(Math.ceil(Number(ownTotals.count || 0) / limit), 1);

    return response.success(res, "Kassa ma'lumotlari", {
      open: {
        totals: {
          naqd: Number(ownTotals.naqd || 0),
          karta: Number(ownTotals.karta || 0),
          click: Number(ownTotals.click || 0),
          bank: Number(ownTotals.bank || 0),
          total: Number(ownTotals.total || 0),
        },
        count: Number(ownTotals.count || 0),
        transactions: openTransactions,
        pagination: { page, limit, total: Number(ownTotals.count || 0), totalPages },
      },
      submitted: submittedClosures,
      recentClosures,
      cashierSummaries,
      canApprove: canSeeAllCash(req.admin),
    });
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const getDailyCashControl = async (req, res) => {
  try {
    if (!canSeeAllCash(req.admin)) {
      return response.forbidden(res, "Kunlik kassa nazorati faqat owner uchun");
    }

    const date = String(req.query.date || "").trim();
    if (!DATE_PATTERN.test(date)) {
      return response.error(res, "Sana YYYY-MM-DD formatida bo'lishi kerak");
    }
    const day = moment.tz(date, "YYYY-MM-DD", true, TIMEZONE);
    if (!day.isValid() || day.format("YYYY-MM-DD") !== date) {
      return response.error(res, "Sana noto'g'ri");
    }
    if (day.isAfter(moment.tz(TIMEZONE), "day")) {
      return response.error(res, "Kelasi sanani tanlab bo'lmaydi");
    }

    const settings = await getHotelSettings();
    const checkin = parseTime(settings.checkinTime);
    const checkout = parseTime(settings.checkoutTime);
    const start = day
      .clone()
      .hour(checkin.hour)
      .minute(checkin.minute)
      .second(0)
      .millisecond(0)
      .toDate();
    const end = day
      .clone()
      .add(1, "day")
      .hour(checkout.hour)
      .minute(checkout.minute)
      .second(0)
      .millisecond(0)
      .toDate();
    const baseFilter = {
      paidAt: { $gte: start, $lt: end },
      status: { $ne: "rejected" },
    };
    const cashierId = String(req.query.cashierId || "").trim();
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 100);
    const detailFilter = cashierId
      ? { ...baseFilter, "cashier.userId": cashierId }
      : null;

    const [summaries, transactions, detailTotal] = await Promise.all([
      CashTransaction.aggregate([
        { $match: baseFilter },
        {
          $group: {
            _id: "$cashier.userId",
            cashier: { $first: "$cashier" },
            naqd: { $sum: { $cond: [{ $eq: ["$paymentType", "naqd"] }, "$amount", 0] } },
            karta: { $sum: { $cond: [{ $eq: ["$paymentType", "karta"] }, "$amount", 0] } },
            click: { $sum: { $cond: [{ $eq: ["$paymentType", "click"] }, "$amount", 0] } },
            bank: { $sum: { $cond: [{ $eq: ["$paymentType", "bank"] }, "$amount", 0] } },
            total: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        },
        { $sort: { total: -1, _id: 1 } },
      ]),
      detailFilter
        ? CashTransaction.find(detailFilter)
            .sort({ paidAt: -1, _id: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean()
        : Promise.resolve([]),
      detailFilter ? CashTransaction.countDocuments(detailFilter) : Promise.resolve(0),
    ]);

    return response.success(res, "Kassirlarning kunlik to'lovlari", {
      date,
      range: { start, end },
      summaries,
      selectedCashierId: cashierId,
      transactions,
      pagination: {
        page,
        limit,
        total: detailTotal,
        totalPages: Math.max(Math.ceil(detailTotal / limit), 1),
      },
    });
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const closeCash = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    if (String(req.admin?.role || "").toLowerCase().trim() !== "kassir") {
      return response.forbidden(res, "Kassani faqat kassir yopishi mumkin");
    }
    const userId = String(req.admin?.id || "");
    const countedCash = Math.max(Number(req.body.countedCash || 0), 0);
    const note = String(req.body.note || "").trim();
    let payload = null;

    await session.withTransaction(async () => {
      const openTransactions = await CashTransaction.find({
        status: "open",
        "cashier.userId": userId,
      }).session(session);
      if (!openTransactions.length) {
        throw new Error("Yopiladigan ochiq to'lovlar yo'q");
      }

      const totals = summarizeTransactions(openTransactions);
      const closure = await CashClosure.create(
        [{
          cashier: buildCashActor(req.admin),
          totals,
          countedCash,
          difference: countedCash - Number(totals.naqd || 0),
          transactionCount: openTransactions.length,
          note,
          status: "submitted",
        }],
        { session },
      );

      await CashTransaction.updateMany(
        { _id: { $in: openTransactions.map((item) => item._id) } },
        { $set: { status: "submitted", closure: closure[0]._id } },
        { session },
      );

      payload = closure[0];
    });

    req.app.get("socket")?.emit("cash_updated", {
      reason: "cash_submitted",
      cashierId: userId,
      emittedAt: new Date(),
    });
    return response.success(res, "Kassa yopildi va adminga yuborildi", payload);
  } catch (error) {
    const message =
      error.message === "Yopiladigan ochiq to'lovlar yo'q"
        ? error.message
        : "Kassani yopishda xatolik";
    if (message === error.message) return response.error(res, message);
    return response.serverError(res, error.message);
  } finally {
    session.endSession();
  }
};

const decideCashClosure = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    if (!canSeeAllCash(req.admin)) {
      return response.forbidden(res, "Kassani faqat admin tasdiqlaydi");
    }

    const action = String(req.body.action || "").trim();
    const nextStatus = action === "approve" ? "approved" : action === "reject" ? "rejected" : "";
    if (!nextStatus) return response.error(res, "Amal noto'g'ri");

    let payload = null;
    await session.withTransaction(async () => {
      const closure = await CashClosure.findById(req.params.id).session(session);
      if (!closure) throw new Error("Kassa topshirig'i topilmadi");
      if (closure.status !== "submitted") {
        throw new Error("Bu kassa allaqachon ko'rib chiqilgan");
      }

      closure.status = nextStatus;
      closure.adminNote = String(req.body.adminNote || "").trim();
      closure.approvedBy = buildCashActor(req.admin);
      closure.approvedAt = new Date();
      await closure.save({ session });

      await CashTransaction.updateMany(
        { closure: closure._id },
        {
          $set: {
            status: nextStatus === "approved" ? "approved" : "open",
            closure: nextStatus === "approved" ? closure._id : null,
          },
        },
        { session },
      );
      payload = closure;
    });

    req.app.get("socket")?.emit("cash_updated", {
      reason: nextStatus === "approved" ? "cash_approved" : "cash_reopened",
      closureId: String(payload?._id || ""),
      emittedAt: new Date(),
    });
    return response.success(
      res,
      nextStatus === "approved" ? "Kassa tasdiqlandi" : "Kassa qaytarildi",
      payload,
    );
  } catch (error) {
    if (
      error.message === "Kassa topshirig'i topilmadi" ||
      error.message === "Bu kassa allaqachon ko'rib chiqilgan"
    ) {
      return response.error(res, error.message);
    }
    return response.serverError(res, error.message);
  } finally {
    session.endSession();
  }
};

module.exports = {
  getCashSummary,
  getDailyCashControl,
  closeCash,
  decideCashClosure,
  summarizeTransactions,
};
