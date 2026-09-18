require("dotenv").config();

const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const Employee = require("../model/Employee");

const OWNER_LOGIN = "admin";
const OWNER_PASSWORD = "admin123";

const main = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI .env faylida topilmadi");
  }

  await mongoose.connect(process.env.MONGO_URI);

  const hashedPassword = await bcrypt.hash(OWNER_PASSWORD, 10);
  const result = await Employee.findOneAndUpdate(
    { login: OWNER_LOGIN },
    {
      $set: {
        firstname: "Admin",
        lastname: "Owner",
        position: "owner",
        salary: 0,
        canLogin: true,
        login: OWNER_LOGIN,
        password: hashedPassword,
        sections: [],
        isActive: true,
      },
      $inc: { tokenVersion: 1 },
    },
    { returnDocument: "after", upsert: true, setDefaultsOnInsert: true },
  ).select("firstname lastname position login canLogin isActive");

  console.log("Owner tayyor:", {
    id: result._id,
    login: result.login,
    role: result.position,
    canLogin: result.canLogin,
    isActive: result.isActive,
  });
};

main()
  .catch((error) => {
    console.error("Owner yaratishda xatolik:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close();
  });
