const mongoose = require("mongoose");

const hallPaymentSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true, min: 1 },
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

const hallBookingSchema = new mongoose.Schema(
  {
    hallName: { type: String, required: true, trim: true },
    eventName: { type: String, required: true, trim: true },
    customerFirstname: { type: String, required: true, trim: true },
    customerLastname: { type: String, required: true, trim: true },
    phone: { type: String, trim: true, default: "" },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    totalAmount: { type: Number, required: true, min: 0 },
    paidAmount: { type: Number, default: 0, min: 0 },
    debtAmount: { type: Number, default: 0, min: 0 },
    payments: { type: [hallPaymentSchema], default: [] },
    status: {
      type: String,
      enum: ["active", "canceled"],
      default: "active",
    },
    note: { type: String, trim: true, default: "" },
    createdBy: {
      userId: { type: String, default: "" },
      role: { type: String, default: "" },
      login: { type: String, default: "" },
      firstname: { type: String, default: "" },
      lastname: { type: String, default: "" },
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("HallBooking", hallBookingSchema);
