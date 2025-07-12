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
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} = require("@aws-sdk/client-s3");
const mime = require("mime-types");
const iconv = require("iconv-lite");

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
    if (typeof headersMap === "string") {
      try {
        headersMap = JSON.parse(headersMap);
      } catch (e) {
        return res
          .status(400)
          .json({ message: "headersMap debe ser un JSON válido" });
      }
    }

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

    let customName = req.body.fileName;
    let convertedFileName;
    if (customName) {
      customName = path.parse(customName).name;
      convertedFileName = `${customName}${outputExtension}`;
    } else {
      convertedFileName = `${
        path.parse(req.file.originalname).name
      }${outputExtension}`;
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
      return buf.toString("utf-8");
    } catch (e) {
      return iconv.decode(buf, "latin1");
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
        csvString = fileBuffer.toString("utf-8");
      } catch (e) {
        csvString = iconv.decode(fileBuffer, "latin1");
      }
      data = await new Promise((resolve, reject) => {
        const results = [];
        const stream = require("stream");
        const bufferStream = new stream.PassThrough();
        bufferStream.end(Buffer.from(csvString, "utf-8"));
        bufferStream
          .pipe(parse({ columns: true }))
          .on("data", (row) => results.push(row))
          .on("end", () => resolve(results))
          .on("error", reject);
      });

      // Aplicar headersMap para CSV igual que para XLSX
      if (headersMap && typeof headersMap === "object") {
        data = data.map((row) => {
          const newRow = {};
          for (const key in row) {
            newRow[headersMap[key] || key] = row[key];
          }
          return newRow;
        });
      }
      break;

    case "xlsx":
      const workbook = xlsx.read(fileBuffer, { type: "buffer", cellDates: true });
      let sheetData = xlsx.utils.sheet_to_json(
        workbook.Sheets[workbook.SheetNames[0]]
      );
      if (headersMap && typeof headersMap === "object") {
        sheetData = sheetData.map((row) => {
          const newRow = {};
          for (const key in row) {
            newRow[headersMap[key] || key] = row[key];
          }
          return newRow;
        });
      }
      data = sheetData;
      break;

    case "xml":
      const xmlString = bufferToString(fileBuffer);
      const parser = new xml2js.Parser({ explicitArray: false });
      const xmlData = await parser.parseStringPromise(xmlString);
      data = sanitizeXmlKeys(xmlData);
      break;

    case "yaml":
      const yamlString = bufferToString(fileBuffer);
      data = yaml.load(yamlString);
      break;

    default:
      throw new Error(`Formato de origen no soportado: ${sourceFormat}`);
  }

  // Filtrar columnas si se especificaron
  if (columns && Array.isArray(columns) && columns.length > 0) {
    data = data.map((item) => {
      const filteredItem = {};
      columns.forEach((col) => {
        if (item.hasOwnProperty(col)) {
          filteredItem[col] = item[col];
        }
      });
      return filteredItem;
    });
  }

  // Convertir a formato de destino
  let outputBuffer;
  switch (targetFormat) {
    case "json":
      outputBuffer = Buffer.from(JSON.stringify(data, null, 2), "utf-8");
      break;

    case "csv":
      outputBuffer = await new Promise((resolve, reject) => {
        stringify(data, { header: true }, (err, output) => {
          if (err) reject(err);
          resolve(Buffer.from(output, "utf-8"));
        });
      });
      break;

    case "xlsx":
      const newWorkbook = xlsx.utils.book_new();
      const newSheet = xlsx.utils.json_to_sheet(data);
      xlsx.utils.book_append_sheet(newWorkbook, newSheet, "Sheet1");
      outputBuffer = xlsx.write(newWorkbook, { type: "buffer" });
      break;

    case "xml":
      const builder = new xml2js.Builder();
      const xmlOutput = builder.buildObject({ data: { item: data } });
      outputBuffer = Buffer.from(xmlOutput, "utf-8");
      break;

    case "yaml":
      outputBuffer = Buffer.from(yaml.dump(data), "utf-8");
      break;

    default:
      throw new Error(`Formato de destino no soportado: ${targetFormat}`);
  }

  // Subir archivo a S3
  const s3Key = `conversions/${conversion._id}/${conversion.convertedFileName}`;
  const uploadParams = {
    Bucket: process.env.AWS_BUCKET,
    Key: s3Key,
    Body: outputBuffer,
    ContentType: mime.lookup(conversion.convertedFileName) || "application/octet-stream",
  };

  await s3Client.send(new PutObjectCommand(uploadParams));

  return s3Key;
};

const getConversionStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const conversion = await Conversion.findById(id);
    if (!conversion) {
      return res.status(404).json({ message: "Conversión no encontrada" });
    }
    res.json(conversion);
  } catch (error) {
    res.status(500).json({ message: "Error al obtener el estado de la conversión" });
  }
};

const downloadConvertedFile = async (req, res) => {
  try {
    const { id } = req.params;
    const conversion = await Conversion.findById(id);

    if (!conversion) {
      return res.status(404).json({ message: "Conversión no encontrada" });
    }

    if (conversion.status !== "completed") {
      return res.status(400).json({ message: "La conversión aún no está completa" });
    }

    const s3Key = conversion.fileUrl;
    const getObjectParams = {
      Bucket: process.env.AWS_BUCKET,
      Key: s3Key,
    };

    try {
      const { Body, ContentType } = await s3Client.send(
        new GetObjectCommand(getObjectParams)
      );

      const chunks = [];
      for await (const chunk of Body) {
        chunks.push(chunk);
      }
      const fileBuffer = Buffer.concat(chunks);

      res.setHeader(
        "Content-Type",
        ContentType || "application/octet-stream"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${conversion.convertedFileName}"`
      );
      res.send(fileBuffer);
    } catch (error) {
      console.error("Error al descargar archivo de S3:", error);
      res.status(500).json({ message: "Error al descargar el archivo convertido" });
    }
  } catch (error) {
    console.error("Error en downloadConvertedFile:", error);
    res.status(500).json({ message: "Error al procesar la solicitud" });
  }
};

