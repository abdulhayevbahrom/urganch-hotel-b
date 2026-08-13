const mongoose = require("mongoose");

// Mijozning har bir to'lov yozuvi
const paymentSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true, min: 0 },
    type: {
      type: String,
      enum: ["naqd", "click", "bank", "karta"],
      required: true,
    },
    note: { type: String, trim: true, default: "" },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

// Mehmon foydalangan qo'shimcha xizmat yozuvi
const guestServiceSchema = new mongoose.Schema(
  {
    serviceId: { type: mongoose.Schema.Types.ObjectId, ref: "Service" },
    name: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1, default: 1 },
    totalAmount: { type: Number, required: true, min: 0 },
    usedAt: { type: Date, default: Date.now },
    note: { type: String, trim: true, default: "" },
    createdBy: {
      userId: { type: String, default: "" },
      role: { type: String, default: "" },
      login: { type: String, default: "" },
      firstname: { type: String, default: "" },
      lastname: { type: String, default: "" },
    },
  },
  { _id: false },
);

// Amal bajargan xodim ma'lumoti (qabul, checkout, VIP tasdiq)
const actionBySchema = new mongoose.Schema(
  {
    userId: { type: String, default: "" },
    role: { type: String, default: "" },
    login: { type: String, default: "" },
    firstname: { type: String, default: "" },
    lastname: { type: String, default: "" },
  },
  { _id: false },
);

const guestSchema = new mongoose.Schema(
  {
    // Shaxsiy ma'lumotlar
    firstname: { type: String, required: true, trim: true },
    lastname: { type: String, required: true, trim: true },
    passport: { type: String, trim: true, default: "" },
    birthDate: { type: Date, required: true },
    phone: { type: String, trim: true, default: "" },
    guestType: { type: String, enum: ["uzb", "chetellik"], default: "uzb" },
    isBlacklisted: { type: Boolean, default: false },

    // VIP holati va tasdiqlash jarayoni
    vip: { type: Boolean, default: false },
    vipRequestStatus: {
      type: String,
      enum: ["none", "pending", "approved", "rejected"],
      default: "none",
    },
    vipRequestedBy: { type: actionBySchema, default: null },
    vipApprovedBy: { type: actionBySchema, default: null },
    vipApprovedAt: { type: Date, default: null },

    // Yashash ma'lumotlari
    room: { type: mongoose.Schema.Types.ObjectId, ref: "Room", required: true },
    stayDays: { type: Number, required: true, min: 1, default: 1 }, // Kunlar
    billableDays: { type: Number, required: true, min: 1, default: 1 }, // Narxlanadigan kunlar
    checkoutReminderAt: { type: Date, default: null }, // Checkoutni qoldirish vaqt
    checkoutDueAt: { type: Date, default: null }, // Checkout qilish vaqt

    // Narx va qarzdorlik
    dailyRate: { type: Number, required: true, min: 0 },
    totalAmount: { type: Number, required: true, min: 0 },
    paidAmount: { type: Number, default: 0, min: 0 },
    debtAmount: { type: Number, default: 0, min: 0 },
    payments: { type: [paymentSchema], default: [] },
    services: { type: [guestServiceSchema], default: [] },

    // Holat va kim bajargani
    status: {
      type: String,
      enum: ["booked", "active", "checked_out"],
      default: "active",
    },
    bookedForAt: { type: Date, default: null },
    acceptedBy: { type: actionBySchema, default: null },
    checkoutBy: { type: actionBySchema, default: null },
    checkInAt: { type: Date, default: Date.now },
    checkOutAt: { type: Date, default: null },

    // Qo'shimcha izoh
    note: { type: String, trim: true, default: "" },
  },
  { timestamps: true },
);

// Tezkor list/filter uchun non-unique indekslar
guestSchema.index({ status: 1, createdAt: -1 });
guestSchema.index({ status: 1, bookedForAt: 1 });
guestSchema.index({ status: 1, checkoutDueAt: 1, checkoutReminderAt: 1, createdAt: -1 });
guestSchema.index({ status: 1, debtAmount: 1, createdAt: -1 });
guestSchema.index({ room: 1, status: 1, createdAt: -1 });
guestSchema.index({ guestType: 1, vip: 1, status: 1, createdAt: -1 });
guestSchema.index({ checkInAt: -1 });
guestSchema.index({ "payments.createdAt": -1 });
guestSchema.index({ checkOutAt: -1, status: 1 });

module.exports = mongoose.model("Guest", guestSchema);
