require("dotenv").config();
const express = require("express");
const connectDB = require("./config/dbConfig"); // yoki ./utils/connect
const cors = require("cors");
const mongoose = require("mongoose"); // ⬅️ qo‘shamiz
const applyTimezone = require("./model/mongoose-timezone"); // ⬅️ pluginni chaqiramiz

const PORT = process.env.PORT || 8100;
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

// CORS sozlamalari. Brauzerning Origin qiymatida yakuniy `/` bo'lmaydi,
// shuning uchun domenlarni normallashtirib solishtiramiz.
const normalizeOrigin = (value) => String(value || "").replace(/\/+$/, "");
const allowedOrigins = [
  "http://localhost:5173",
  "https://hotel-demo-f.vercel.app",
  "https://demo.my-hotels.uz",
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

(async () => await connectDB())();

// Socket.IO sozlamalari
app.set("socket", io);
soket.connect(io);
startGuestBillingCron(io);

app.use("/api", authMiddleware, router); // Routerlarni ulash
app.get("/", (req, res) => res.send("Salom dunyo")); // Bosh sahifa
app.use(notfound); // 404 middleware

// Serverni ishga tushirish
server.listen(PORT, () => console.log(`http://localhost:${PORT}`));
