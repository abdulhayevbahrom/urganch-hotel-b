const phonePattern = "^\\+?[0-9]{7,15}$";

const sendSupportMessageSchema = {
  type: "object",
  additionalProperties: false,
  required: ["hotelName", "subject", "complaint", "phone"],
  properties: {
    hotelName: { type: "string", minLength: 1, maxLength: 120 },
    subject: { type: "string", minLength: 1, maxLength: 80 },
    complaint: { type: "string", minLength: 1, maxLength: 500 },
    phone: { type: "string", pattern: phonePattern },
  },
};

module.exports = {
  sendSupportMessageSchema,
};
