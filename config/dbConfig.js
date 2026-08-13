const mongoose = require("mongoose");

let isConnected = false;

const connectDB = async () => {
  if (isConnected) return;

  try {
    const db = await mongoose.connect(process.env.MONGO_URI);
    isConnected = db.connections[0].readyState;
    console.log("MongoDBga muvaffaqiyatli ulanildi ✅✅✅");
  } catch (error) {
    console.error("MongoDB ulanish xatosi ❌❌❌:", error);
  }
};

module.exports = connectDB;
