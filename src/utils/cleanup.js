const fs = require('fs').promises;
const path = require('path');

const cleanupUploads = async () => {
  try {
    const uploadsDir = path.join(__dirname, '..', 'uploads');
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000); // 1 hora

    const files = await fs.readdir(uploadsDir);

    for (const file of files) {
      const filePath = path.join(uploadsDir, file);
      try {
        const stats = await fs.stat(filePath);
        if (stats.mtimeMs < oneHourAgo) {
          await fs.unlink(filePath);
          console.log(`Archivo temporal eliminado: ${file}`);
        }
      } catch (err) {
        console.error(`Error procesando ${file}:`, err.message);
      }
    }
  } catch (err) {
    console.error('Error al limpiar uploads:', err.message);
  }
};

module.exports = {
  cleanupUploads
};
