const createEmployeeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["firstname", "lastname", "position", "salary"],
  properties: {
    firstname: { type: "string", minLength: 1 },
    lastname: { type: "string", minLength: 1 },
    position: { type: "string", minLength: 1 },
    salary: { type: "number", minimum: 0 },
    canLogin: { type: "boolean", default: false },
    login: { type: "string", minLength: 3 },
    password: { type: "string", minLength: 4 },
    sections: {
      type: "array",
      default: [],
      items: { type: "string", minLength: 1 },
    },
  },
  allOf: [
    {
      if: {
        properties: { canLogin: { const: true } },
      },
      then: {
        required: ["login", "password"],
      },
    },
  ],
};

const updateEmployeeSchema = {
  type: "object",
  additionalProperties: false,
  minProperties: 1,
  properties: {
    firstname: { type: "string", minLength: 1 },
    lastname: { type: "string", minLength: 1 },
    position: { type: "string", minLength: 1 },
    salary: { type: "number", minimum: 0 },
    canLogin: { type: "boolean" },
    login: { type: "string", minLength: 3 },
    password: { type: "string", minLength: 4 },
    sections: {
      type: "array",
      items: { type: "string", minLength: 1 },
    },
    isActive: { type: "boolean" },
  },
};

const employeeIdParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    id: {
      type: "string",
      pattern: "^[0-9a-fA-F]{24}$",
    },
  },
};

const loginEmployeeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["login", "password"],
  properties: {
    login: { type: "string", minLength: 3 },
    password: { type: "string", minLength: 4 },
  },
};

const refreshTokenSchema = {
  type: "object",
  additionalProperties: false,
  required: ["refreshToken"],
  properties: {
    refreshToken: { type: "string", minLength: 10 },
  },
};

module.exports = {
  createEmployeeSchema,
  updateEmployeeSchema,
  employeeIdParamsSchema,
  loginEmployeeSchema,
  refreshTokenSchema,
};
