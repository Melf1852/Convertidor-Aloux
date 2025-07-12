const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const mongoose = require('mongoose');
const { createServer } = require('http');
const { Server } = require('socket.io');
const swaggerUI = require('swagger-ui-express');
const YAML = require('yamljs');
const path = require('path');
const { IAMRouter, IAMSwagger, IAMAuth } = require('aloux-iam');
const methodOverride = require("method-override");
const router = require('./router');
const { errorHandler } = require('./middleware/errorMiddleware');
const { setIO } = require('./controllers/convertController');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.ACCESS_CONTROL_ALLOW_ORIGIN || '*',
    methods: ['GET', 'POST']
  }
});

// Configurar io en el controlador de conversión
setIO(io);

// Middleware
app.use(cors());
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rutas de IAM
app.use(methodOverride());
app.use(IAMRouter);

// Documentación Swagger de IAM
app.use(
  "/aloux-iam",
  swaggerUI.serveFiles(IAMSwagger, {}),
  swaggerUI.setup(IAMSwagger)
);

// Cargar y servir la documentación Swagger del convertidor
const swaggerDocument = YAML.load(path.join(__dirname, 'swagger.yaml'));
app.use('/api-docs', swaggerUI.serve, swaggerUI.setup(swaggerDocument));

// Rutas del convertidor (protegidas con IAM)
app.use('/api', router);

// Middleware de manejo de errores
app.use(errorHandler);

// Conexión a MongoDB
mongoose.connect(process.env.DB, {
  useNewUrlParser: true,
  useCreateIndex: true,
  useFindAndModify: true,
  useUnifiedTopology: true
})
  .then(() => console.log('Conectado a MongoDB'))
  .catch(err => console.error('Error al conectar a MongoDB:', err));

// WebSocket events
io.on('connection', (socket) => {
  console.log('Cliente conectado');

  socket.on('disconnect', () => {
    console.log('Cliente desconectado');
  });
});

module.exports = { app, httpServer }; 