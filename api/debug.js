module.exports = function handler(req, res) {
  res.status(200).json({
    ping: 'ok',
    supabase_url: process.env.SUPABASE_URL ? 'configurado' : 'FALTANDO',
    supabase_key: process.env.SUPABASE_SERVICE_ROLE_KEY ? 'configurado' : 'FALTANDO',
    jwt_secret: process.env.JWT_SECRET ? 'configurado' : 'FALTANDO',
    timestamp: new Date().toISOString()
  });
};
```