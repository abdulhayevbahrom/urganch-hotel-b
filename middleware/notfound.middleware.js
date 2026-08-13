const notfound = (req, res, next) => {
  const path = req.originalUrl;
  res.status(404).json({
    message: `"${path}" bunday route mavjud emas`,
    status: "info",
    status_code: 404,
    path: path,
  });
};

module.exports = notfound;
