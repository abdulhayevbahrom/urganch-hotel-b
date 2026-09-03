const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const multer = require("multer");

const ROOM_IMAGES_DIR = path.join(__dirname, "..", "uploads", "rooms");
const MAX_ROOM_IMAGES = 8;
const MAX_IMAGE_SIZE = 8 * 1024 * 1024;

fs.mkdirSync(ROOM_IMAGES_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_, __, callback) => callback(null, ROOM_IMAGES_DIR),
  filename: (_, file, callback) => {
    const extension = path.extname(file.originalname || "").toLowerCase();
    callback(null, `${Date.now()}-${crypto.randomUUID()}${extension}`);
  },
});

const roomImageUpload = multer({
  storage,
  limits: { fileSize: MAX_IMAGE_SIZE, files: MAX_ROOM_IMAGES },
  fileFilter: (_, file, callback) => {
    if (file.mimetype && file.mimetype.startsWith("image/")) return callback(null, true);
    return callback(new multer.MulterError("LIMIT_UNEXPECTED_FILE", "images"));
  },
}).array("images", MAX_ROOM_IMAGES);

const removeUploadedFiles = (files = []) => {
  files.forEach((file) => {
    if (file?.path) fs.unlink(file.path, () => {});
  });
};

const uploadRoomImages = (req, res, next) => {
  roomImageUpload(req, res, (error) => {
    if (!error) return next();
    removeUploadedFiles(req.files);
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ message: "Har bir rasm hajmi 8 MB dan oshmasligi kerak" });
    }
    if (error.code === "LIMIT_FILE_COUNT") {
      return res.status(400).json({ message: "Ko'pi bilan 8 ta rasm yuklash mumkin" });
    }
    return res.status(400).json({ message: "Faqat rasm fayllarini yuklash mumkin" });
  });
};

const parseRoomMultipartBody = (req, res, next) => {
  try {
    if (typeof req.body.prices === "string") req.body.prices = JSON.parse(req.body.prices);
    return next();
  } catch (_) {
    removeUploadedFiles(req.files);
    return res.status(400).json({ message: "Narxlar formati noto'g'ri" });
  }
};

module.exports = {
  MAX_ROOM_IMAGES,
  ROOM_IMAGES_DIR,
  removeUploadedFiles,
  parseRoomMultipartBody,
  uploadRoomImages,
};
