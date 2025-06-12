const express = require('express');
const router = express.Router();
const IAMAuth = require('../middleware/authMiddleware');
const { User } = require('aloux-iam');

// Obtener todos los usuarios (solo admin)
router.get('/', IAMAuth, async (req, res) => {
  try {
    const users = await User.find({}, '-pwd');
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener usuarios' });
  }
});

// Obtener un usuario específico (solo admin)
router.get('/:id', IAMAuth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id, '-pwd');
    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener usuario' });
  }
});

// Actualizar rol de usuario (solo admin)
router.patch('/:id/role', IAMAuth, async (req, res) => {
  try {
    const { role } = req.body;
    if (!['admin', 'user'].includes(role)) {
      return res.status(400).json({ message: 'Rol inválido' });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { role },
      { new: true, select: '-pwd' }
    );

    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    res.json(user);
  } catch (error) {
    res.status(500).json({ message: 'Error al actualizar rol' });
  }
});

// Eliminar usuario (solo admin)
router.delete('/:id', IAMAuth, async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }
    res.json({ message: 'Usuario eliminado exitosamente' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar usuario' });
  }
});

module.exports = router; 