const mongoose = require("mongoose");

const actionBySchema = new mongoose.Schema(
  {
    userId: { type: String, default: "" },
    role: { type: String, default: "" },
    login: { type: String, default: "" },
  },
  { _id: false },
);

const vipRequestSchema = new mongoose.Schema(
  {
    guest: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Guest",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },
    requestedBy: {
      type: actionBySchema,
      default: null,
    },
    decidedBy: {
      type: actionBySchema,
      default: null,
    },
    decidedAt: {
      type: Date,
      default: null,
    },
    note: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { timestamps: true },
);

// VIP list endpoint (status + createdAt sort) uchun tezkor index.
vipRequestSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("VipRequest", vipRequestSchema);
