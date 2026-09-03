const paymentTypes = ["naqd", "bank", "karta"];
const guestBaseProperties = {
  firstname: { type: "string", minLength: 1 },
  lastname: { type: "string", minLength: 1 },
  passport: { type: "string" },
  birthDate: { type: "string", minLength: 1 },
  phone: { type: "string" },
  email: { type: "string" },
  organization: { type: "string" },
  organizationInn: { type: "string", pattern: "^(?:[0-9]{9})?$" },
  checkInAt: { type: "string" },
  guestType: { type: "string", enum: ["uzb", "chetellik"], default: "uzb" },
  isBlacklisted: { type: "boolean", default: false },
  vip: { type: "boolean", default: false },
  isBooking: { type: "boolean", default: false },
  bookedForDate: { type: "string", minLength: 1 },
  room: { type: "string", pattern: "^[0-9a-fA-F]{24}$" },
  dailyRate: { type: "number", minimum: 0 },
  mainPaymentType: { type: "string", enum: ["naqd", "bank"], default: "naqd" },
  stayDays: { type: "number", minimum: 1 },
  note: { type: "string" },
  initialPaymentAmount: { type: "number", minimum: 0, multipleOf: 1 },
  initialPaymentType: { type: "string", enum: paymentTypes },
};

const createGuestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["firstname", "lastname", "room", "dailyRate", "stayDays"],
  properties: guestBaseProperties,
};

const createGuestsBulkSchema = {
  type: "object",
  additionalProperties: false,
  required: ["room", "dailyRate", "stayDays", "guests"],
  properties: {
    room: { type: "string", pattern: "^[0-9a-fA-F]{24}$" },
    dailyRate: { type: "number", minimum: 0 },
    dailyRates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["day", "amount"],
        properties: {
          day: { type: "number", minimum: 1, multipleOf: 1 },
          amount: { type: "number", minimum: 0, multipleOf: 1 },
        },
      },
    },
    stayDays: { type: "number", minimum: 1 },
    guestType: { type: "string", enum: ["uzb", "chetellik"], default: "uzb" },
    isBooking: { type: "boolean", default: false },
    bookedForDate: { type: "string", minLength: 1 },
    initialPaymentAmount: { type: "number", minimum: 0, multipleOf: 1 },
    initialPaymentType: { type: "string", enum: paymentTypes },
    guests: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["firstname", "lastname"],
        properties: {
          firstname: { type: "string", minLength: 1 },
          lastname: { type: "string", minLength: 1 },
          passport: { type: "string" },
          birthDate: { type: "string", minLength: 1 },
          phone: { type: "string" },
          email: { type: "string" },
          organization: { type: "string" },
          organizationInn: { type: "string", pattern: "^(?:[0-9]{9})?$" },
          note: { type: "string" },
          vip: { type: "boolean", default: false },
        },
      },
    },
  },
};

const updateGuestSchema = {
  type: "object",
  additionalProperties: false,
  minProperties: 1,
  properties: {
    firstname: { type: "string", minLength: 1 },
    lastname: { type: "string", minLength: 1 },
    passport: { type: "string" },
    birthDate: { type: "string", minLength: 1 },
    phone: { type: "string" },
    email: { type: "string" },
    organization: { type: "string" },
    organizationInn: { type: "string", pattern: "^(?:[0-9]{9})?$" },
    room: { type: "string", pattern: "^[0-9a-fA-F]{24}$" },
    checkInAt: { type: "string" },
    checkOutAt: { type: "string", minLength: 1 },
    guestType: { type: "string", enum: ["uzb", "chetellik"] },
    isBlacklisted: { type: "boolean" },
    vip: { type: "boolean" },
    dailyRate: { type: "number", minimum: 0 },
    dailyRates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["day", "amount"],
        properties: {
          day: { type: "number", minimum: 1, multipleOf: 1 },
          amount: { type: "number", minimum: 0, multipleOf: 1 },
        },
      },
    },
    stayDays: { type: "number", minimum: 1 },
    totalAmount: { type: "number", minimum: 0 },
    bookedForAt: { type: "string", minLength: 1 },
    note: { type: "string" },
  },
};

const guestIdParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    id: { type: "string", pattern: "^[0-9a-fA-F]{24}$" },
  },
};

const guestPassportParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["passport"],
  properties: {
    passport: { type: "string", minLength: 1, maxLength: 64 },
  },
};

const guestPaymentParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "paymentIndex"],
  properties: {
    id: { type: "string", pattern: "^[0-9a-fA-F]{24}$" },
    paymentIndex: { type: "string", pattern: "^[0-9]+$" },
  },
};

const bulkCheckoutGuestsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["ids"],
  properties: {
    ids: {
      type: "array",
      minItems: 1,
      items: { type: "string", pattern: "^[0-9a-fA-F]{24}$" },
    },
  },
};

const continueGuestStaySchema = {
  type: "object",
  additionalProperties: false,
  required: ["additionalDays"],
  properties: {
    additionalDays: { type: "number", minimum: 1, maximum: 365, multipleOf: 1 },
  },
};

const addPaymentSchema = {
  type: "object",
  additionalProperties: false,
  required: ["amount", "type"],
  properties: {
    amount: { type: "number", minimum: 1, multipleOf: 1 },
    type: { type: "string", enum: paymentTypes },
    note: { type: "string" },
  },
};

const updatePaymentSchema = {
  type: "object",
  additionalProperties: false,
  required: ["type"],
  properties: {
    amount: { type: "number", minimum: 0, multipleOf: 1 },
    type: { type: "string", enum: paymentTypes },
    note: { type: "string" },
  },
};

const addGuestServiceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "price", "quantity"],
  properties: {
    serviceId: { type: "string", pattern: "^[0-9a-fA-F]{24}$" },
    name: { type: "string", minLength: 1 },
    price: { type: "number", minimum: 0 },
    quantity: { type: "number", minimum: 1, multipleOf: 1 },
    usedAt: { type: "string" },
    note: { type: "string" },
  },
};

const vipRequestIdParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    id: { type: "string", pattern: "^[0-9a-fA-F]{24}$" },
  },
};

const decideVipRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["action"],
  properties: {
    action: { type: "string", enum: ["approve", "reject"] },
    note: { type: "string" },
  },
};

module.exports = {
  createGuestSchema,
  createGuestsBulkSchema,
  updateGuestSchema,
  guestIdParamsSchema,
  guestPassportParamsSchema,
  bulkCheckoutGuestsSchema,
  continueGuestStaySchema,
  addPaymentSchema,
  updatePaymentSchema,
  addGuestServiceSchema,
  vipRequestIdParamsSchema,
  decideVipRequestSchema,
  guestPaymentParamsSchema,
};
