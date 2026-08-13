const createExpenseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "category", "amount", "paymentType"],
  properties: {
    title: { type: "string", minLength: 2 },
    category: { type: "string", minLength: 2 },
    amount: { type: "number", minimum: 1 },
    paymentType: { type: "string", enum: ["naqd", "karta", "click", "bank"] },
    spentAt: { type: "string" },
    note: { type: "string" },
  },
};

const updateExpenseSchema = {
  type: "object",
  additionalProperties: false,
  minProperties: 1,
  properties: {
    title: { type: "string", minLength: 2 },
    category: { type: "string", minLength: 2 },
    amount: { type: "number", minimum: 1 },
    paymentType: { type: "string", enum: ["naqd", "karta", "click", "bank"] },
    spentAt: { type: "string" },
    note: { type: "string" },
  },
};

const expenseIdParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    id: { type: "string", pattern: "^[0-9a-fA-F]{24}$" },
  },
};

module.exports = {
  createExpenseSchema,
  updateExpenseSchema,
  expenseIdParamsSchema,
};
