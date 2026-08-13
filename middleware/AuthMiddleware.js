const response = require("../utils/response");
const jwt = require("jsonwebtoken");
const Employee = require("../model/Employee");

const authMiddleware = async (req, res, next) => {
  try {
    let path = req.originalUrl;

    let openRoutes = ["/api/employee/login", "/api/employee/refresh"];
    if (openRoutes.includes(path)) return next();

    const token = req?.headers?.authorization?.split(" ")[1];
    if (!token) return response.error(res, "Token topilmadi");

    let result = jwt.verify(token, process.env.JWT_SECRET_KEY);

    if (!result) return response.unauthorized(res, "Token yaroqsiz");

    const employee = await Employee.findById(result.id)
      .select(
        "isActive canLogin tokenVersion login position sections firstname lastname",
      )
      .lean();
    if (!employee || !employee.isActive || !employee.canLogin) {
      return response.unauthorized(res, "Session bekor qilingan");
    }

    if (Number(result.tv || 1) !== Number(employee.tokenVersion || 1)) {
      return response.unauthorized(res, "Session bekor qilingan");
    }

    result = {
      id: employee._id,
      role: String(employee.position || "")
        .toLowerCase()
        .trim(),
      login: employee.login,
      sections: employee.sections || [],
      firstname: employee.firstname,
      lastname: employee.lastname,
      tv: Number(employee.tokenVersion || 1),
    };

    req.admin = result;
    next();
  } catch (err) {
    response.unauthorized(res, err.message);
  }
};

module.exports = authMiddleware;
