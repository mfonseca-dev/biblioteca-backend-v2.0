export default function handler(req, res) {
  res.status(200).json({
    url: process.env.SUPABASE_URL,
    hasKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY
  });
}
