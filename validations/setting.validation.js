const timePattern = "^([01]\\d|2[0-3]):([0-5]\\d)$";

const updateSettingsSchema = {
  type: "object",
  additionalProperties: false,
  minProperties: 1,
  properties: {
    hotelName: { type: "string", minLength: 1, maxLength: 120 },
    checkoutTime: { type: "string", pattern: timePattern },
    reminderTime: { type: "string", pattern: timePattern },
    logo: { type: "string" },
    receiptThankYouText: { type: "string" },
  },
};

module.exports = {
  updateSettingsSchema,
};
