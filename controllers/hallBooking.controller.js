const HallBooking = require("../model/HallBooking");
const Employee = require("../model/Employee");
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

const toStartOfDay = (value) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

const toEndOfDay = (value) => {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
};

const normalizeBookingInput = (body = {}) => {
  const hallName = String(body.hallName || "").trim();
  const startDate = toStartOfDay(body.startDate);
  const endDate = toEndOfDay(body.endDate);
  const totalAmount = Number(body.totalAmount || 0);
  const paidAmount = Number(body.paidAmount || 0);

  return {
    hallName,
    eventName: String(body.eventName || "").trim(),
    customerFirstname: String(body.customerFirstname || "").trim(),
    customerLastname: String(body.customerLastname || "").trim(),
    phone: String(body.phone || "").trim(),
    startDate,
    endDate,
    totalAmount,
    paidAmount,
    debtAmount: Math.max(totalAmount - paidAmount, 0),
    note: String(body.note || "").trim(),
  };
};

const validateDates = (startDate, endDate) =>
  !Number.isNaN(startDate.getTime()) &&
  !Number.isNaN(endDate.getTime()) &&
  startDate.getTime() <= endDate.getTime();

const hasOverlap = async ({ hallName, startDate, endDate, excludeId = null }) => {
  const filter = {
    hallName,
    status: { $ne: "canceled" },
    startDate: { $lte: endDate },
    endDate: { $gte: startDate },
  };
  if (excludeId) filter._id = { $ne: excludeId };
  const exists = await HallBooking.findOne(filter).select("_id").lean();
  return Boolean(exists);
};

const attachRuntimeState = (booking) => {
  const now = Date.now();
  const start = new Date(booking.startDate).getTime();
  const end = new Date(booking.endDate).getTime();
  const customerFull = String(booking.customerName || "").trim();
  const [fallbackFirstname = "", ...rest] = customerFull.split(" ");
  const fallbackLastname = rest.join(" ").trim();
  const normalized = {
    ...booking,
    customerFirstname:
      booking.customerFirstname || fallbackFirstname || "",
    customerLastname:
      booking.customerLastname || fallbackLastname || "",
  };
  if (normalized.status === "canceled") {
    return { ...normalized, eventState: "canceled" };
  }
  if (now < start) return { ...normalized, eventState: "upcoming" };
  if (now > end) return { ...normalized, eventState: "past" };
  return { ...normalized, eventState: "ongoing" };
};

const createHallBooking = async (req, res) => {
  try {
    const payload = normalizeBookingInput(req.body);

    if (
      !payload.hallName ||
      !payload.eventName ||
      !payload.customerFirstname ||
      !payload.customerLastname
    ) {
      return response.error(res, "Majburiy maydonlar to'ldirilmagan");
    }

    if (!validateDates(payload.startDate, payload.endDate)) {
      return response.error(res, "Sana oralig'i noto'g'ri");
    }
    if (payload.paidAmount > payload.totalAmount) {
      return response.error(res, "Boshlang'ich to'lov jami summadan oshmasin");
    }

    if (await hasOverlap(payload)) {
      return response.error(
        res,
        "Ushbu zal ushbu sana oralig'ida allaqachon bron qilingan",
      );
    }

    const booking = await HallBooking.create({
      ...payload,
      payments:
        payload.paidAmount > 0
          ? [{ amount: payload.paidAmount, type: "naqd", note: "Oldindan to'lov (zakalad)" }]
          : [],
      createdBy: await buildCreatedBy(req.admin),
    });

    return response.created(res, "Zal ijarasi qo'shildi", attachRuntimeState(booking.toObject()));
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const getHallBookings = async (req, res) => {
  try {
    const tab = String(req.query.tab || "all").toLowerCase();
    const filter = {};
    if (tab === "debtors") filter.debtAmount = { $gt: 0 };
    const items = await HallBooking.find(filter).sort({ createdAt: -1 }).lean();
    return response.success(
      res,
      "Zal ijaralari ro'yxati",
      items.map(attachRuntimeState),
    );
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const updateHallBooking = async (req, res) => {
  try {
    const current = await HallBooking.findById(req.params.id);
    if (!current) return response.notFound(res, "Zal ijarasi topilmadi");

    const payload = normalizeBookingInput({
      ...current.toObject(),
      ...req.body,
    });

    if (!validateDates(payload.startDate, payload.endDate)) {
      return response.error(res, "Sana oralig'i noto'g'ri");
    }
    if (Number(current.paidAmount || 0) > payload.totalAmount) {
      return response.error(
        res,
        "Jami summa mavjud to'lovdan kam bo'lishi mumkin emas",
      );
    }

    if (await hasOverlap({ ...payload, excludeId: current._id })) {
      return response.error(
        res,
        "Ushbu zal ushbu sana oralig'ida allaqachon bron qilingan",
      );
    }

    current.hallName = payload.hallName;
    current.eventName = payload.eventName;
    current.customerFirstname = payload.customerFirstname;
    current.customerLastname = payload.customerLastname;
    current.phone = payload.phone;
    current.startDate = payload.startDate;
    current.endDate = payload.endDate;
    current.totalAmount = payload.totalAmount;
    current.note = payload.note;
    current.debtAmount = Math.max(current.totalAmount - Number(current.paidAmount || 0), 0);
    await current.save();

    return response.success(
      res,
      "Zal ijarasi yangilandi",
      attachRuntimeState(current.toObject()),
    );
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const addHallBookingPayment = async (req, res) => {
  try {
    const booking = await HallBooking.findById(req.params.id);
    if (!booking) return response.notFound(res, "Zal ijarasi topilmadi");

    const amount = Number(req.body.amount || 0);
    if (amount <= 0) return response.error(res, "To'lov summasi noto'g'ri");
    if (amount > Number(booking.debtAmount || 0)) {
      return response.error(res, "To'lov qarzdan oshmasin");
    }

    booking.payments.push({
      amount,
      type: String(req.body.type || "naqd"),
      note: String(req.body.note || "").trim(),
    });
    booking.paidAmount = Number(booking.paidAmount || 0) + amount;
    booking.debtAmount = Math.max(Number(booking.totalAmount || 0) - booking.paidAmount, 0);
    await booking.save();

    return response.success(
      res,
      "To'lov qo'shildi",
      attachRuntimeState(booking.toObject()),
    );
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const cancelHallBooking = async (req, res) => {
  try {
    const booking = await HallBooking.findById(req.params.id);
    if (!booking) return response.notFound(res, "Zal ijarasi topilmadi");
    if (booking.status === "canceled") {
      return response.error(res, "Buyurtma allaqachon bekor qilingan");
    }

    booking.status = "canceled";
    await booking.save();

    return response.success(
      res,
      "Buyurtma bekor qilindi",
      attachRuntimeState(booking.toObject()),
    );
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const deleteHallBooking = async (req, res) => {
  try {
    const booking = await HallBooking.findByIdAndDelete(req.params.id);
    if (!booking) return response.notFound(res, "Zal ijarasi topilmadi");
    return response.success(res, "Buyurtma o'chirildi");
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

module.exports = {
  createHallBooking,
  getHallBookings,
  updateHallBooking,
  addHallBookingPayment,
  cancelHallBooking,
  deleteHallBooking,
};
