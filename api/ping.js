// api/ping.js
module.exports = function handler(req, res) {
  res.status(200).json({ ping: 'ok', supabase: !!process.env.SUPABASE_URL });
};
