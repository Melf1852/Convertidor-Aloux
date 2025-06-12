const express = require('express');
const router = express.Router();
const IAMAuth = require('../middleware/authMiddleware');
const { User } = require('aloux-iam');
const Conversion = require('../models/conversionModel');

// Obtener historial de conversiones del usuario
router.get('/', IAMAuth, async (req, res) => {
  try {
    const conversions = await Conversion.find({ user: req.user._id })
      .sort({ createdAt: -1 });
    
    res.json(conversions);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener el historial de conversiones' });
  }
});

// Obtener todos los historiales (solo admin)
router.get('/all', IAMAuth, async (req, res) => {
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