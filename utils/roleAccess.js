const FULL_ACCESS_ROLES = new Set(["admin", "owner"]);

const normalizeRole = (role = "") => String(role).toLowerCase().trim();

const hasFullAccess = (role = "") => FULL_ACCESS_ROLES.has(normalizeRole(role));

module.exports = { hasFullAccess, normalizeRole };
