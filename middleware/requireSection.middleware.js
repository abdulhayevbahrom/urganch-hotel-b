const response = require("../utils/response");
const { hasFullAccess } = require("../utils/roleAccess");

const requireSection = (section) => (req, res, next) => {
  if (hasFullAccess(req.admin?.role)) return next();
  const sections = Array.isArray(req.admin?.sections) ? req.admin.sections : [];
  if (sections.includes(section)) return next();
  return response.forbidden(res, "Bu bo'limga kirish uchun ruxsat yo'q");
};

module.exports = requireSection;
