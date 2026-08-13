const https = require("https");
const response = require("../utils/response");

const TELEGRAM_API_BASE_URL =
  process.env.TELEGRAM_API_BASE_URL || "https://api.telegram.org";

const postJson = (url, body) =>
  new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const parsedUrl = new URL(url);

    const request = https.request(
      {
        hostname: parsedUrl.hostname,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        port: parsedUrl.port || 443,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          let data = {};
          try {
            data = raw ? JSON.parse(raw) : {};
          } catch (_) {
            data = {};
          }

          resolve({
            statusCode: res.statusCode || 500,
            data,
          });
        });
      },
    );

    request.on("error", reject);
    request.write(payload);
    request.end();
  });

const sendSupportMessage = async (req, res) => {
  try {
    const botToken = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
    const chatId = String(process.env.TELEGRAM_CHAT_ID || "").trim();

    if (!botToken || !chatId) {
      return response.serverError(res, "Support konfiguratsiyasi to'liq emas");
    }

    const { hotelName, subject, complaint, phone } = req.body;
    const senderName = `${req?.admin?.firstname || ""} ${req?.admin?.lastname || ""}`.trim();

    const message = [
      "Yangi shikoyat",
      `Mehmonxona: ${hotelName}`,
      `Mavzu: ${subject}`,
      `Shikoyat: ${complaint}`,
      `Telefon: ${phone}`,
      `Yuboruvchi: ${senderName || "-"}`,
    ].join("\n");

    const telegramResponse = await postJson(
      `${TELEGRAM_API_BASE_URL}/bot${botToken}/sendMessage`,
      {
        chat_id: chatId,
        text: message,
      },
    );

    if (telegramResponse.statusCode >= 400 || telegramResponse?.data?.ok !== true) {
      return response.serverError(
        res,
        "Supportga yuborishda xatolik",
        telegramResponse?.data || null,
      );
    }

    return response.success(
      res,
      "Shikoyatingiz qabul qilindi. Tez orada aloqaga chiqamiz.",
    );
  } catch (error) {
    return response.serverError(res, error.message);
  }
};

module.exports = {
  sendSupportMessage,
};
