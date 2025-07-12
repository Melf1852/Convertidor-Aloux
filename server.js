const { httpServer } = require('./api/init');

const PORT = process.env.PORT || 2018;
httpServer.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
  console.log(`Documentación API del convertidor disponible en http://localhost:${PORT}/api-docs`);
  console.log(`Documentación API de IAM disponible en http://localhost:${PORT}/aloux-iam`);
}); 