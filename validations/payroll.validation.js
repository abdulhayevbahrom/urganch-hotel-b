const monthPattern = "^\\d{4}-\\d{2}$";
const objectIdPattern = "^[0-9a-fA-F]{24}$";

const payrollIdParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    id: { type: "string", pattern: objectIdPattern },
  },
};

const payrollActionParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "actionId"],
  properties: {
    id: { type: "string", pattern: objectIdPattern },
    actionId: { type: "string", pattern: objectIdPattern },
  },
};

const payrollPreviewQuerySchema = {
  type: "object",
  additionalProperties: false,
  required: ["employeeId", "month"],
  properties: {
    employeeId: { type: "string", pattern: objectIdPattern },
    month: { type: "string", pattern: monthPattern },
  },
};

const createPayrollSchema = {
  type: "object",
  additionalProperties: false,
  required: ["employeeId", "month", "paidAmount", "paymentType"],
  properties: {
    employeeId: { type: "string", pattern: objectIdPattern },
    month: { type: "string", pattern: monthPattern },
    baseSalary: { type: "number", minimum: 0 },
    bonus: { type: "number", minimum: 0, default: 0 },
    deduction: { type: "number", minimum: 0, default: 0 },
    paidAmount: { type: "number", minimum: 0 },
    paymentType: { type: "string", enum: ["naqd", "karta", "bank", "click"] },
    paidAt: { type: "string" },
    note: { type: "string" },
  },
};

const updatePayrollSchema = {
  type: "object",
  additionalProperties: false,
  required: ["type", "amount"],
  properties: {
    type: { type: "string", enum: ["payment", "bonus", "deduction"] },
    amount: { type: "number", minimum: 0 },
    paymentType: { type: "string", enum: ["naqd", "karta", "bank", "click"] },
    date: { type: "string" },
    note: { type: "string" },
  },
};

module.exports = {
  payrollIdParamsSchema,
  payrollActionParamsSchema,
  payrollPreviewQuerySchema,
  createPayrollSchema,
  updatePayrollSchema,
};
