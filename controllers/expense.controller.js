const Expense = require("../model/Expense");
const Employee = require("../model/Employee");
const response = require("../utils/response");

const normalizeCategory = (value) => String(value || "").trim();

const buildCreatedBy = async (user) => {
  const actor = {
    userId: String(user?.id || ""),
    role: String(user?.role || ""),
    login: String(user?.login || ""),
    firstname: "",
    lastname: "",
  };

  if (!actor.userId) return actor;

  const employee = await Employee.findById(actor.userId)
    .select("firstname lastname")
    .lean();

  actor.firstname = String(employee?.firstname || "");
  actor.lastname = String(employee?.lastname || "");

  return actor;
};

const createExpense = async (req, res) => {
  try {
    const payload = { ...req.body };
    payload.category = normalizeCategory(payload.category);
    if (payload.spentAt) payload.spentAt = new Date(payload.spentAt);
    payload.createdBy = await buildCreatedBy(req.admin);

    const expense = await Expense.create(payload);
    return response.created(res, "Xarajat muvaffaqiyatli qo'shildi", expense);
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const getExpenses = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);
    const query = String(req.query.query || "").trim();
    const category = String(req.query.category || "").trim();
    const paymentType = String(req.query.paymentType || "").trim();
    const startDate = String(req.query.startDate || "").trim();
    const endDate = String(req.query.endDate || "").trim();

    const filter = {};

    if (query) {
      filter.$or = [
        { title: { $regex: query, $options: "i" } },
        { note: { $regex: query, $options: "i" } },
      ];
    }

    if (category) filter.category = category;
    if (paymentType) filter.paymentType = paymentType;

    if (startDate || endDate) {
      filter.spentAt = {};
      if (startDate) {
        const from = new Date(startDate);
        if (!Number.isNaN(from.getTime())) filter.spentAt.$gte = from;
      }
      if (endDate) {
        const to = new Date(endDate);
        if (!Number.isNaN(to.getTime())) {
          to.setHours(23, 59, 59, 999);
          filter.spentAt.$lte = to;
        }
      }
      if (Object.keys(filter.spentAt).length === 0) delete filter.spentAt;
    }

    const [items, total, summaryByCategory, summaryByPaymentType, categories] =
      await Promise.all([
      Expense.find(filter)
        .sort({ spentAt: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Expense.countDocuments(filter),
      Expense.aggregate([
        { $match: filter },
        {
          $group: {
            _id: "$category",
            totalAmount: { $sum: "$amount" },
          },
        },
      ]),
      Expense.aggregate([
        { $match: filter },
        {
          $group: {
            _id: "$paymentType",
            totalAmount: { $sum: "$amount" },
          },
        },
      ]),
      Expense.distinct("category"),
    ]);

    const totalAmount = summaryByCategory.reduce(
      (acc, item) => acc + Number(item.totalAmount || 0),
      0,
    );
    const byCategory = summaryByCategory.reduce((acc, item) => {
      acc[item._id] = Number(item.totalAmount || 0);
      return acc;
    }, {});
    const byPaymentType = summaryByPaymentType.reduce((acc, item) => {
      acc[item._id] = Number(item.totalAmount || 0);
      return acc;
    }, {});

    return response.success(res, "Xarajatlar ro'yxati", {
      items,
      categories: categories.filter(Boolean).sort((a, b) => a.localeCompare(b)),
      summary: {
        totalAmount,
        byCategory,
        byPaymentType,
      },
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(Math.ceil(total / limit), 1),
      },
    });
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const updateExpense = async (req, res) => {
  try {
    const updates = { ...req.body };
    if (updates.category) updates.category = normalizeCategory(updates.category);
    if (updates.spentAt) updates.spentAt = new Date(updates.spentAt);

    const expense = await Expense.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    });
    if (!expense) return response.notFound(res, "Xarajat topilmadi");
    return response.success(res, "Xarajat yangilandi", expense);
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const deleteExpense = async (req, res) => {
  try {
    const expense = await Expense.findByIdAndDelete(req.params.id);
    if (!expense) return response.notFound(res, "Xarajat topilmadi");
    return response.success(res, "Xarajat o'chirildi");
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

module.exports = {
  createExpense,
  getExpenses,
  updateExpense,
  deleteExpense,
};
