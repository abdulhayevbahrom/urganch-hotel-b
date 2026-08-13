const mongoose = require("mongoose");

const serviceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    defaultPrice: { type: Number, required: true, min: 0, default: 0 },
    isActive: { type: Boolean, default: true },
    note: { type: String, trim: true, default: "" },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Service", serviceSchema);
