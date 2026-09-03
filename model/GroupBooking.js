const mongoose = require("mongoose");

const groupPaymentSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true, min: 1 },
    type: { type: String, enum: ["naqd", "bank", "karta"], required: true },
    note: { type: String, trim: true, default: "" },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const groupBookingSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: {
      type: String,
      trim: true,
      default: "",
      validate: {
        validator: (value) => !value || /^\+?\d{7,15}$/.test(value),
        message: "Telefon raqami noto'g'ri",
      },
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
      validate: {
        validator: (value) => !value || /^[^\s@]+@gmail\.com$/i.test(value),
        message: "Email @gmail.com formatida bo'lishi kerak",
      },
    },
    bookedForAt: { type: Date, required: true },
    stayDays: { type: Number, required: true, min: 1 },
    dailyRate: { type: Number, required: true, min: 0 },
    mainPaymentType: {
      type: String,
      enum: ["naqd", "bank"],
      default: "naqd",
    },
    note: { type: String, trim: true, default: "" },
    rooms: [{ type: mongoose.Schema.Types.ObjectId, ref: "Room" }],
    guests: [{ type: mongoose.Schema.Types.ObjectId, ref: "Guest" }],
    payments: { type: [groupPaymentSchema], default: [] },
    createdBy: {
      userId: { type: String, default: "" },
      role: { type: String, default: "" },
      login: { type: String, default: "" },
    },
  },
  { timestamps: true },
);

groupBookingSchema.index({ bookedForAt: -1, createdAt: -1 });
groupBookingSchema.index({ guests: 1 });

module.exports = mongoose.model("GroupBooking", groupBookingSchema);
