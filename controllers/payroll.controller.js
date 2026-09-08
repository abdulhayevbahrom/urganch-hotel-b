const Employee = require("../model/Employee");
const Payroll = require("../model/Payroll");
const response = require("../utils/response");

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

const getPreviousMonth = (month) => {
  const [year, monthIndex] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthIndex - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
};

const calculateBalance = (payroll) =>
  Number(payroll.previousBalance || 0) +
  Number(payroll.baseSalary || 0) +
  Number(payroll.bonus || 0) -
  Number(payroll.deduction || 0) -
  Number(payroll.paidAmount || 0);

const normalizeActions = (payroll) => {
  const actions = Array.isArray(payroll.actions) ? payroll.actions : [];
  if (actions.length) return actions;

  const legacyActions = [];
  if (Number(payroll.paidAmount || 0) > 0) {
    legacyActions.push({
      _id: "legacy-payment",
      type: "payment",
      amount: Number(payroll.paidAmount || 0),
      paymentType: payroll.paymentType || "naqd",
      date: payroll.paidAt || payroll.createdAt,
      note: payroll.note || "",
    });
  }
  if (Number(payroll.bonus || 0) > 0) {
    legacyActions.push({
      _id: "legacy-bonus",
      type: "bonus",
      amount: Number(payroll.bonus || 0),
      paymentType: "",
      date: payroll.createdAt,
      note: payroll.note || "",
    });
  }
  if (Number(payroll.deduction || 0) > 0) {
    legacyActions.push({
      _id: "legacy-deduction",
      type: "deduction",
      amount: Number(payroll.deduction || 0),
      paymentType: "",
      date: payroll.createdAt,
      note: payroll.note || "",
    });
  }
  return legacyActions;
};

const syncPayrollTotals = (payroll) => {
  const totals = normalizeActions(payroll).reduce(
    (acc, action) => {
      const amount = Number(action.amount || 0);
      if (action.type === "payment") acc.paidAmount += amount;
      if (action.type === "bonus") acc.bonus += amount;
      if (action.type === "deduction") acc.deduction += amount;
      return acc;
    },
    { paidAmount: 0, bonus: 0, deduction: 0 },
  );

  payroll.paidAmount = totals.paidAmount;
  payroll.bonus = totals.bonus;
  payroll.deduction = totals.deduction;
  const lastPayment = [...normalizeActions(payroll)]
    .reverse()
    .find((action) => action.type === "payment");
  if (lastPayment) {
    payroll.paymentType = lastPayment.paymentType || "naqd";
    payroll.paidAt = lastPayment.date || payroll.paidAt;
  }
};

const getPreviousBalance = async (employeeId, month) => {
  const previous = await Payroll.findOne({
    employee: employeeId,
    month: getPreviousMonth(month),
  }).lean();

  if (!previous) return 0;
  return calculateBalance(previous);
};

const buildPayrollDto = (payroll) => {
  const item = payroll.toObject ? payroll.toObject({ virtuals: true }) : payroll;
  item.actions = normalizeActions(item);
  const balance = calculateBalance(item);
  return {
    ...item,
    totalEarned: Number(item.baseSalary || 0) + Number(item.bonus || 0),
    balance,
    employeeDebt: balance < 0 ? Math.abs(balance) : 0,
    employeeCredit: balance > 0 ? balance : 0,
  };
};

const findPayrollAction = (payroll, actionId) =>
  payroll.actions.id(actionId) ||
  payroll.actions.find((action) => String(action._id) === String(actionId));

const ensurePayrollActions = async (payroll) => {
  if (Array.isArray(payroll.actions) && payroll.actions.length) return payroll;

  const legacyActions = normalizeActions(payroll);
  if (!legacyActions.length) return payroll;

  payroll.actions = legacyActions
    .filter((action) => Number(action.amount || 0) > 0)
    .map((action) => ({
      type: action.type,
      amount: Number(action.amount || 0),
      paymentType: action.paymentType || "",
      date: action.date || new Date(),
      note: action.note || "",
    }));
  await payroll.save();
  return payroll;
};

