const path = require("path");
const fs = require("fs");
const fsPromises = require("fs").promises;
const xlsx = require("xlsx");
const { parse } = require("csv-parse");
const { stringify } = require("csv-stringify");
const yaml = require("js-yaml");
const xml2js = require("xml2js");
const Conversion = require("../models/conversionModel");
const jwt = require("jsonwebtoken");
const { sanitizeXmlKeys } = require("../utils/xmlSanitizer");
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const mime = require('mime-types');
const iconv = require('iconv-lite');

let io;
const setIO = (socketIO) => {
  io = socketIO;
};

const getOutputExtension = (format) => {
  switch (format.toLowerCase()) {
    case "json":
      return ".json";
    case "csv":
      return ".csv";
    case "xlsx":
      return ".xlsx";
    case "xml":
      return ".xml";
    case "yaml":
      return ".yml";
    default:
      return ".txt";
  }
};

const convertFile = async (req, res) => {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ message: "No se proporcionó ningún archivo" });
    }

    const token = req.headers.authorization;
    if (!token) {
      return res
        .status(401)
        .json({ message: "No se proporcionó el token de autorización" });
    }

    const tokenLimpio = token.startsWith("Bearer ") ? token.slice(7) : token;
    const decodedToken = jwt.verify(tokenLimpio, process.env.AUTH_SECRET);
    const userId = decodedToken._id;

    let { sourceFormat, targetFormat, columns } = req.body; //columnas del archivo
    let headersMap = req.body.headersMap || null;
    if (typeof headersMap === 'string') {
      try {
        headersMap = JSON.parse(headersMap);
      } catch (e) {
        return res.status(400).json({ message: 'headersMap debe ser un JSON válido' });
      }
    }

    //Verifica que columns sea un arreglo
    if (columns) {
      if (typeof columns === "string") {
        try {
          columns = JSON.parse(columns);
        } catch (err) {
          return res.status(400).json({
            message:
              "El parámetro columns debe ser un array válido en formato JSON",
          });
        }
      } else if (!Array.isArray(columns)) {
        return res
          .status(400)
          .json({ message: "El parámetro columns debe ser un array válido" });
      }
    }

    const originalFileName = req.file.originalname;
    const outputExtension = getOutputExtension(targetFormat);

    // Lee el nombre personalizado del body
    let customName = req.body.fileName;
    let convertedFileName;
    if (customName) {
      // Elimina extensión si el usuario la puso
      customName = path.parse(customName).name;
      // Usa el nombre personalizado + la extensión de salida
      convertedFileName = `${customName}${outputExtension}`;
    } else {
      // Si no hay nombre personalizado, usa el nombre original
      convertedFileName = `${path.parse(req.file.originalname).name}${outputExtension}`;
    }

    const conversion = new Conversion({
      user: userId,
      originalFileName,
      convertedFileName,
      sourceFormat,
      targetFormat,
      status: "processing",
    });

    await conversion.save();

    try {
      // Procesar archivo desde buffer en memoria
      const evidence = await processFileFromBuffer(
        req.file.buffer,
        sourceFormat,
        targetFormat,
        conversion,
        columns,
        headersMap
      );

      await Conversion.findByIdAndUpdate(conversion._id, {
        status: "completed",
        completedAt: new Date(),
        fileUrl: evidence
      });

      if (io) {
        io.emit(`conversion_${conversion._id}`, {
          status: "completed",
          conversionId: conversion._id,
          evidence: evidence,
        });
      }

      res.status(200).json({
        message: "Conversión completada",
        conversionId: conversion._id,
        status: "completed",
        evidence: evidence,
      });
    } catch (error) {
      await Conversion.findByIdAndUpdate(conversion._id, {
        status: "failed",
        error: error.message,
      });

      if (io) {
        io.emit(`conversion_${conversion._id}`, {
          status: "failed",
          error: error.message,
          conversionId: conversion._id,
        });
      }

      throw error;
    }
  } catch (error) {
    console.error("Error en la conversión:", error);
    res.status(500).json({
      message: "Error al procesar el archivo",
      error: error.message,
    });
  }
};

