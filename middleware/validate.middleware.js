const Ajv = require("ajv");
const response = require("../utils/response");

const ajv = new Ajv({
  allErrors: true,
  removeAdditional: true,
  useDefaults: true,
  coerceTypes: true,
});
try {
  // ajv-formats o'rnatilgan bo'lsa date-time kabi formatlarni yoqadi
  const addFormats = require("ajv-formats");
  addFormats(ajv);
} catch (_) {
  // paket o'rnatilmagan bo'lsa ham validatsiya ishlayveradi
}

try {
  // ajv-errors bo'lsa schema ichida errorMessage ishlatish mumkin bo'ladi
  const ajvErrors = require("ajv-errors");
  ajvErrors(ajv);
} catch (_) {
  // paket o'rnatilmagan bo'lsa default xatolar ishlaydi
}

const formatError = (error) => {
  const field = error.instancePath ? error.instancePath.replace("/", "") : "";
  if (error.keyword === "required") return `${error.params.missingProperty} majburiy`;
  if (!field) return error.message || "Validation xato";
  return `${field}: ${error.message}`;
};

const validate = (schema, source = "body") => {
  const validateSchema = ajv.compile(schema);

  return (req, res, next) => {
    const valid = validateSchema(req[source]);
    if (valid) return next();

    const errors = validateSchema.errors || [];
    return response.error(
      res,
      "Validation xato",
      errors.map(formatError)
    );
  };
};

module.exports = validate;
