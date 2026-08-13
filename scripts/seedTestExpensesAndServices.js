require("dotenv").config();

const mongoose = require("mongoose");
const applyTimezone = require("../model/mongoose-timezone");
const Expense = require("../model/Expense");
const Service = require("../model/Service");

mongoose.plugin(applyTimezone);

const TEST_NOTE = "Test uchun qo'shilgan yozuv";
const SERVICE_PREFIX = "Test xizmat - ";
const EXPENSE_PREFIX = "Test harajat - ";

const makeDate = (dayOffset, hour = 11, minute = 0) => {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  date.setHours(hour, minute, 0, 0);
  return date;
};

const services = [
  ["Nonushta", 45000],
  ["Tushlik", 75000],
  ["Kechki ovqat", 85000],
  ["Kir yuvish", 35000],
  ["Dazmol xizmati", 25000],
  ["Xona tozalash", 30000],
  ["Mini bar", 60000],
  ["Aeroport transfer", 180000],
  ["Spa", 220000],
  ["Sauna", 150000],
  ["Konferens zal", 300000],
  ["Qo'shimcha yotoq", 70000],
  ["Avtoturargoh", 25000],
  ["Gul buyurtma", 90000],
  ["Ekskursiya", 250000],
].map(([name, defaultPrice]) => ({
  name: `${SERVICE_PREFIX}${name}`,
  defaultPrice,
  isActive: true,
  note: TEST_NOTE,
}));

const expenses = [
  ["Elektr energiyasi", "Kommunal", 1250000, "bank"],
  ["Suv ta'minoti", "Kommunal", 620000, "bank"],
  ["Internet", "Aloqa", 350000, "click"],
  ["Kir yuvish vositalari", "Xo'jalik", 480000, "naqd"],
  ["Tozalash vositalari", "Xo'jalik", 390000, "karta"],
  ["Choyshab yangilash", "Inventar", 2100000, "bank"],
  ["Sochiqlar xaridi", "Inventar", 950000, "karta"],
  ["Mini bar mahsulotlari", "Oziq-ovqat", 780000, "naqd"],
  ["Nonushta mahsulotlari", "Oziq-ovqat", 1150000, "naqd"],
  ["Texnik xizmat", "Ta'mirlash", 870000, "karta"],
  ["Lift profilaktikasi", "Ta'mirlash", 1600000, "bank"],
  ["Kantselyariya", "Ofis", 240000, "click"],
  ["Reklama", "Marketing", 1300000, "bank"],
  ["Xavfsizlik xizmati", "Xavfsizlik", 1750000, "bank"],
  ["Bog' parvarishi", "Hudud", 520000, "naqd"],
].map(([title, category, amount, paymentType], index) => ({
  title: `${EXPENSE_PREFIX}${title}`,
  category,
  amount,
  paymentType,
  spentAt: makeDate(-index, 10 + (index % 5)),
  note: TEST_NOTE,
  createdBy: {
    role: "seed",
    login: "test-seed",
  },
}));

const insertMissing = async (Model, uniqueField, documents) => {
  const values = documents.map((document) => document[uniqueField]);
  const existing = await Model.find({ [uniqueField]: { $in: values } })
    .select(uniqueField)
    .lean();
  const existingValues = new Set(
    existing.map((document) => String(document[uniqueField])),
  );
  const missing = documents.filter(
    (document) => !existingValues.has(String(document[uniqueField])),
  );

  if (missing.length) {
    await Model.insertMany(missing, { ordered: false });
  }

  return {
    inserted: missing.length,
    skippedExisting: existing.length,
  };
};

const main = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI .env faylida topilmadi");
  }

  await mongoose.connect(process.env.MONGO_URI);

  const serviceResult = await insertMissing(Service, "name", services);
  const expenseResult = await insertMissing(Expense, "title", expenses);

  const [totalTestServices, totalTestExpenses] = await Promise.all([
    Service.countDocuments({ name: { $regex: `^${SERVICE_PREFIX}` } }),
    Expense.countDocuments({ title: { $regex: `^${EXPENSE_PREFIX}` } }),
  ]);

  console.log(
    JSON.stringify(
      {
        services: {
          ...serviceResult,
          totalTestServices,
        },
        expenses: {
          ...expenseResult,
          totalTestExpenses,
        },
      },
      null,
      2,
    ),
  );
};

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
