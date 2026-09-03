require("dotenv").config();
const express = require("express");
const path = require("node:path");
const connectDB = require("./config/dbConfig"); // yoki ./utils/connect
const cors = require("cors");
const mongoose = require("mongoose"); // ⬅️ qo‘shamiz
const applyTimezone = require("./model/mongoose-timezone"); // ⬅️ pluginni chaqiramiz
const PORT = process.env.PORT || 8343;
const notfound = require("./middleware/notfound.middleware");
const router = require("./routes/router");
const authMiddleware = require("./middleware/AuthMiddleware");
const { createServer } = require("node:http");
const { startGuestBillingCron } = require("./jobs/guestBilling.cron");

const soket = require("./socket");

const app = express();
const server = createServer(app);
const io = require("./middleware/socket.header")(server);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// CORS sozlamalari. Brauzerning Origin qiymatida yakuniy `/` bo'lmaydi,
// shuning uchun domenlarni normallashtirib solishtiramiz.
const normalizeOrigin = (value) => String(value || "").replace(/\/+$/, "");
const allowedOrigins = [
  "https://istiqlol-hotel.vercel.app",
  "http://localhost:5173",
  ...(process.env.CLIENT_ORIGINS || "").split(","),
]
  .map((origin) => normalizeOrigin(origin.trim()))
  .filter(Boolean);

const corsOptions = {
  origin(origin, callback) {
    // Postman/curl kabi Origin yubormaydigan so'rovlarga ruxsat beramiz.
    if (!origin || allowedOrigins.includes(normalizeOrigin(origin))) {
      return callback(null, true);
    }
    return callback(new Error("Bu domen uchun CORS ruxsati yo'q"));
  },
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  credentials: true,
};
app.use(cors(corsOptions));

// ⬇️ Mongoose pluginni shu yerda ulaymiz
mongoose.plugin(applyTimezone);

// Socket.IO sozlamalari
app.set("socket", io);
soket.connect(io);

app.use("/api", authMiddleware, router); // Routerlarni ulash
app.get("/", (req, res) => res.send("Salom dunyo")); // Bosh sahifa
app.use(notfound); // 404 middleware

const startServer = async () => {
  try {
    await connectDB();
    startGuestBillingCron(io);
    server.listen(PORT, () => console.log(`http://localhost:${PORT}`));
  } catch (error) {
    console.error("Server ishga tushmadi:", error.message);
    process.exitCode = 1;
  }
};

startServer();
