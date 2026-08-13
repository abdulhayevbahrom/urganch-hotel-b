const Setting = require("../model/Setting");

const DEFAULT_HOTEL_SETTINGS = {
  hotelName: "Mehmonxona nomi",
  checkoutTime: "15:00",
  reminderTime: "12:00",
  logo: "",
  receiptThankYouText: "Tashrifingiz uchun rahmat! Yana sizni kutib qolamiz.",
};

const parseTime = (value) => {
  const match = String(value || "").match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return { hour: 0, minute: 0 };
  return { hour: Number(match[1]), minute: Number(match[2]) };
};

const applyTimeToDate = (baseDate, time) => {
  const date = new Date(baseDate);
  const { hour, minute } = parseTime(time);
  date.setHours(hour, minute, 0, 0);
  return date;
};

const getHotelSettings = async () => {
  let settings = await Setting.findOne().lean();
  if (!settings) {
    settings = await Setting.create(DEFAULT_HOTEL_SETTINGS);
    settings = settings.toObject();
  }
  return {
    ...DEFAULT_HOTEL_SETTINGS,
    ...settings,
  };
};

module.exports = {
  DEFAULT_HOTEL_SETTINGS,
  parseTime,
  applyTimeToDate,
  getHotelSettings,
};
