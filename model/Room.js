const mongoose = require("mongoose");

const roomSchema = new mongoose.Schema(
  {
    roomNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    floor: {
      type: Number,
      required: true,
      min: 1,
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
      enum: ["standart", "polulyuks", "lyuks", "apartament", "bir_kishilik"],
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
  },
  { timestamps: true },
);

roomSchema.index({ floor: 1, roomNumber: 1 });
roomSchema.index({ floor: 1, category: 1 });

module.exports = mongoose.model("Room", roomSchema);
