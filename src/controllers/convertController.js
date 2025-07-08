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
const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const mime = require('mime-types');
const iconv = require('iconv-lite');

let io;
const setIO = (socketIO) => {
  io = socketIO;
};

// Configurar cliente S3
const s3Client = new S3Client({ region: process.env.AWS_REGION });

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

    let { sourceFormat, targetFormat, columns } = req.body;
    let headersMap = req.body.headersMap || null;
    if (typeof headersMap === 'string') {
      try {
        headersMap = JSON.parse(headersMap);
      } catch (e) {
        return res.status(400).json({ message: 'headersMap debe ser un JSON válido' });
      }
    }

    if (columns) {
      if (typeof columns === "string") {
        try {
          columns = JSON.parse(columns);
        } catch (err) {
          return res.status(400).json({
            message: "El parámetro columns debe ser un array válido en formato JSON",
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

    let customName = req.body.fileName;
    let convertedFileName;
    if (customName) {
      customName = path.parse(customName).name;
      convertedFileName = `${customName}${outputExtension}`;
    } else {
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
        csvString = fileBuffer.toString('utf-8');
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

// Nueva función para descargar archivos desde S3
const downloadConvertedFile = async (req, res) => {
  try {
    const conversion = await Conversion.findById(req.params.id);
    if (!conversion) {
      return res.status(404).json({ message: "Conversión no encontrada" });
    }

    if (conversion.status !== "completed") {
      return res
        .status(400)
        .json({ message: "La conversión aún no está completa" });
    }

    const bucketName = process.env.AWS_BUCKET;
    const pathFile = path.parse(conversion.convertedFileName).name;
    const extension = getOutputExtension(conversion.targetFormat);
    const fileName = pathFile + extension;

    // Parámetros para S3
    const params = {
      Bucket: bucketName,
      Key: fileName
    };

    try {
      // Verificar si el archivo existe en S3
      const headCommand = new HeadObjectCommand(params);
      const headResult = await s3Client.send(headCommand);
      
      // Obtener el objeto de S3
      const getCommand = new GetObjectCommand(params);
      const s3Object = await s3Client.send(getCommand);
      
      // Configurar headers para la descarga
      res.set({
        'Content-Type': headResult.ContentType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${conversion.convertedFileName}"`,
        'Content-Length': headResult.ContentLength
      });
      
      // Convertir el stream a buffer y enviar
      const chunks = [];
      for await (const chunk of s3Object.Body) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);
      
      res.send(buffer);
      
    } catch (s3Error) {
      console.error('Error al acceder a S3:', s3Error);
      
      if (s3Error.name === 'NoSuchKey' || s3Error.name === 'NotFound') {
        return res.status(404).json({ message: "Archivo no encontrado en S3" });
      }
      
      return res.status(500).json({ 
        message: "Error al descargar el archivo desde S3",
        error: s3Error.message 
      });
    }
    
  } catch (error) {
    console.error("Error en downloadConvertedFile:", error);
    res.status(500).json({ message: "Error al descargar el archivo" });
  }
};

// Versión alternativa usando streams para archivos grandes
const downloadConvertedFileStream = async (req, res) => {
  try {
    const conversion = await Conversion.findById(req.params.id);
    if (!conversion) {
      return res.status(404).json({ message: "Conversión no encontrada" });
    }

    if (conversion.status !== "completed") {
      return res
        .status(400)
        .json({ message: "La conversión aún no está completa" });
    }

    const bucketName = process.env.AWS_BUCKET;
    const pathFile = path.parse(conversion.convertedFileName).name;
    const extension = getOutputExtension(conversion.targetFormat);
    const fileName = pathFile + extension;

    const params = {
      Bucket: bucketName,
      Key: fileName
    };

    try {
      // Verificar si el archivo existe
      const headCommand = new HeadObjectCommand(params);
      const headResult = await s3Client.send(headCommand);
      
      // Configurar headers
      res.set({
        'Content-Type': headResult.ContentType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${conversion.convertedFileName}"`,
        'Content-Length': headResult.ContentLength
      });
      
      // Crear stream de S3 y pipe al response
      const getCommand = new GetObjectCommand(params);
      const s3Object = await s3Client.send(getCommand);
      
      s3Object.Body.on('error', (streamError) => {
        console.error('Error en stream de S3:', streamError);
        if (!res.headersSent) {
          res.status(500).json({ 
            message: "Error al transmitir el archivo",
            error: streamError.message 
          });
        }
      });
      
      s3Object.Body.pipe(res);
      
    } catch (s3Error) {
      console.error('Error al acceder a S3:', s3Error);
      
      if (s3Error.name === 'NoSuchKey' || s3Error.name === 'NotFound') {
        return res.status(404).json({ message: "Archivo no encontrado en S3" });
      }
      
      return res.status(500).json({ 
        message: "Error al descargar el archivo desde S3",
        error: s3Error.message 
      });
    }
    
  } catch (error) {
    console.error("Error en downloadConvertedFileStream:", error);
    res.status(500).json({ message: "Error al descargar el archivo" });
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
          select: 'name'
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

    // Opcional: Eliminar archivos de S3 también
    const conversions = await Conversion.find({ _id: { $in: ids } });
    
    for (const conversion of conversions) {
      try {
        const pathFile = path.parse(conversion.convertedFileName).name;
        const extension = getOutputExtension(conversion.targetFormat);
        const fileName = pathFile + extension;
        
        const deleteParams = {
          Bucket: process.env.AWS_BUCKET,
          Key: fileName
        };
        
        const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
        const deleteCommand = new DeleteObjectCommand(deleteParams);
        await s3Client.send(deleteCommand);
      } catch (s3Error) {
        console.warn(`Error al eliminar archivo de S3: ${s3Error.message}`);
        // Continuar con la eliminación de la base de datos aunque falle S3
      }
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
    // Opcional: Eliminar archivos de S3 también
    const conversions = await Conversion.find({});
    
    for (const conversion of conversions) {
      try {
        const pathFile = path.parse(conversion.convertedFileName).name;
        const extension = getOutputExtension(conversion.targetFormat);
        const fileName = pathFile + extension;
        
        const deleteParams = {
          Bucket: process.env.AWS_BUCKET,
          Key: fileName
        };
        
        const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
        const deleteCommand = new DeleteObjectCommand(deleteParams);
        await s3Client.send(deleteCommand);
      } catch (s3Error) {
        console.warn(`Error al eliminar archivo de S3: ${s3Error.message}`);
        // Continuar con la eliminación de la base de datos aunque falle S3
      }
    }

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

module.exports = {
  convertFile,
  getConversionStatus,
  downloadConvertedFile, // Usar downloadConvertedFileStream para archivos grandes
  getConversionHistory,
  deleteSelectedConversions,
  deleteAllConversions,
  setIO,
};