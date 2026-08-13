const jwt = require("jsonwebtoken");
const VipRequest = require("./model/VipRequest");

const canManageVip = (payload) => {
  if (!payload) return false;
  return String(payload.role || "").toLowerCase() === "admin";
};

const resolveToken = (socket) => {
  const authToken = socket.handshake?.auth?.token;
  if (authToken) return String(authToken).replace(/^Bearer\s+/i, "");

  const headerToken = socket.handshake?.headers?.authorization;
  if (!headerToken) return "";
  return String(headerToken).replace(/^Bearer\s+/i, "");
};

const emitPendingVipCountToSocket = async (socket) => {
  const count = await VipRequest.countDocuments({ status: "pending" });
  socket.emit("vip_pending_count", { count });
};

class SocketService {
  async connect(io) {
    io.on("connection", async (socket) => {
      const token = resolveToken(socket);
      if (token) {
        try {
          const payload = jwt.verify(token, process.env.JWT_SECRET_KEY);
          socket.data.user = payload;
          socket.join(`user:${payload.id}`);

          if (canManageVip(payload)) {
            socket.join("vip-admins");
            try {
              await emitPendingVipCountToSocket(socket);
            } catch (_) {
              // count yuborishda xatolik bo'lsa socket ishlashda davom etadi
            }
          }
        } catch (_) {
          // token noto'g'ri bo'lsa oddiy ulanish sifatida qoladi
        }
      }

      socket.on("register-user", (data = {}) => {
        const role = String(data.role || "").toLowerCase();
        if (role === "admin") {
          socket.join("vip-admins");
          emitPendingVipCountToSocket(socket).catch(() => {});
        }
      });

      socket.on("disconnect", async () => {});
    });
  }
}

module.exports = new SocketService();
