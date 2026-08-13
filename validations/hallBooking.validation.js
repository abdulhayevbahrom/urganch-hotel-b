const hallBookingIdParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    id: { type: "string", pattern: "^[0-9a-fA-F]{24}$" },
  },
};

const createHallBookingSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "hallName",
    "eventName",
    "customerFirstname",
    "customerLastname",
    "startDate",
    "endDate",
    "totalAmount",
  ],
  properties: {
    hallName: { type: "string", minLength: 1 },
    eventName: { type: "string", minLength: 1 },
    customerFirstname: { type: "string", minLength: 1 },
    customerLastname: { type: "string", minLength: 1 },
    phone: { type: "string" },
    startDate: { type: "string", minLength: 1 },
    endDate: { type: "string", minLength: 1 },
    totalAmount: { type: "number", minimum: 0 },
    paidAmount: { type: "number", minimum: 0 },
    note: { type: "string" },
  },
};

const updateHallBookingSchema = {
  type: "object",
  additionalProperties: false,
  minProperties: 1,
  properties: {
    hallName: { type: "string", minLength: 1 },
    eventName: { type: "string", minLength: 1 },
    customerFirstname: { type: "string", minLength: 1 },
    customerLastname: { type: "string", minLength: 1 },
    phone: { type: "string" },
    startDate: { type: "string", minLength: 1 },
    endDate: { type: "string", minLength: 1 },
    totalAmount: { type: "number", minimum: 0 },
    note: { type: "string" },
  },
};

const addHallBookingPaymentSchema = {
  type: "object",
  additionalProperties: false,
  required: ["amount", "type"],
  properties: {
    amount: { type: "number", minimum: 1, multipleOf: 1 },
    type: { type: "string", enum: ["naqd", "click", "bank", "karta"] },
    note: { type: "string" },
  },
};

module.exports = {
  hallBookingIdParamsSchema,
  createHallBookingSchema,
  updateHallBookingSchema,
  addHallBookingPaymentSchema,
};
