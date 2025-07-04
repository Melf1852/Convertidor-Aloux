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

    const originalFileName = req.file.filename;
    const filePath = req.file.path;
    const outputExtension = getOutputExtension(targetFormat);

    // Lee el nombre personalizado del body
    let customName = req.body.fileName;
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
      await processFile(
        filePath,
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
        });
      }

      res.status(200).json({
        message: "Conversión completada",
        conversionId: conversion._id,
        status: "completed",
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

const processFile = async (
  filePath,
  sourceFormat,
  targetFormat,
  conversion,
  columns,
  headersMap
) => {
  let data;

  // Leer archivo según formato de origen
  switch (sourceFormat) {
    case "json":
      const jsonContent = await fsPromises.readFile(filePath, "utf-8");
      data = JSON.parse(jsonContent);
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
      data = await new Promise((resolve, reject) => {
        const results = [];
        fs.createReadStream(filePath)
          .pipe(parse({ columns: true }))
          .on("data", (row) => results.push(row))
          .on("end", () => resolve(results))
          .on("error", reject);
      });
      break;

    case "xlsx":
      const workbook = xlsx.readFile(filePath);
      let sheetData = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
      // Si hay un mapeo de headers, renombrar las claves
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
      const yamlContent = await fsPromises.readFile(filePath, "utf-8");
      data = yaml.load(yamlContent);
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
      const xmlContent = await fsPromises.readFile(filePath, "utf-8");
      data = await xml2js.parseStringPromise(xmlContent);
      if (typeof data === "object") {
        const rootKey = Object.keys(data)[0];
        data = data[rootKey];
        const arrayProps = Object.keys(data).filter((key) =>
          Array.isArray(data[key])
        );
        if (arrayProps.length > 0) {
          data = data[arrayProps[0]];
        } else {
          data = [data]; // Asegurarse de devolver un array
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

  // Convertir y guardar según formato de destino
  const outputPath = path.join(
    path.dirname(filePath),
    conversion.convertedFileName
  );

  switch (targetFormat) {
    case "json":
      await fsPromises.writeFile(outputPath, JSON.stringify(data, null, 2));
      break;

    case "csv":
      await new Promise((resolve, reject) => {
        const writeStream = fs.createWriteStream(outputPath);
        stringify(data, {
          header: true,
          columns: data.length > 0 ? Object.keys(data[0]) : [],
        })
          .pipe(writeStream)
          .on("finish", resolve)
          .on("error", reject);
      });
      break;

    case "xlsx":
      const newWorkbook = xlsx.utils.book_new();
      const newSheet = xlsx.utils.json_to_sheet(data);
      xlsx.utils.book_append_sheet(newWorkbook, newSheet, "Sheet1");
      xlsx.writeFile(newWorkbook, outputPath);
      break;

    case "yaml":
      await fsPromises.writeFile(outputPath, yaml.dump(data));
      break;

    case "xml":
      const sanitizedData = sanitizeXmlKeys(data);
      const builder = new xml2js.Builder();
      const rootName = "root";
      const wrappedData = {};
      wrappedData[rootName] = { record: sanitizedData };
      const xml = builder.buildObject(wrappedData);
      await fsPromises.writeFile(outputPath, xml);
      break;

    default:
      throw new Error("Formato de destino no soportado");
  }

  return outputPath;
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

    const filePath = path.join(
      __dirname,
      "..",
      "uploads",
      conversion.convertedFileName
    );
    res.download(filePath);
  } catch (error) {
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

    const conversions = await Conversion.find({ _id: { $in: ids } });

    // Eliminar archivos físicos
    for (const conv of conversions) {
      const filePath = path.join(__dirname, '..', 'uploads', conv.convertedFileName);
      if (fs.existsSync(filePath)) {
        await fsPromises.unlink(filePath);
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
    const conversions = await Conversion.find({});

    // Eliminar archivos físicos
    for (const conv of conversions) {
      const filePath = path.join(__dirname, '..', 'uploads', conv.convertedFileName);
      if (fs.existsSync(filePath)) {
        await fsPromises.unlink(filePath);
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

// 👇 Aquí el module.exports COMPLETO, incluyendo todas las funciones usadas en convertRoutes
module.exports = {
  convertFile,
  getConversionStatus,
  downloadConvertedFile,
  getConversionHistory,
  deleteSelectedConversions,
  deleteAllConversions,
  setIO,
};