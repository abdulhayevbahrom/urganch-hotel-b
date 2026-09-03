const mongoose = require("mongoose");

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

const cashTransactionSchema = new mongoose.Schema(
  {
    sourceType: {
      type: String,
      enum: ["guest", "group", "hall"],
      required: true,
    },
    sourceId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    sourcePaymentIndex: {
      type: Number,
      default: null,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 1,
    },
    paymentType: {
      type: String,
      enum: ["naqd", "karta", "bank"],
      required: true,
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
    cashier: {
      type: actionBySchema,
      required: true,
    },
    closure: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CashClosure",
      default: null,
    },
    status: {
      type: String,
      enum: ["open", "submitted", "approved", "rejected"],
      default: "open",
    },
  },
  { timestamps: true },
);

cashTransactionSchema.index({ status: 1, "cashier.userId": 1, paidAt: -1 });
cashTransactionSchema.index({ closure: 1, paidAt: -1 });

module.exports = mongoose.model("CashTransaction", cashTransactionSchema);
