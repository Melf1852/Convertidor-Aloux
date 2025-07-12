const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { User } = require('aloux-iam');
const Conversion = require('./models/conversionModel');
const authMiddleware = require('./middleware/authMiddleware');

const {
  convertFile,
  getConversionStatus,
  getConversionHistory,
  downloadConvertedFile,
  deleteSelectedConversions,
  deleteAllConversions
} = require('./controllers/convertController');

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

// Rutas de conversión
router.post('/convert', authMiddleware, upload.single('file'), convertFile);
router.get('/convert/status/:id', authMiddleware, getConversionStatus);
router.get('/convert/history', authMiddleware, getConversionHistory);
router.get('/convert/download/:id', authMiddleware, downloadConvertedFile);
router.delete('/convert/history/selected', authMiddleware, deleteSelectedConversions);
router.delete('/convert/history/delete', authMiddleware, deleteAllConversions);

// Rutas de historial
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const conversions = await Conversion.find({ user: req.user._id })
      .sort({ createdAt: -1 });
    
    res.json(conversions);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener el historial de conversiones' });
  }
});

router.get('/history/all', authMiddleware, async (req, res) => {
  try {
    const conversions = await Conversion.find()
      .populate('user', 'name lastName email')
      .sort({ createdAt: -1 });
    
    res.json(conversions);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener el historial de conversiones' });
  }
});

module.exports = router; 