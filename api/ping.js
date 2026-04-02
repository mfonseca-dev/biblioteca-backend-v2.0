module.exports = function handler(req, res) {
  res.status(200).json({ ping: 'ok', timestamp: new Date().toISOString() });
};
```
