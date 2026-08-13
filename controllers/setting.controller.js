const Setting = require("../model/Setting");
const response = require("../utils/response");
const {
  DEFAULT_HOTEL_SETTINGS,
  getHotelSettings,
  parseTime,
} = require("../utils/hotelSettings");

const getSettings = async (_, res) => {
  try {
    const settings = await getHotelSettings();
    return response.success(res, "Sozlamalar", settings);
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const updateSettings = async (req, res) => {
  try {
    const updates = { ...req.body };
    if (typeof updates.hotelName === "string") {
      updates.hotelName = updates.hotelName.trim();
    }
    if (typeof updates.receiptThankYouText === "string") {
      updates.receiptThankYouText = updates.receiptThankYouText.trim();
    }
    if (typeof updates.logo === "string") {
      updates.logo = updates.logo.trim();
    }

    const current = await getHotelSettings();
    const checkout = parseTime(updates.checkoutTime || current.checkoutTime);
    const reminder = parseTime(updates.reminderTime || current.reminderTime);
    const checkoutMinutes = checkout.hour * 60 + checkout.minute;
    const reminderMinutes = reminder.hour * 60 + reminder.minute;
    if (reminderMinutes >= checkoutMinutes) {
      return response.error(
        res,
        "Ogohlantirish vaqti chiqish vaqtidan oldin bo'lishi kerak",
      );
    }

    const settings = await Setting.findOneAndUpdate(
      {},
      { $set: updates },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();

    return response.success(
      res,
      "Sozlamalar yangilandi",
      { ...DEFAULT_HOTEL_SETTINGS, ...settings },
    );
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

module.exports = {
  getSettings,
  updateSettings,
};
