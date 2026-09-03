const guestProperties = {
  firstname: { type: "string", minLength: 1 },
  lastname: { type: "string", minLength: 1 },
  passport: { type: "string" },
  birthDate: { type: "string", minLength: 1 },
  phone: { type: "string" },
  email: { type: "string" },
  note: { type: "string" },
};

const createGroupBookingSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "name",
    "bookedForDate",
    "stayDays",
    "dailyRate",
    "roomAssignments",
  ],
  properties: {
    name: { type: "string", minLength: 1 },
    phone: { type: "string", pattern: "^\\+?[0-9]{7,15}$" },
    email: {
      type: "string",
      pattern: "^[^\\s@]+@gmail\\.com$",
    },
    bookedForDate: { type: "string", minLength: 1 },
    stayDays: { type: "number", minimum: 1 },
    dailyRate: { type: "number", minimum: 0 },
    mainPaymentType: { type: "string", enum: ["naqd", "bank"] },
    note: { type: "string" },
    roomAssignments: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["room", "guests"],
        properties: {
          room: { type: "string", pattern: "^[0-9a-fA-F]{24}$" },
          guests: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              additionalProperties: false,
              properties: guestProperties,
            },
          },
        },
      },
    },
  },
};

const groupBookingIdParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    id: { type: "string", pattern: "^[0-9a-fA-F]{24}$" },
  },
};

const updateGroupBookingSchema = {
  type: "object",
  additionalProperties: false,
  minProperties: 1,
  properties: {
    name: { type: "string", minLength: 1 },
    phone: { type: "string", pattern: "^$|^\\+?[0-9]{7,15}$" },
    email: { type: "string", pattern: "^$|^[^\\s@]+@gmail\\.com$" },
    dailyRate: { type: "number", minimum: 0 },
    mainPaymentType: { type: "string", enum: ["naqd", "bank"] },
    note: { type: "string" },
  },
};

const addGroupPaymentSchema = {
  type: "object",
  additionalProperties: false,
  required: ["amount", "type"],
  properties: {
    amount: { type: "number", minimum: 1, multipleOf: 1 },
    type: { type: "string", enum: ["naqd", "bank", "karta"] },
    note: { type: "string" },
  },
};

module.exports = {
  createGroupBookingSchema,
  updateGroupBookingSchema,
  groupBookingIdParamsSchema,
  addGroupPaymentSchema,
};
