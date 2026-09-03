const Setting = require("../model/Setting");

const DEFAULT_HOTEL_SETTINGS = {
  hotelName: "Mehmonxona nomi",
  checkoutTime: "12:00",
  reminderTime: "12:00",
  roomCategories: ["standart", "polulyuks", "lyuks", "apartament", "bir_kishilik"],
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

const calculateCheckoutDueAt = (
  checkInAt,
  stayDays,
  checkoutTime = "12:00",
) => {
  const checkIn = new Date(checkInAt);
  const safeStayDays = Math.max(Number(stayDays || 1), 1);
  const checkoutDueAt = applyTimeToDate(checkIn, checkoutTime);
  const arrivedBeforeCheckout = checkIn.getTime() < checkoutDueAt.getTime();
  const daysToAdd = safeStayDays - (arrivedBeforeCheckout ? 1 : 0);
  checkoutDueAt.setDate(checkoutDueAt.getDate() + daysToAdd);
  return checkoutDueAt;
};

const getHotelSettings = async () => {
  let settings = await Setting.findOne().lean();
  if (!settings) {
    settings = await Setting.create(DEFAULT_HOTEL_SETTINGS);
    settings = settings.toObject();
  }
  const roomCategories =
    Array.isArray(settings.roomCategories) && settings.roomCategories.length
      ? settings.roomCategories
      : DEFAULT_HOTEL_SETTINGS.roomCategories;
  return {
    ...DEFAULT_HOTEL_SETTINGS,
    ...settings,
    roomCategories,
  };
};

module.exports = {
  DEFAULT_HOTEL_SETTINGS,
  parseTime,
  applyTimeToDate,
  calculateCheckoutDueAt,
  getHotelSettings,
};
