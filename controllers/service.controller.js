const Service = require("../model/Service");
const response = require("../utils/response");

const createService = async (req, res) => {
  try {
    const payload = {
      name: String(req.body.name || "").trim(),
      defaultPrice: Number(req.body.defaultPrice || 0),
      isActive:
        typeof req.body.isActive === "boolean" ? req.body.isActive : true,
      note: String(req.body.note || "").trim(),
    };

    const exists = await Service.findOne({ name: payload.name });
    if (exists) return response.error(res, "Bu xizmat nomi allaqachon mavjud");

    const service = await Service.create(payload);
    return response.created(res, "Xizmat qo'shildi", service);
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const getServices = async (req, res) => {
  try {
    const activeOnly = String(req.query.activeOnly || "").toLowerCase() === "true";
    const filter = activeOnly ? { isActive: true } : {};
    const items = await Service.find(filter).sort({ createdAt: -1 });
    return response.success(res, "Xizmatlar ro'yxati", items);
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const updateService = async (req, res) => {
  try {
    const updates = {};
    if (Object.prototype.hasOwnProperty.call(req.body, "name")) {
      updates.name = String(req.body.name || "").trim();
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "defaultPrice")) {
      updates.defaultPrice = Number(req.body.defaultPrice || 0);
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "isActive")) {
      updates.isActive = Boolean(req.body.isActive);
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "note")) {
      updates.note = String(req.body.note || "").trim();
    }

    const service = await Service.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    });
    if (!service) return response.notFound(res, "Xizmat topilmadi");
    return response.success(res, "Xizmat yangilandi", service);
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

const deleteService = async (req, res) => {
  try {
    const service = await Service.findByIdAndDelete(req.params.id);
    if (!service) return response.notFound(res, "Xizmat topilmadi");
    return response.success(res, "Xizmat o'chirildi");
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

module.exports = {
  createService,
  getServices,
  updateService,
  deleteService,
};
