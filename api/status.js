module.exports = function handler(req, res) {
  const jev = typeof process.env.JEV_API_KEY === "string" && process.env.JEV_API_KEY.trim() !== "";
  const openai =
    typeof process.env.OPENAI_API_KEY === "string" && process.env.OPENAI_API_KEY.trim() !== "";
  res.status(200).json({
    jevEnv: jev,
    openaiEnv: openai,
    corpus: 41,
    product: "memo-relatedness",
  });
};
