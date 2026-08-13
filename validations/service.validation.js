const serviceIdParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    id: { type: "string", pattern: "^[0-9a-fA-F]{24}$" },
  },
};

const createServiceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "defaultPrice"],
  properties: {
    name: { type: "string", minLength: 1 },
    defaultPrice: { type: "number", minimum: 0 },
    isActive: { type: "boolean", default: true },
    note: { type: "string" },
  },
};

const updateServiceSchema = {
  type: "object",
  additionalProperties: false,
  minProperties: 1,
  properties: {
    name: { type: "string", minLength: 1 },
    defaultPrice: { type: "number", minimum: 0 },
    isActive: { type: "boolean" },
    note: { type: "string" },
  },
};

module.exports = {
  serviceIdParamsSchema,
  createServiceSchema,
  updateServiceSchema,
};
