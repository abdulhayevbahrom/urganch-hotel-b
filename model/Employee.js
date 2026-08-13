const mongoose = require("mongoose");

const employeeSchema = new mongoose.Schema(
  {
    firstname: {
      type: String,
      required: true,
      trim: true,
    },
    lastname: {
      type: String,
      required: true,
      trim: true,
    },
    position: {
      type: String,
      required: true,
      trim: true,
    },
    salary: {
      type: Number,
      required: true,
      min: 0,
    },
    canLogin: {
      type: Boolean,
      default: false,
    },
    login: {
      type: String,
      unique: true,
      trim: true,
      lowercase: true,
      sparse: true,
    },
    sections: {
      type: [String],
      default: [],
    },
    password: {
      type: String,
      select: false,
    },
    refreshToken: {
      type: String,
      select: false,
      default: "",
    },
    tokenVersion: {
      type: Number,
      default: 1,
      min: 1,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Hodimlar listida createdAt bo'yicha sort ishlatilgani uchun.
employeeSchema.index({ createdAt: -1 });

module.exports = mongoose.model("Employee", employeeSchema);
