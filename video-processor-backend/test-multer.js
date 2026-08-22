const express = require('express');
const multer = require('multer');
const upload = multer().any();
const app = express();
app.post('/test', upload, (req, res) => {
  res.json({ files: req.files.map(f => f.fieldname) });
});
app.use((err, req, res, next) => {
  res.status(500).json({ error: err.message });
});
app.listen(3002, () => console.log('Test server running on 3002'));
