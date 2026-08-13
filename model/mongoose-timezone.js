const moment = require("moment-timezone");

module.exports = function (schema) {
  schema.pre("save", function (next) {
    // createdAt
    if (this.isNew && this.createdAt instanceof Date) {
      this.createdAt = moment(this.createdAt).tz("Asia/Tashkent").toDate();
    }

    // updatedAt
    if (this.updatedAt instanceof Date) {
      this.updatedAt = moment(this.updatedAt).tz("Asia/Tashkent").toDate();
    }

    // boshqa barcha Date maydonlarni ham Toshkent vaqtida saqlash
    for (let path in schema.paths) {
      if (
        schema.paths[path].instance === "Date" &&
        this[path] instanceof Date
      ) {
        this[path] = moment(this[path]).tz("Asia/Tashkent").toDate();
      }
    }

    next();
  });
};
