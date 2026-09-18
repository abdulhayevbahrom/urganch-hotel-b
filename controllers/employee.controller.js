const Employee = require("../model/Employee");
const response = require("../utils/response");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const ACCESS_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "12h";
const REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || "30d";
const REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET_KEY || process.env.JWT_SECRET_KEY;
const EMPLOYEE_LIST_FIELDS =
  "firstname lastname position role salary canLogin login sections isActive createdAt";

const EMPLOYEE_ROLES = ["owner", "manager", "kassir", "other"];
const ROLE_POSITIONS = {
  owner: "Direktor",
  manager: "Manager",
  kassir: "Kassir",
};

const normalizeRole = (value) => {
  const role = String(value || "other").toLowerCase().trim();
  return EMPLOYEE_ROLES.includes(role) ? role : "other";
};

const normalizePosition = (role, position) =>
  ROLE_POSITIONS[role] || String(position || "").trim();

const buildTokenPayload = (employee) => ({
  id: employee._id,
  role: normalizeRole(employee.role),
  login: employee.login,
  sections: employee.sections || [],
  tv: Number(employee.tokenVersion || 1),
});

const signAccessToken = (employee) =>
  jwt.sign(buildTokenPayload(employee), process.env.JWT_SECRET_KEY, {
    expiresIn: ACCESS_EXPIRES_IN,
  });

const signRefreshToken = (employee) =>
  jwt.sign({ id: employee._id, login: employee.login }, REFRESH_SECRET, {
    expiresIn: REFRESH_EXPIRES_IN,
  });

const createEmployee = async (req, res) => {
  try {
    const {
      firstname,
      lastname,
      position,
      role,
      salary,
      canLogin,
      login,
      sections,
      password,
    } = req.body;

    const normalizedRole = normalizeRole(role);
    const normalizedPosition = normalizePosition(normalizedRole, position);
    const normalizedSections = Array.from(
      new Set(Array.isArray(sections) ? sections : []),
    );
    if (!normalizedPosition) {
      return response.error(res, "Boshqa lavozim nomini kiriting");
    }
    if (
      normalizedRole === "owner" &&
      (await Employee.exists({ role: "owner" }))
    ) {
      return response.error(res, "Tizimda faqat bitta owner bo'lishi mumkin");
    }

    let normalizedUsername;
    if (canLogin) {
      normalizedUsername = String(login).toLowerCase().trim();
      const exists = await Employee.findOne({
        login: normalizedUsername,
      });
      if (exists) {
        return response.error(res, "Bu login allaqachon band");
      }
    }

    let hashedPassword;
    if (canLogin) hashedPassword = await bcrypt.hash(String(password), 10);

    const employee = await Employee.create({
      firstname,
      lastname,
      position: normalizedPosition,
      role: normalizedRole,
      salary,
      canLogin,
      login: canLogin ? normalizedUsername : undefined,
      sections: normalizedSections,
      password: canLogin ? hashedPassword : undefined,
    });

    return response.created(res, "Hodim muvaffaqiyatli qo'shildi", employee);
  } catch (error) {
    if (error?.code === 11000 && error?.keyPattern?.role) {
      return response.error(res, "Tizimda faqat bitta owner bo'lishi mumkin");
    }
    return response.serverError(res, error.message);
  }
};

