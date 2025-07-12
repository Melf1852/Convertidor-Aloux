# Convertidor de Archivos - Backend

Sistema de conversión de archivos que permite transformar entre diferentes formatos (JSON, CSV, XLSX, XML, YAML).

## 🚀 Características

- Conversión entre múltiples formatos
- Autenticación y autorización con Aloux IAM
- Historial de conversiones
- Notificaciones en tiempo real
- Documentación API con Swagger
- Manejo de errores robusto

## 📋 Formatos Soportados

- JSON ↔️ CSV, XLSX, XML, YAML
- CSV ↔️ JSON, XLSX, XML
- XLSX ↔️ JSON, CSV, XML
- XML ↔️ JSON, CSV, XLSX, YAML
- YAML ↔️ JSON, XML

## 🛠️ Requisitos

- Node.js v22.15.0 o superior
- MongoDB
- Variables de entorno configuradas

## ⚙️ Configuración

1. **Instalar dependencias:**
```bash
npm install
```

2. **Configurar variables de entorno:**
- Copiar `.env.example` a `.env`
- Configurar las variables necesarias:
  ```
  PORT=2018
  DB=mongodb://localhost:27017/converter
  ACCESS_CONTROL_ALLOW_ORIGIN=http://localhost:3000
  ```

## 🚀 Iniciar el Servidor

**Desarrollo:**
```bash
npm start
```

## 📚 Documentación API

La documentación de la API está disponible en:
- `/api-docs` - Documentación del Convertidor
- `/aloux-iam` - Documentación de IAM

## 🔐 Endpoints Principales

### Conversión
- `POST /api/convert` - Convertir archivo
- `GET /api/convert/status/:id` - Estado de conversión
- `GET /api/convert/download/:id` - Descargar archivo convertido

### Historial
- `GET /api/history` - Historial del usuario
- `GET /api/history/all` - Historial completo (admin)
- `DELETE /api/convert/history/selected` - Eliminar conversiones seleccionadas
- `DELETE /api/convert/history/delete` - Eliminar todo el historial

## 🔧 Estructura del Proyecto

```
back/
├── api/
│   ├── controllers/     # Lógica de negocio
│   ├── middleware/      # Middlewares personalizados
│   ├── models/         # Modelos de datos
│   ├── utils/          # Utilidades
│   ├── init.js         # Configuración de la aplicación
│   ├── router.js       # Rutas de la API
│   └── swagger.yaml    # Documentación API
├── static/             # Archivos estáticos
├── .env               # Variables de entorno
└── server.js          # Punto de entrada
```

## 🔒 Seguridad

- Autenticación mediante tokens JWT
- Validación de tipos de archivo
- Límite de tamaño de archivo (5MB)
- Sanitización de datos
- Headers de seguridad con Helmet

## ⚡ WebSockets

El sistema utiliza Socket.IO para:
- Progreso de conversión en tiempo real
- Notificaciones de finalización
- Estado de las operaciones

## 🤝 Integración con Aloux IAM

El sistema utiliza Aloux IAM para:
- Autenticación de usuarios
- Control de acceso basado en roles
- Gestión de permisos

## 📝 Logs y Monitoreo

- Registro de conversiones en MongoDB
- Tracking de errores
- Monitoreo de estado del servidor

## ⚠️ Manejo de Errores

- Errores de conversión
- Errores de archivo
- Errores de autenticación
- Errores de base de datos

## 👥 Contribución

Para contribuir al proyecto:
1. Hacer fork del repositorio
2. Crear una rama para tu feature
3. Hacer commit de tus cambios
4. Crear un pull request

## 📄 Licencia

ISC - Aloux 