// Nueva función para procesar desde buffer en memoria y subir a S3
const processFileFromBuffer = async (
  fileBuffer,
  sourceFormat,
  targetFormat,
  conversion,
  columns,
  headersMap
) => {
  let data;
  const bufferToString = (buf) => {
    try {
      return buf.toString('utf-8');
    } catch (e) {
      // Si falla, intenta Latin1
      return iconv.decode(buf, 'latin1');
    }
  };

  // Leer archivo según formato de origen desde buffer
  switch (sourceFormat) {
    case "json":
      data = JSON.parse(bufferToString(fileBuffer));
      if (typeof data === "object" && !Array.isArray(data)) {
        const arrayProps = Object.keys(data).filter((key) =>
          Array.isArray(data[key])
        );
        if (arrayProps.length > 0) {
          data = data[arrayProps[0]];
        } else {
          data = [data];
        }
      }
      break;
    case "csv":
      let csvString;
      try {
        csvString = buf.toString('utf-8');
      } catch (e) {
        csvString = iconv.decode(fileBuffer, 'latin1');
      }
      data = await new Promise((resolve, reject) => {
        const results = [];
        const stream = require('stream');
        const bufferStream = new stream.PassThrough();
        bufferStream.end(Buffer.from(csvString, 'utf-8'));
        bufferStream
          .pipe(parse({ columns: true }))
          .on("data", (row) => results.push(row))
          .on("end", () => resolve(results))
          .on("error", reject);
      });
      break;
    case "xlsx":
      const workbook = xlsx.read(fileBuffer, { type: 'buffer' });
      let sheetData = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
      if (headersMap && typeof headersMap === 'object') {
        sheetData = sheetData.map(row => {
          const newRow = {};
          for (const key in row) {
            newRow[headersMap[key] || key] = row[key];
          }
          return newRow;
        });
      }
      data = sheetData;
      break;
    case "yaml":
      data = yaml.load(bufferToString(fileBuffer));
      if (typeof data === "object" && !Array.isArray(data)) {
        const arrayProps = Object.keys(data).filter((key) =>
          Array.isArray(data[key])
        );
        if (arrayProps.length > 0) {
          data = data[arrayProps[0]];
        }
      }
      break;
    case "xml":
      data = await xml2js.parseStringPromise(bufferToString(fileBuffer));
      if (typeof data === "object") {
        const rootKey = Object.keys(data)[0];
        data = data[rootKey];
        const arrayProps = Object.keys(data).filter((key) =>
          Array.isArray(data[key])
        );
        if (arrayProps.length > 0) {
          data = data[arrayProps[0]];
        } else {
          data = [data];
        }
      }
      break;
    default:
      throw new Error("Formato de origen no soportado");
  }

  if (columns && Array.isArray(columns) && columns.length > 0) {
    data = data.map((row) => {
      let filteredRow = {};
      columns.forEach((col) => (filteredRow[col] = row[col]));
      return filteredRow;
    });
  }

  // Convertir a formato de destino y subir a S3
  let outputBuffer;
  let extension = getOutputExtension(targetFormat);
  switch (targetFormat) {
    case "json":
      outputBuffer = Buffer.from(JSON.stringify(data, null, 2), 'utf-8');
      break;
    case "csv":
      outputBuffer = await new Promise((resolve, reject) => {
        stringify(data, {
          header: true,
          columns: data.length > 0 ? Object.keys(data[0]) : [],
        }, (err, output) => {
          if (err) return reject(err);
          resolve(Buffer.from(output, 'utf-8'));
        });
      });
      break;
    case "xlsx":
      const newWorkbook = xlsx.utils.book_new();
      const newSheet = xlsx.utils.json_to_sheet(data);
      xlsx.utils.book_append_sheet(newWorkbook, newSheet, "Sheet1");
      const tmp = xlsx.write(newWorkbook, { type: 'buffer', bookType: 'xlsx' });
      outputBuffer = Buffer.isBuffer(tmp) ? tmp : Buffer.from(tmp);
      break;
    case "yaml":
      outputBuffer = Buffer.from(yaml.dump(data), 'utf-8');
      break;
    case "xml":
      const sanitizedData = sanitizeXmlKeys(data);
      const builder = new xml2js.Builder();
      const rootName = "root";
      const wrappedData = {};
      wrappedData[rootName] = { record: sanitizedData };
      const xml = builder.buildObject(wrappedData);
      outputBuffer = Buffer.from(xml, 'utf-8');
      break;
    default:
      throw new Error("Formato de destino no soportado");
  }

  // Subir a S3 y retornar la URL
  const s3Client = new S3Client({ region: process.env.AWS_REGION });
  const contentType = mime.lookup(extension) || 'application/octet-stream';
  const pathFile = path.parse(conversion.convertedFileName).name;
  const params = {
    Bucket: process.env.AWS_BUCKET,
    Key: pathFile + extension,
    ContentType: contentType,
    Body: outputBuffer,
    ACL: 'public-read',
  };
  const command = new PutObjectCommand(params);
  try {
    await s3Client.send(command);
    const evidence = `https://${process.env.AWS_BUCKET}.s3.amazonaws.com/${pathFile}${extension}`;
    return evidence;
  } catch (error) {
    throw new Error('Error al subir a S3: ' + error.message);
  }
};

