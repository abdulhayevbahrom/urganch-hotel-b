const mongoose = require("mongoose");

const expenseSchema = new mongoose.Schema(
  {
    // Xarajat nomi
    title: {
      type: String,
      required: true,
      trim: true,
    },
    // Xarajat turi
    category: {
      type: String,
      required: true,
      trim: true,
    },
    // Xarajat summasi
    amount: {
      type: Number,
      required: true,
      min: 1,
    },
    // To'lov turi
    paymentType: {
      type: String,
      enum: ["naqd", "karta", "click", "bank"],
      required: true,
      default: "naqd",
    },
    // Xarajat qilingan sana
    spentAt: {
      type: Date,
      default: Date.now,
    },
    // Qo'shimcha izoh
    note: {
      type: String,
      trim: true,
      default: "",
    },
    // Kim kiritgani
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

expenseSchema.index({ spentAt: -1, createdAt: -1 });

module.exports = mongoose.model("Expense", expenseSchema);
