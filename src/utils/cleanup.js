const fs = require('fs');
const path = require('path');

const cleanupUploads = () => {
  const uploadsDir = path.join(__dirname, '..', 'uploads');
  const now = Date.now();
  const oneHourAgo = now - (60 * 60 * 1000); // 1 hora en milisegundos

  fs.readdir(uploadsDir, (err, files) => {
    if (err) {
      console.error('Error al leer directorio de uploads:', err);
      return;
    }

    files.forEach(file => {
      const filePath = path.join(uploadsDir, file);
      fs.stat(filePath, (err, stats) => {
        if (err) {
          console.error(`Error al obtener stats de ${file}:`, err);
          return;
        }

        // Eliminar archivos más antiguos de 1 hora
        if (stats.mtimeMs < oneHourAgo) {
          fs.unlink(filePath, err => {
            if (err) {
              console.error(`Error al eliminar ${file}:`, err);
              return;
            }
            console.log(`Archivo temporal eliminado: ${file}`);
          });
        }
      });
    });
  });
};

module.exports = {
  cleanupUploads
}; 