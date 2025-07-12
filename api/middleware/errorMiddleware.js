const errorHandler = (err, req, res, next) => {
  // Manejar errores de IAM
  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({
      message: 'Token no válido o expirado'
    });
  }

  if (err.name === 'ValidationError') {
    return res.status(400).json({
      message: 'Error de validación',
      errors: Object.values(err.errors).map(error => error.message)
    });
  }

  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      message: 'Token inválido'
    });
  }

  if (err.name === 'MulterError') {
    return res.status(400).json({
      message: 'Error en la carga del archivo',
      error: err.message
    });
  }

  // Error por defecto
  console.error('Error:', err);
  res.status(err.status || 500).json({
    message: err.message || 'Error interno del servidor'
  });
};

module.exports = {
  errorHandler
}; 