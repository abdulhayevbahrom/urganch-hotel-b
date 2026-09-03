const mongoose = require("mongoose");
const CashClosure = require("../model/CashClosure");
const CashTransaction = require("../model/CashTransaction");
const response = require("../utils/response");
const { buildCashActor } = require("../utils/cashRegister");
const { hasFullAccess } = require("../utils/roleAccess");

const PAYMENT_TYPES = ["naqd", "karta", "bank"];

const canSeeAllCash = (user) => hasFullAccess(user?.role);

const emptyTotals = () => ({ naqd: 0, karta: 0, bank: 0, total: 0 });

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

const getCashSummary = async (req, res) => {
  try {
    const [openTransactions, submittedClosures, recentClosures] = await Promise.all([
      CashTransaction.find(buildCashFilter(req, { status: "open" }))
        .sort({ paidAt: -1 })
        .limit(100)
        .lean(),
      CashClosure.find(buildCashFilter(req, { status: "submitted" }))
        .sort({ createdAt: -1 })
        .lean(),
      CashClosure.find(buildCashFilter(req))
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
    ]);

    return response.success(res, "Kassa ma'lumotlari", {
      open: {
        totals: summarizeTransactions(openTransactions),
        count: openTransactions.length,
        transactions: openTransactions,
      },
      submitted: submittedClosures,
      recentClosures,
      canApprove: canSeeAllCash(req.admin),
    });
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const closeCash = async (req, res) => {
  const session = await mongoose.startSession();
  try {
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
  closeCash,
  decideCashClosure,
  summarizeTransactions,
};