const getPayrolls = async (req, res) => {
  try {
    const month = String(req.query.month || "").trim();
    const filter = {};
    if (month) filter.month = month;

    const payrolls = await Payroll.find(filter)
      .populate("employee", "firstname lastname position salary isActive")
      .sort({ month: -1, paidAt: -1, createdAt: -1 });

    let items = payrolls.map(buildPayrollDto);

    if (month) {
      const employees = await Employee.find({ isActive: true })
        .select("firstname lastname position salary isActive")
        .sort({ createdAt: -1 })
        .lean();
      const payrollByEmployeeId = new Map(
        items.map((item) => [String(item.employee?._id || item.employee), item]),
      );

      items = await Promise.all(
        employees.map(async (employee) => {
          const existing = payrollByEmployeeId.get(String(employee._id));
          if (existing) return { ...existing, isPaid: true };

          const previousBalance = await getPreviousBalance(employee._id, month);
          return buildPayrollDto({
            _id: `draft-${employee._id}`,
            employee,
            month,
            baseSalary: Number(employee.salary || 0),
            previousBalance,
            bonus: 0,
            deduction: 0,
            paidAmount: 0,
            paymentType: "naqd",
            paidAt: null,
            note: "",
            isPaid: false,
          });
        }),
      );
    }

    const summary = items.reduce(
      (acc, item) => {
        acc.totalSalary += Number(item.baseSalary || 0);
        acc.totalBonus += Number(item.bonus || 0);
        acc.totalDeduction += Number(item.deduction || 0);
        acc.totalPaid += Number(item.paidAmount || 0);
        acc.totalDebt += Number(item.employeeDebt || 0);
        acc.totalCredit += Number(item.employeeCredit || 0);
        return acc;
      },
      {
        totalSalary: 0,
        totalBonus: 0,
        totalDeduction: 0,
        totalPaid: 0,
        totalDebt: 0,
        totalCredit: 0,
      },
    );

    return response.success(res, "Oyliklar ro'yxati", { items, summary });
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const getPayrollPreview = async (req, res) => {
  try {
    const employee = await Employee.findById(req.query.employeeId)
      .select("firstname lastname position salary")
      .lean();
    if (!employee) return response.notFound(res, "Hodim topilmadi");

    const existing = await Payroll.findOne({
      employee: employee._id,
      month: req.query.month,
    }).lean();
    const previousBalance = await getPreviousBalance(employee._id, req.query.month);

    return response.success(res, "Oylik hisob-kitob", {
      employee,
      month: req.query.month,
      baseSalary: Number(existing?.baseSalary ?? employee.salary ?? 0),
      bonus: Number(existing?.bonus || 0),
      deduction: Number(existing?.deduction || 0),
      paidAmount: Number(existing?.paidAmount || 0),
      paymentType: existing?.paymentType || "naqd",
      note: existing?.note || "",
      previousBalance,
      existingPayroll: existing || null,
    });
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const getPayrollHistory = async (req, res) => {
  try {
    const month = String(req.query.month || "").trim();
    const query = String(req.query.query || "").trim().toLowerCase();
    const type = String(req.query.type || "").trim();
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 25), 1), 100);
    const filter = {};
    if (month) filter.month = month;

    const payrolls = await Payroll.find(filter)
      .select("actions paidAmount bonus deduction paymentType paidAt note createdAt")
      .sort({ updatedAt: -1 });

    await Promise.all(payrolls.map((payroll) => ensurePayrollActions(payroll)));

    const match = { ...filter, "actions.0": { $exists: true } };
    const actionMatch = {};
    if (["payment", "bonus", "deduction"].includes(type)) {
      actionMatch["actions.type"] = type;
    }

    const searchMatch = query
      ? {
          $or: [
            { "employee.firstname": { $regex: query, $options: "i" } },
            { "employee.lastname": { $regex: query, $options: "i" } },
            { "employee.position": { $regex: query, $options: "i" } },
          ],
        }
      : {};

    const [result = {}] = await Payroll.aggregate([
      { $match: match },
      { $unwind: "$actions" },
      ...(Object.keys(actionMatch).length ? [{ $match: actionMatch }] : []),
      {
        $lookup: {
          from: "employees",
          localField: "employee",
          foreignField: "_id",
          as: "employee",
        },
      },
      { $unwind: "$employee" },
      ...(Object.keys(searchMatch).length ? [{ $match: searchMatch }] : []),
      { $sort: { "actions.date": -1, "actions.createdAt": -1, updatedAt: -1 } },
      {
        $facet: {
          items: [
            { $skip: (page - 1) * limit },
            { $limit: limit },
            {
              $project: {
                _id: { $toString: "$actions._id" },
                payrollId: { $toString: "$_id" },
                employee: {
                  _id: "$employee._id",
                  firstname: "$employee.firstname",
                  lastname: "$employee.lastname",
                  position: "$employee.position",
                },
                month: 1,
                type: "$actions.type",
                amount: "$actions.amount",
                paymentType: "$actions.paymentType",
                date: "$actions.date",
                note: "$actions.note",
              },
            },
          ],
          totalRows: [{ $count: "total" }],
        },
      },
    ]);

    const total = Number(result.totalRows?.[0]?.total || 0);
    return response.success(res, "Oylik tarixi", {
      items: result.items || [],
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

const createPayroll = async (req, res) => {
  try {
    const employee = await Employee.findById(req.body.employeeId)
      .select("firstname lastname position salary")
      .lean();
    if (!employee) return response.notFound(res, "Hodim topilmadi");

    const existingPayroll = await Payroll.findOne({
      employee: employee._id,
      month: req.body.month,
    }).lean();
    if (existingPayroll) {
      return response.error(res, "Bu hodim uchun ushbu oy oyligi allaqachon saqlangan");
    }

    const previousBalance = await getPreviousBalance(employee._id, req.body.month);
    const baseSalary = Number(req.body.baseSalary ?? employee.salary ?? 0);
    const paidAt = req.body.paidAt ? new Date(req.body.paidAt) : new Date();
    const createdBy = await buildCreatedBy(req.admin);

    const payroll = await Payroll.create({
      employee: employee._id,
      month: req.body.month,
      baseSalary,
      previousBalance,
      bonus: Number(req.body.bonus || 0),
      deduction: Number(req.body.deduction || 0),
      paidAmount: Number(req.body.paidAmount || 0),
      paymentType: req.body.paymentType,
      paidAt,
      note: String(req.body.note || "").trim(),
      actions: [
        {
          type: "payment",
          amount: Number(req.body.paidAmount || 0),
          paymentType: req.body.paymentType,
          date: paidAt,
          note: String(req.body.note || "").trim(),
        },
        {
          type: "bonus",
          amount: Number(req.body.bonus || 0),
          paymentType: "",
          date: paidAt,
          note: String(req.body.note || "").trim(),
        },
        {
          type: "deduction",
          amount: Number(req.body.deduction || 0),
          paymentType: "",
          date: paidAt,
          note: String(req.body.note || "").trim(),
        },
      ].filter((action) => action.amount > 0),
      createdBy,
    });

    const populated = await Payroll.findById(payroll._id).populate(
      "employee",
      "firstname lastname position salary isActive",
    );

    return response.created(res, "Oylik saqlandi", buildPayrollDto(populated));
  } catch (error) {
    if (error?.code === 11000) {
      return response.error(res, "Bu hodim uchun ushbu oy oyligi allaqachon saqlangan");
    }
    return response.serverError(res, error.message);
  }
};

const deletePayroll = async (req, res) => {
  try {
    const payroll = await Payroll.findByIdAndDelete(req.params.id);
    if (!payroll) return response.notFound(res, "Oylik topilmadi");
    return response.success(res, "Oylik o'chirildi");
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const updatePayroll = async (req, res) => {
  try {
    const payroll = await Payroll.findById(req.params.id);
    if (!payroll) return response.notFound(res, "Oylik topilmadi");

    const amount = Number(req.body.amount || 0);
    const type = req.body.type;
    if (!["payment", "bonus", "deduction"].includes(type)) {
      return response.error(res, "Oylik amal turi noto'g'ri");
    }

    payroll.actions.push({
      type,
      amount,
      paymentType: type === "payment" ? req.body.paymentType || "naqd" : "",
      date: req.body.date ? new Date(req.body.date) : new Date(),
      note: String(req.body.note || "").trim(),
    });
    syncPayrollTotals(payroll);
    await payroll.save();

    const populated = await Payroll.findById(payroll._id).populate(
      "employee",
      "firstname lastname position salary isActive",
    );
    return response.success(res, "Oylik yangilandi", buildPayrollDto(populated));
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const updatePayrollAction = async (req, res) => {
  try {
    const payroll = await Payroll.findById(req.params.id);
    if (!payroll) return response.notFound(res, "Oylik topilmadi");

    const action = findPayrollAction(payroll, req.params.actionId);
    if (!action) return response.notFound(res, "Oylik amali topilmadi");

    action.amount = Number(req.body.amount || 0);
    if (action.type === "payment") action.paymentType = req.body.paymentType || "naqd";
    if (req.body.date) action.date = new Date(req.body.date);
    action.note = String(req.body.note || "").trim();
    syncPayrollTotals(payroll);
    await payroll.save();

    return response.success(res, "Oylik amali yangilandi");
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const deletePayrollAction = async (req, res) => {
  try {
    const payroll = await Payroll.findById(req.params.id);
    if (!payroll) return response.notFound(res, "Oylik topilmadi");

    const action = findPayrollAction(payroll, req.params.actionId);
    if (!action) return response.notFound(res, "Oylik amali topilmadi");
    action.deleteOne();
    syncPayrollTotals(payroll);
    await payroll.save();

    return response.success(res, "Oylik amali o'chirildi");
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

module.exports = {
  getPayrolls,
  getPayrollHistory,
  getPayrollPreview,
  createPayroll,
  updatePayroll,
  updatePayrollAction,
  deletePayrollAction,
  deletePayroll,
};
