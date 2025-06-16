const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { convertFile, getConversionStatus, downloadConvertedFile } = require('../controllers/convertController');

// Configuración de multer para subida de archivos
const storage = multer.diskStorage({
  
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, '..', 'uploads'));
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const allowedFormats = ['.json', '.csv', '.xlsx', '.xml', '.yml', '.yaml'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedFormats.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Formato de archivo no soportado'));
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  }
});

// Rutas protegidas
router.post('/', upload.single('file'), convertFile);
router.get('/status/:id', getConversionStatus);
router.get('/download/:id', downloadConvertedFile);

module.exports = router;