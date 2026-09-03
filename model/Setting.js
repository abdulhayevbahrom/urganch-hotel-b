const mongoose = require("mongoose");

const settingSchema = new mongoose.Schema(
  {
    hotelName: {
      type: String,
      default: "Mehmonxona nomi",
      trim: true,
    },
    checkoutTime: {
      type: String,
      default: "15:00",
      trim: true,
    },
    reminderTime: {
      type: String,
      default: "12:00",
      trim: true,
    },
    roomCategories: {
      type: [String],
      default: ["standart", "polulyuks", "lyuks", "apartament", "bir_kishilik"],
    },
    logo: {
      type: String,
      default: "",
      trim: true,
    },
    receiptThankYouText: {
      type: String,
      default: "Tashrifingiz uchun rahmat! Yana sizni kutib qolamiz.",
      trim: true,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Setting", settingSchema);
