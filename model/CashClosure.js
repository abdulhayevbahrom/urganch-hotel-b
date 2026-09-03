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

const totalsSchema = new mongoose.Schema(
  {
    naqd: { type: Number, default: 0, min: 0 },
    karta: { type: Number, default: 0, min: 0 },
    bank: { type: Number, default: 0, min: 0 },
    total: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const cashClosureSchema = new mongoose.Schema(
  {
    cashier: {
      type: actionBySchema,
      required: true,
    },
    totals: {
      type: totalsSchema,
      required: true,
      default: () => ({}),
    },
    countedCash: {
      type: Number,
      default: 0,
      min: 0,
    },
    difference: {
      type: Number,
      default: 0,
    },
    transactionCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    note: {
      type: String,
      trim: true,
      default: "",
    },
    adminNote: {
      type: String,
      trim: true,
      default: "",
    },
    approvedBy: {
      type: actionBySchema,
      default: null,
    },
    approvedAt: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ["submitted", "approved", "rejected"],
      default: "submitted",
    },
  },
  { timestamps: true },
);

cashClosureSchema.index({ status: 1, createdAt: -1 });
cashClosureSchema.index({ "cashier.userId": 1, createdAt: -1 });

module.exports = mongoose.model("CashClosure", cashClosureSchema);
