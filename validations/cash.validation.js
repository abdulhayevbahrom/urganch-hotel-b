const objectIdPattern = "^[0-9a-fA-F]{24}$";

const closeCashSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    countedCash: { type: "number", minimum: 0 },
    note: { type: "string", maxLength: 500 },
  },
};

const cashClosureIdParamsSchema = {
  type: "object",
  required: ["id"],
  additionalProperties: false,
  properties: {
    id: { type: "string", pattern: objectIdPattern },
  },
};

const decideCashClosureSchema = {
  type: "object",
  required: ["action"],
  additionalProperties: false,
  properties: {
    action: { type: "string", enum: ["approve", "reject"] },
    adminNote: { type: "string", maxLength: 500 },
  },
};

module.exports = {
  closeCashSchema,
  cashClosureIdParamsSchema,
  decideCashClosureSchema,
};
