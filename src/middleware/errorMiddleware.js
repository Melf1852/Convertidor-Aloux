const errorHandler = (err, req, res, next) => {
  console.error(err.stack);

  if (err.name === 'ValidationError') {
    return res.status(400).json({
      message: 'Error de validación',
      errors: Object.values(err.errors).map(e => e.message)
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

  res.status(500).json({
    message: 'Error interno del servidor',
    error: process.env.DEBUG === 'true' ? err.message : 'Algo salió mal'
  });
};

module.exports = {
  errorHandler
}; 