const mongoose = require("mongoose");
require("dotenv").config();

const Employee = require("../model/Employee");

const shouldApply = process.argv.includes("--apply");
const VALID_ROLES = ["owner", "manager", "kassir", "other"];

const inferRole = (position) => {
  const value = String(position || "").toLowerCase().trim();
  if (["owner", "director", "direktor"].includes(value)) return "owner";
  if (["manager", "menejer"].includes(value)) return "manager";
  if (["kassir", "cashier"].includes(value)) return "kassir";
  return "other";
};

const canonicalPosition = (role, current) => {
  if (role === "owner") return "Direktor";
  if (role === "manager") return "Manager";
  if (role === "kassir") return "Kassir";
  return String(current || "").trim();
};

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  const employees = await Employee.collection
    .find({}, { projection: { firstname: 1, lastname: 1, position: 1, role: 1, sections: 1 } })
    .toArray();

  const changes = employees.map((employee) => {
    const storedRole = String(employee.role || "").toLowerCase().trim();
    const role = VALID_ROLES.includes(storedRole)
      ? storedRole
      : inferRole(employee.position);
    const position = canonicalPosition(role, employee.position);
    const sections = Array.from(
      new Set(Array.isArray(employee.sections) ? employee.sections : []),
    );
    return {
      _id: employee._id,
      name: `${employee.firstname || ""} ${employee.lastname || ""}`.trim(),
      fromPosition: employee.position,
      role,
      position,
      sections,
    };
  });

  const ownerCandidates = changes.filter((item) => item.role === "owner");
  console.log(
    JSON.stringify(
      {
        mode: shouldApply ? "apply" : "dry-run",
        employeeCount: changes.length,
        ownerCount: ownerCandidates.length,
        changes: changes.map(({ name, fromPosition, role, position }) => ({
          name,
          fromPosition,
          role,
          position,
        })),
      },
      null,
      2,
    ),
  );

  if (ownerCandidates.length > 1) {
    throw new Error("Bir nechta owner aniqlandi. Migratsiya to'xtatildi");
  }

  if (shouldApply) {
    for (const item of changes) {
      await Employee.collection.updateOne(
        { _id: item._id },
        { $set: { role: item.role, position: item.position, sections: item.sections } },
      );
    }
    await Employee.syncIndexes();
    console.log(`Yangilandi: ${changes.length} ta hodim`);
  }

  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error(error.message || error);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