const getEmployees = async (_, res) => {
  try {
    const employees = await Employee.find()
      .select(EMPLOYEE_LIST_FIELDS)
      .sort({ createdAt: -1 })
      .lean();
    return response.success(res, "Hodimlar ro'yxati", employees);
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const getEmployeeById = async (req, res) => {
  try {
    const employee = await Employee.findById(req.params.id);
    if (!employee) return response.notFound(res, "Hodim topilmadi");

    return response.success(res, "Hodim ma'lumotlari", employee);
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const updateEmployee = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = { ...req.body };
    const currentEmployee = await Employee.findById(id);

    if (!currentEmployee) return response.notFound(res, "Hodim topilmadi");

    const nextRole = Object.prototype.hasOwnProperty.call(updates, "role")
      ? normalizeRole(updates.role)
      : normalizeRole(currentEmployee.role);
    if (
      nextRole === "owner" &&
      (await Employee.exists({ role: "owner", _id: { $ne: id } }))
    ) {
      return response.error(res, "Tizimda faqat bitta owner bo'lishi mumkin");
    }
    updates.role = nextRole;
    updates.position = normalizePosition(
      nextRole,
      Object.prototype.hasOwnProperty.call(updates, "position")
        ? updates.position
        : currentEmployee.position,
    );
    if (!updates.position) {
      return response.error(res, "Boshqa lavozim nomini kiriting");
    }

    const nextCanLogin = Object.prototype.hasOwnProperty.call(
      updates,
      "canLogin",
    )
      ? Boolean(updates.canLogin)
      : currentEmployee.canLogin;

    if (nextCanLogin === true) {
      const nextLogin = updates.login
        ? String(updates.login).toLowerCase().trim()
        : currentEmployee.login;

      if (!nextLogin) {
        return response.error(res, "canLogin true bo'lsa login majburiy");
      }

      const exists = await Employee.findOne({
        login: nextLogin,
        _id: { $ne: id },
      });
      if (exists) return response.error(res, "Bu login allaqachon band");
      updates.login = nextLogin;
      updates.canLogin = true;

      if (updates.password) {
        updates.password = await bcrypt.hash(String(updates.password), 10);
      }
    }

    let updateQuery = updates;
    if (nextCanLogin === false) {
      updateQuery = {
        ...updates,
        canLogin: false,
        $unset: { login: 1, password: 1 },
      };
      delete updateQuery.login;
      delete updateQuery.password;
    }

    const roleChanged =
      Object.prototype.hasOwnProperty.call(req.body, "role") &&
      normalizeRole(req.body.role) !== normalizeRole(currentEmployee.role);
    const sectionsChanged =
      Object.prototype.hasOwnProperty.call(req.body, "sections") &&
      JSON.stringify([...(req.body.sections || [])].sort()) !==
        JSON.stringify([...(currentEmployee.sections || [])].sort());
    const shouldInvalidateSession =
      (Object.prototype.hasOwnProperty.call(updates, "isActive") &&
        updates.isActive === false) ||
      roleChanged ||
      sectionsChanged ||
      (Object.prototype.hasOwnProperty.call(req.body, "canLogin") &&
        req.body.canLogin === false);

    if (shouldInvalidateSession) {
      updateQuery.tokenVersion = Number(currentEmployee.tokenVersion || 1) + 1;
      updateQuery.refreshToken = "";
    }

    const employee = await Employee.findByIdAndUpdate(id, updateQuery, {
      returnDocument: "after",
      runValidators: true,
    });

    if (shouldInvalidateSession) {
      const io = req.app.get("socket");
      if (io) {
        io.to(`user:${id}`).emit("force_logout", {
          reason: "employee_access_changed",
        });
      }
    }
    return response.success(res, "Hodim yangilandi", employee);
  } catch (error) {
    if (error?.code === 11000 && error?.keyPattern?.role) {
      return response.error(res, "Tizimda faqat bitta owner bo'lishi mumkin");
    }
    return response.serverError(res, error.message);
  }
};

const deleteEmployee = async (req, res) => {
  try {
    const employee = await Employee.findById(req.params.id);
    if (!employee) return response.notFound(res, "Hodim topilmadi");

    const io = req.app.get("socket");
    if (io) {
      io.to(`user:${employee._id}`).emit("force_logout", {
        reason: "employee_deleted",
      });
    }

    await Employee.findByIdAndDelete(req.params.id);

    return response.success(res, "Hodim o'chirildi");
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const loginEmployee = async (req, res) => {
  try {
    const login = String(req.body.login || "")
      .toLowerCase()
      .trim();
    const password = String(req.body.password || "");

    const employee = await Employee.findOne({
      login,
      canLogin: true,
      isActive: true,
    }).select("+password");

    if (!employee)
      return response.unauthorized(res, "Login yoki parol noto'g'ri");

    const passwordMatch = await bcrypt.compare(
      password,
      employee.password || "",
    );

    if (!passwordMatch)
      return response.unauthorized(res, "Login yoki parol noto'g'ri");

    const normalizedRole = normalizeRole(employee.role);
    const token = signAccessToken(employee);
    const refreshToken = signRefreshToken(employee);
    employee.refreshToken = refreshToken;
    await employee.save();

    return response.success(res, "Muvaffaqiyatli kirildi", {
      token,
      refreshToken,
      user: {
        id: employee._id,
        firstname: employee.firstname,
        lastname: employee.lastname,
        position: employee.position,
        role: normalizedRole,
        sections: employee.sections || [],
      },
    });
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const refreshEmployeeToken = async (req, res) => {
  try {
    const refreshToken = String(req.body.refreshToken || "").trim();
    let payload;
    try {
      payload = jwt.verify(refreshToken, REFRESH_SECRET);
    } catch (error) {
      return response.unauthorized(res, "Refresh token yaroqsiz");
    }

    const employee = await Employee.findOne({
      _id: payload?.id,
      canLogin: true,
      isActive: true,
    }).select("+refreshToken");

    if (!employee || employee.refreshToken !== refreshToken) {
      return response.unauthorized(res, "Refresh token yaroqsiz");
    }

    const nextAccessToken = signAccessToken(employee);
    const nextRefreshToken = signRefreshToken(employee);
    employee.refreshToken = nextRefreshToken;
    await employee.save();

    return response.success(res, "Token yangilandi", {
      token: nextAccessToken,
      refreshToken: nextRefreshToken,
      user: {
        id: employee._id,
        firstname: employee.firstname,
        lastname: employee.lastname,
        position: employee.position,
        role: normalizeRole(employee.role),
        sections: employee.sections || [],
      },
    });
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

module.exports = {
  createEmployee,
  getEmployees,
  getEmployeeById,
  updateEmployee,
  deleteEmployee,
  loginEmployee,
  refreshEmployeeToken,
};