const downloadConvertedFileStream = async (req, res) => {
  try {
    const { id } = req.params;
    const conversion = await Conversion.findById(id);

    if (!conversion) {
      return res.status(404).json({ message: "Conversión no encontrada" });
    }

    if (conversion.status !== "completed") {
      return res.status(400).json({ message: "La conversión aún no está completa" });
    }

    const s3Key = conversion.fileUrl;
    const getObjectParams = {
      Bucket: process.env.AWS_BUCKET,
      Key: s3Key,
    };

    try {
      // Primero verificamos que el archivo existe
      await s3Client.send(new HeadObjectCommand(getObjectParams));

      const { Body, ContentType } = await s3Client.send(
        new GetObjectCommand(getObjectParams)
      );

      res.setHeader(
        "Content-Type",
        ContentType || "application/octet-stream"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${conversion.convertedFileName}"`
      );

      // Transmitir el archivo directamente al cliente
      Body.pipe(res);

      // Manejar errores durante la transmisión
      Body.on("error", (error) => {
        console.error("Error durante la transmisión del archivo:", error);
        if (!res.headersSent) {
          res.status(500).json({
            message: "Error durante la descarga del archivo",
          });
        }
      });

      // Limpiar cuando se complete la transmisión
      res.on("finish", () => {
        Body.destroy();
      });
    } catch (error) {
      console.error("Error al acceder al archivo en S3:", error);
      if (error.name === "NoSuchKey") {
        res.status(404).json({ message: "Archivo no encontrado en S3" });
      } else {
        res.status(500).json({
          message: "Error al iniciar la descarga del archivo",
        });
      }
    }
  } catch (error) {
    console.error("Error en downloadConvertedFileStream:", error);
    res.status(500).json({ message: "Error al procesar la solicitud" });
  }
};

const getConversionHistory = async (req, res) => {
  try {
    const token = req.headers.authorization;
    if (!token) {
      return res
        .status(401)
        .json({ message: "No se proporcionó el token de autorización" });
    }

    const tokenLimpio = token.startsWith("Bearer ") ? token.slice(7) : token;
    const decodedToken = jwt.verify(tokenLimpio, process.env.AUTH_SECRET);
    const userId = decodedToken._id;

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const conversions = await Conversion.find({ user: userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Conversion.countDocuments({ user: userId });

    res.json({
      conversions,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("Error al obtener historial:", error);
    res.status(500).json({ message: "Error al obtener el historial de conversiones" });
  }
};

const deleteSelectedConversions = async (req, res) => {
  try {
    const { conversionIds } = req.body;

    if (!Array.isArray(conversionIds) || conversionIds.length === 0) {
      return res.status(400).json({
        message: "Se debe proporcionar un array de IDs de conversiones",
      });
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

    // Obtener las conversiones del usuario
    const conversions = await Conversion.find({
      _id: { $in: conversionIds },
      user: userId,
    });

    // Eliminar archivos de S3
    for (const conversion of conversions) {
      if (conversion.fileUrl) {
        try {
          await s3Client.send(
            new DeleteObjectCommand({
              Bucket: process.env.AWS_BUCKET,
              Key: conversion.fileUrl,
            })
          );
        } catch (error) {
          console.error(
            `Error al eliminar archivo ${conversion.fileUrl} de S3:`,
            error
          );
        }
      }
    }

    // Eliminar registros de la base de datos
    const result = await Conversion.deleteMany({
      _id: { $in: conversionIds },
      user: userId,
    });

    res.json({
      message: `${result.deletedCount} conversiones eliminadas exitosamente`,
    });
  } catch (error) {
    console.error("Error al eliminar conversiones:", error);
    res.status(500).json({ message: "Error al eliminar las conversiones" });
  }
};

const deleteAllConversions = async (req, res) => {
  try {
    const token = req.headers.authorization;
    if (!token) {
      return res
        .status(401)
        .json({ message: "No se proporcionó el token de autorización" });
    }

    const tokenLimpio = token.startsWith("Bearer ") ? token.slice(7) : token;
    const decodedToken = jwt.verify(tokenLimpio, process.env.AUTH_SECRET);
    const userId = decodedToken._id;

    // Obtener todas las conversiones del usuario
    const conversions = await Conversion.find({ user: userId });

    // Eliminar archivos de S3
    for (const conversion of conversions) {
      if (conversion.fileUrl) {
        try {
          await s3Client.send(
            new DeleteObjectCommand({
              Bucket: process.env.AWS_BUCKET,
              Key: conversion.fileUrl,
            })
          );
        } catch (error) {
          console.error(
            `Error al eliminar archivo ${conversion.fileUrl} de S3:`,
            error
          );
        }
      }
    }

    // Eliminar todos los registros de la base de datos
    const result = await Conversion.deleteMany({ user: userId });

    res.json({
      message: `${result.deletedCount} conversiones eliminadas exitosamente`,
    });
  } catch (error) {
    console.error("Error al eliminar todas las conversiones:", error);
    res.status(500).json({
      message: "Error al eliminar todas las conversiones",
    });
  }
};

module.exports = {
  convertFile,
  getConversionStatus,
  downloadConvertedFile,
  downloadConvertedFileStream,
  getConversionHistory,
  deleteSelectedConversions,
  deleteAllConversions,
  setIO,
}; 