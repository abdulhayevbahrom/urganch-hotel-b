const mongoose = require("mongoose");

const payrollActionSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["payment", "bonus", "deduction"],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    paymentType: {
      type: String,
      enum: ["naqd", "karta", "bank", "click", ""],
      default: "",
    },
    date: {
      type: Date,
      default: Date.now,
    },
    note: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { timestamps: true },
);

const payrollSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
      index: true,
    },
    month: {
      type: String,
      required: true,
      trim: true,
      match: /^\d{4}-\d{2}$/,
      index: true,
    },
    baseSalary: {
      type: Number,
      required: true,
      min: 0,
    },
    previousBalance: {
      type: Number,
      default: 0,
    },
    bonus: {
      type: Number,
      default: 0,
      min: 0,
    },
    deduction: {
      type: Number,
      default: 0,
      min: 0,
    },
    paidAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    paymentType: {
      type: String,
      enum: ["naqd", "karta", "bank", "click"],
      default: "naqd",
    },
    paidAt: {
      type: Date,
      default: Date.now,
    },
    note: {
      type: String,
      trim: true,
      default: "",
    },
    actions: {
      type: [payrollActionSchema],
      default: [],
    },
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

payrollSchema.index({ employee: 1, month: 1 }, { unique: true });
payrollSchema.index({ month: -1, paidAt: -1 });

payrollSchema.virtual("totalEarned").get(function totalEarned() {
  return Number(this.baseSalary || 0) + Number(this.bonus || 0);
});

payrollSchema.virtual("balance").get(function balance() {
  return (
    Number(this.previousBalance || 0) +
    Number(this.baseSalary || 0) +
    Number(this.bonus || 0) -
    Number(this.deduction || 0) -
    Number(this.paidAmount || 0)
  );
});

payrollSchema.set("toJSON", { virtuals: true });
payrollSchema.set("toObject", { virtuals: true });

module.exports = mongoose.model("Payroll", payrollSchema);
