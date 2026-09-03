const mongoose = require("mongoose");

const roomSchema = new mongoose.Schema(
  {
    roomNumber: {
      type: String,
      required: true,
      trim: true,
    },
    floor: {
      type: Number,
      required: true,
      min: 1,
    },
    korpus: {
      type: String,
      required: true,
      enum: ["A", "B"],
      trim: true,
    },
    capacity: {
      type: Number,
      required: true,
      min: 1,
      default: 1,
    },
    activeGuestsCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    category: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ["bosh", "band", "remont"],
      default: "bosh",
    },
    prices: {
      oddiy: { type: Number, required: true, min: 0 },
      chetEllik: { type: Number, required: true, min: 0 },
    },
    description: {
      type: String,
      trim: true,
      default: "",
    },
    images: {
      type: [{ type: String, trim: true }],
      default: [],
      validate: {
        validator: (images) => images.length <= 8,
        message: "Ko'pi bilan 8 ta rasm saqlanishi mumkin",
      },
    },
  },
  { timestamps: true },
);

roomSchema.index({ korpus: 1, roomNumber: 1 }, { unique: true });
roomSchema.index({ floor: 1, category: 1 });
roomSchema.index({ korpus: 1, floor: 1, roomNumber: 1 });

module.exports = mongoose.model("Room", roomSchema);
