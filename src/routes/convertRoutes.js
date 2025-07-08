  const express = require('express');
  const router = express.Router();
  const multer = require('multer');
  const path = require('path');

  const {
    convertFile,
    getConversionStatus,
    getConversionHistory,
    downloadConvertedFile,
    deleteSelectedConversions,
    deleteAllConversions
  } = require('../controllers/convertController');

  // Configuración de multer para subida de archivos en memoria
  const storage = multer.memoryStorage();

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

  // Rutas
  router.post('/', upload.single('file'), convertFile);
  router.get('/status/:id', getConversionStatus);
  router.get('/history', getConversionHistory);
    router.get('/download/:id', downloadConvertedFile);
  router.delete('/history/selected', deleteSelectedConversions); // ✅ eliminar por IDs
  router.delete('/history/delete', deleteAllConversions);        // ✅ eliminar todos

  module.exports = router;
