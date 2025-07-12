// Función para quitar acentos de una cadena
function removeAccents(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Función para limpiar nombres de propiedades para XML
function sanitizeXmlKeys(obj) {
  if (Array.isArray(obj)) {
    return obj.map(sanitizeXmlKeys);
  } else if (obj !== null && typeof obj === 'object') {
    const sanitized = {};
    for (const key in obj) {
      if (Object.hasOwn(obj, key)) {
        // Primero quitamos acentos
        let newKey = removeAccents(key);
        // Luego reemplazamos caracteres inválidos por guion bajo y evitamos que empiece con número
        newKey = newKey.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
        if (/^[0-9]/.test(newKey)) {
          newKey = '_' + newKey;
        }
        sanitized[newKey] = sanitizeXmlKeys(obj[key]);
      }
    }
    return sanitized;
  }
  return obj;
}

module.exports = { sanitizeXmlKeys }; 