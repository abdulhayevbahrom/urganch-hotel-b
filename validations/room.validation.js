const statuses = ["bosh", "band", "remont"];
const korpusValues = ["A", "B"];

const createRoomSchema = {
  type: "object",
  additionalProperties: false,
  required: ["roomNumber", "floor", "capacity", "category", "prices"],
  properties: {
    roomNumber: { type: "string", minLength: 1 },
    floor: { type: "number", minimum: 1 },
    korpus: { type: "string", enum: korpusValues },
    capacity: { type: "number", minimum: 1 },
    category: { type: "string", minLength: 1, maxLength: 80 },
    prices: {
      type: "object",
      additionalProperties: false,
      required: ["oddiy", "chetEllik"],
      properties: {
        oddiy: { type: "number", minimum: 0 },
        chetEllik: { type: "number", minimum: 0 },
      },
    },
    description: { type: "string" },
    status: { type: "string", enum: statuses },
  },
};

const updateRoomSchema = {
  type: "object",
  additionalProperties: false,
  minProperties: 1,
  properties: {
    roomNumber: { type: "string", minLength: 1 },
    floor: { type: "number", minimum: 1 },
    korpus: { type: "string", enum: korpusValues },
    capacity: { type: "number", minimum: 1 },
    category: { type: "string", minLength: 1, maxLength: 80 },
    prices: {
      type: "object",
      additionalProperties: false,
      properties: {
        oddiy: { type: "number", minimum: 0 },
        chetEllik: { type: "number", minimum: 0 },
      },
    },
    description: { type: "string" },
    status: { type: "string", enum: statuses },
  },
};

const roomIdParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    id: { type: "string", pattern: "^[0-9a-fA-F]{24}$" },
  },
};

module.exports = {
  createRoomSchema,
  updateRoomSchema,
  roomIdParamsSchema,
};
