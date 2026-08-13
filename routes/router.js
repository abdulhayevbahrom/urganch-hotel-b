const router = require("express").Router();
const validate = require("../middleware/validate.middleware");
const {
  createEmployeeSchema,
  updateEmployeeSchema,
  employeeIdParamsSchema,
  loginEmployeeSchema,
  refreshTokenSchema,
} = require("../validations/employee.validation");
const {
  createRoomSchema,
  updateRoomSchema,
  roomIdParamsSchema,
} = require("../validations/room.validation");
const {
  createExpenseSchema,
  updateExpenseSchema,
  expenseIdParamsSchema,
} = require("../validations/expense.validation");
const { updateSettingsSchema } = require("../validations/setting.validation");
const {
  createEmployee,
  getEmployees,
  getEmployeeById,
  updateEmployee,
  deleteEmployee,
  loginEmployee,
  refreshEmployeeToken,
} = require("../controllers/employee.controller");
const {
  createRoom,
  getRooms,
  getRoomById,
  updateRoom,
  deleteRoom,
} = require("../controllers/room.controller");
const {
  createExpense,
  getExpenses,
  updateExpense,
  deleteExpense,
} = require("../controllers/expense.controller");
const { getDashboardSummary } = require("../controllers/dashboard.controller");
const { getReportsSummary } = require("../controllers/reports.controller");
const {
  getSettings,
  updateSettings,
} = require("../controllers/setting.controller");
const { sendSupportMessage } = require("../controllers/support.controller");
const {
  createGuestSchema,
  createGuestsBulkSchema,
  updateGuestSchema,
  guestIdParamsSchema,
  guestPassportParamsSchema,
  addPaymentSchema,
  addGuestServiceSchema,
  vipRequestIdParamsSchema,
  decideVipRequestSchema,
} = require("../validations/guest.validation");
const {
  createServiceSchema,
  updateServiceSchema,
  serviceIdParamsSchema,
} = require("../validations/service.validation");
const {
  hallBookingIdParamsSchema,
  createHallBookingSchema,
  updateHallBookingSchema,
  addHallBookingPaymentSchema,
} = require("../validations/hallBooking.validation");
const {
  sendSupportMessageSchema,
} = require("../validations/support.validation");
const {
  createGuest,
  createGuestsBulk,
  getGuests,
  getOccupancy,
  getGuestById,
  getGuestByPassport,
  getVipRequests,
  getVipRequestsCount,
  decideVipRequest,
  updateGuest,
  addGuestPayment,
  addGuestService,
  checkoutGuest,
  deleteGuest,
} = require("../controllers/guest.controller");
const {
  createService,
  getServices,
  updateService,
  deleteService,
} = require("../controllers/service.controller");
const {
  createHallBooking,
  getHallBookings,
  updateHallBooking,
  addHallBookingPayment,
  cancelHallBooking,
  deleteHallBooking,
} = require("../controllers/hallBooking.controller");

router.post("/employee/login", validate(loginEmployeeSchema), loginEmployee);
router.post(
  "/employee/refresh",
  validate(refreshTokenSchema),
  refreshEmployeeToken,
);
router.post("/employee", validate(createEmployeeSchema), createEmployee);
router.get("/employees", getEmployees);
router.get(
  "/employee/:id",
  validate(employeeIdParamsSchema, "params"),
  getEmployeeById,
);
router.put(
  "/employee/:id",
  validate(employeeIdParamsSchema, "params"),
  validate(updateEmployeeSchema),
  updateEmployee,
);
router.delete(
  "/employee/:id",
  validate(employeeIdParamsSchema, "params"),
  deleteEmployee,
);
router.post("/room", validate(createRoomSchema), createRoom);
router.get("/rooms", getRooms);
router.get("/room/:id", validate(roomIdParamsSchema, "params"), getRoomById);
router.put(
  "/room/:id",
  validate(roomIdParamsSchema, "params"),
  validate(updateRoomSchema),
  updateRoom,
);
router.delete("/room/:id", validate(roomIdParamsSchema, "params"), deleteRoom);
router.post("/expense", validate(createExpenseSchema), createExpense);
router.get("/dashboard", getDashboardSummary);
router.get("/reports-summary", getReportsSummary);
router.get("/expenses", getExpenses);
router.put(
  "/expense/:id",
  validate(expenseIdParamsSchema, "params"),
  validate(updateExpenseSchema),
  updateExpense,
);
router.delete(
  "/expense/:id",
  validate(expenseIdParamsSchema, "params"),
  deleteExpense,
);
router.get("/settings", getSettings);
router.put("/settings", validate(updateSettingsSchema), updateSettings);
router.post("/service", validate(createServiceSchema), createService);
router.get("/services", getServices);
router.put(
  "/service/:id",
  validate(serviceIdParamsSchema, "params"),
  validate(updateServiceSchema),
  updateService,
);
router.delete(
  "/service/:id",
  validate(serviceIdParamsSchema, "params"),
  deleteService,
);
router.post(
  "/hall-booking",
  validate(createHallBookingSchema),
  createHallBooking,
);
router.get("/hall-bookings", getHallBookings);
router.put(
  "/hall-booking/:id",
  validate(hallBookingIdParamsSchema, "params"),
  validate(updateHallBookingSchema),
  updateHallBooking,
);
router.post(
  "/hall-booking/:id/payment",
  validate(hallBookingIdParamsSchema, "params"),
  validate(addHallBookingPaymentSchema),
  addHallBookingPayment,
);
router.post(
  "/hall-booking/:id/cancel",
  validate(hallBookingIdParamsSchema, "params"),
  cancelHallBooking,
);
router.delete(
  "/hall-booking/:id",
  validate(hallBookingIdParamsSchema, "params"),
  deleteHallBooking,
);
router.post("/guest", validate(createGuestSchema), createGuest);
router.post("/guests/bulk", validate(createGuestsBulkSchema), createGuestsBulk);
router.get("/guests", getGuests);
router.get("/occupancy", getOccupancy);
router.get("/vip-requests/count", getVipRequestsCount);
router.get("/vip-requests", getVipRequests);
router.post(
  "/vip-request/:id/decision",
  validate(vipRequestIdParamsSchema, "params"),
  validate(decideVipRequestSchema),
  decideVipRequest,
);
router.get(
  "/guest/by-passport/:passport",
  validate(guestPassportParamsSchema, "params"),
  getGuestByPassport,
);
router.get("/guest/:id", validate(guestIdParamsSchema, "params"), getGuestById);
router.put(
  "/guest/:id",
  validate(guestIdParamsSchema, "params"),
  validate(updateGuestSchema),
  updateGuest,
);
router.post(
  "/guest/:id/payment",
  validate(guestIdParamsSchema, "params"),
  validate(addPaymentSchema),
  addGuestPayment,
);
router.post(
  "/guest/:id/service",
  validate(guestIdParamsSchema, "params"),
  validate(addGuestServiceSchema),
  addGuestService,
);
router.post(
  "/guest/:id/checkout",
  validate(guestIdParamsSchema, "params"),
  checkoutGuest,
);
router.delete("/guest/:id", validate(guestIdParamsSchema, "params"), deleteGuest);
router.post(
  "/support/message",
  validate(sendSupportMessageSchema),
  sendSupportMessage,
);

module.exports = router;