const getConversionStatus = async (req, res) => {
  try {
    const conversion = await Conversion.findById(req.params.id);
    if (!conversion) {
      return res.status(404).json({ message: "Conversión no encontrada" });
    }
    res.json(conversion);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error al obtener estado de la conversión" });
  }
};

const getConversionHistory = async (req, res) => {
  try {
    const token = req.headers.authorization;
    if (!token) {
      return res.status(401).json({ message: "No se proporcionó el token" });
    }

    const tokenLimpio = token.startsWith("Bearer ") ? token.slice(7) : token;
    const decodedToken = jwt.verify(tokenLimpio, process.env.AUTH_SECRET);
    const userId = decodedToken._id;

    const history = await Conversion.find({ user: userId })
  .sort({ createdAt: -1 })
  .limit(50)
  .populate({
    path: 'user',
    select: 'name lastName _functions',
    populate: {
      path: '_functions',
      select: 'name' // Esto trae el nombre del rol
    }
  });

    if (!history || history.length === 0) { 
      return res.status(404).json({ message: "No hay conversiones aun" });
    }

    res.json(history);
  } catch (error) {
    console.error("Error al obtener historial:", error);
    res.status(500).json({ message: "Error al obtener historial" });
  }
};

const deleteSelectedConversions = async (req, res) => {
  try {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'No se proporcionaron IDs válidos' });
    }

    const result = await Conversion.deleteMany({ _id: { $in: ids } });

    return res.status(200).json({
      message: 'Procesos eliminados correctamente',
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('Error al eliminar procesos seleccionados:', error);
    return res.status(500).json({ message: 'Error al eliminar procesos seleccionados' });
  }
};

const deleteAllConversions = async (req, res) => {
  try {
    const result = await Conversion.deleteMany({});

    return res.status(200).json({
      message: 'Todos los procesos han sido eliminados',
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('Error al eliminar todos los procesos:', error);
    return res.status(500).json({ message: 'Error al eliminar todos los procesos' });
  }
};

// 👇 Aquí el module.exports COMPLETO, incluyendo todas las funciones usadas en convertRoutes
module.exports = {
  convertFile,
  getConversionStatus,
  getConversionHistory,
  deleteSelectedConversions,
  deleteAllConversions,
  setIO,
};