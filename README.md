# Sistema Convertidor de Archivos Interno Aloux

Sistema web interno para la conversión de archivos entre diferentes formatos.

## Características

- Conversión entre formatos:
  - JSON ↔ CSV
  - JSON ↔ XLSX
  - (Opcional) XML ↔ JSON
  - (Opcional) YAML ↔ JSON
- Autenticación con JWT
- Roles de usuario (Admin/Usuario)
- Procesamiento asíncrono
- Notificaciones en tiempo real
- Historial de conversiones


## Instalación

1. Clonar el repositorio:
```bash
git clone https://github.com/Melf1852/Convertidor-Aloux.git
cd aloux-converter
```

2. Instalar dependencias:
```bash
npm install
```

3. Configurar variables de entorno:
```bash
cp .env.example .env
```
Editar el archivo `.env` con tus configuraciones.

4. Crear directorio para archivos:
```bash
mkdir src/uploads
```

5. Iniciar el servidor:
```bash
npm run dev
```

## Configuración inicial

### Crear el primer usuario administrador

Para crear el primer usuario administrador, puedes usar el siguiente comando curl o Postman:

```bash
curl -X POST http://localhost:5000/api/auth/users \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "tu-contraseña-segura",
    "role": "admin"
  }'
```

## Uso

### Endpoints

#### Autenticación
- `POST /api/auth/login` - Iniciar sesión
- `POST /api/auth/users` - Crear usuario (solo admin)

#### Usuarios (solo admin)
- `GET /api/users` - Listar todos los usuarios
- `GET /api/users/:id` - Obtener usuario específico
- `PATCH /api/users/:id/role` - Actualizar rol de usuario
- `DELETE /api/users/:id` - Eliminar usuario

#### Conversión de archivos
- `POST /api/convert` - Convertir archivo
- `GET /api/convert/status/:id` - Obtener estado de conversión
- `GET /api/convert/download/:id` - Descargar archivo convertido

#### Historial
- `GET /api/history` - Ver historial de conversiones del usuario
- `GET /api/history/all` - Ver todos los historiales (solo admin)

### Ejemplos de uso

1. Iniciar sesión:
```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "tu-contraseña"
  }'
```

2. Convertir archivo:
```bash
curl -X POST http://localhost:5000/api/convert \
  -H "Authorization: Bearer <token>" \
  -F "file=@/path/to/file.json" \
  -F "sourceFormat=json" \
  -F "targetFormat=csv"
```

3. Verificar estado de conversión:
```bash
curl -X GET http://localhost:5000/api/convert/status/<conversion-id> \
  -H "Authorization: Bearer <token>"
```

4. Descargar archivo convertido:
```bash
curl -X GET http://localhost:5000/api/convert/download/<conversion-id> \
  -H "Authorization: Bearer <token>" \
  --output archivo_convertido
```

## Desarrollo

### Scripts disponibles

- `npm run dev` - Iniciar servidor en modo desarrollo
- `npm start` - Iniciar servidor en modo producción
- `npm test` - Ejecutar pruebas

### Formatos soportados

- **JSON**: Archivos .json
- **CSV**: Archivos .csv
- **Excel**: Archivos .xlsx
- **XML**: Archivos .xml (próximamente)
- **YAML**: Archivos .yml, .yaml (próximamente)

### Límites
- Tamaño máximo de archivo: 5MB
- Formatos permitidos: .json, .csv, .xlsx, .xml, .yml, .yaml

## Licencia

Este proyecto es privado y de uso interno para Aloux. 