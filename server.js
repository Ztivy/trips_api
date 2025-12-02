require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');
const path = require('path');

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const MONGODB_URI = process.env.MONGODB_URI;
const PORT = process.env.PORT || 3000;
const DB_NAME = process.env.DB_NAME;

console.log('Configuración:');
console.log('- Puerto:', PORT);
console.log('- Base de datos:', DB_NAME);
console.log('- MongoDB URI configurado:', MONGODB_URI ? 'Sí' : 'No');

if (!MONGODB_URI || !DB_NAME) {
  console.error('❌ Error: Por favor configura MONGODB_URI y DB_NAME en las variables de entorno');
}

let cachedClient = null;
let cachedDb = null;

async function connectToDatabase() {
  if (cachedClient && cachedDb) {
    console.log('✅ Usando conexión existente a MongoDB');
    return { client: cachedClient, db: cachedDb };
  }

  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI no está configurado');
  }

  console.log('🔄 Conectando a MongoDB...');
  
  // Configuración compatible con Vercel
  const client = new MongoClient(MONGODB_URI, {
    maxPoolSize: 10,
    minPoolSize: 2,
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
    connectTimeoutMS: 10000,
    // Deshabilitar validación estricta de SSL para Vercel
    tls: true,
    tlsAllowInvalidCertificates: true,
    tlsAllowInvalidHostnames: true,
    // Retry writes
    retryWrites: true,
    retryReads: true
  });

  await client.connect();
  
  // Verificar la conexión
  await client.db(DB_NAME).command({ ping: 1 });
  console.log('✅ Ping a MongoDB exitoso');
  
  const db = client.db(DB_NAME);

  cachedClient = client;
  cachedDb = db;

  console.log('✅ Conectado a MongoDB');
  return { client, db };
}

// Ruta principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Ruta de health check
app.get('/api/health', async (req, res) => {
  try {
    const { db } = await connectToDatabase();
    // Verificar que podemos hacer una query simple
    const result = await db.command({ ping: 1 });
    res.json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      database: 'connected',
      ping: result
    });
  } catch (err) {
    console.error('Health check error:', err);
    res.status(500).json({
      status: 'error',
      database: 'disconnected',
      message: err.message
    });
  }
});

// 1.1 - Tipos de usuario
app.get('/api/trips/1.1', async (req, res) => {
  try {
    const { db } = await connectToDatabase();
    const collection = db.collection('trips');
    
    const pipeline = [
      {
        $group: {
          _id: "$usertype",
          total_Viajes: { $sum: 1 },
          duracion_Promedio: { $avg: "$tripduration" }
        }
      },
      {
        $project: {
          _id: 0,
          usertype: "$_id",
          total_Viajes: 1,
          duracion_Promedio: 1
        }
      }
    ];
    
    const result = await collection.aggregate(pipeline).toArray();
    res.json(result);
  } catch (err) {
    console.error('Error en 1.1:', err);
    res.status(500).json({ error: 'Error en la consulta 1.1', message: err.message });
  }
});

// 1.2 - Por hora
app.get('/api/trips/1.2', async (req, res) => {
  try {
    const { db } = await connectToDatabase();
    const collection = db.collection('trips');
    const hourParam = req.query.hour !== undefined ? parseInt(req.query.hour, 10) : null;
    
    const pipeline = [
      {
        $addFields: {
          hora: { $hour: "$start time" }
        }
      },
      {
        $group: {
          _id: "$hora",
          total_Viajes: { $sum: 1 },
          duracion_Promedio: { $avg: "$tripduration" }
        }
      },
      {
        $project: {
          _id: 0,
          hora: "$_id",
          total_Viajes: 1,
          duracion_Promedio: 1
        }
      },
      { $sort: { hora: 1 } }
    ];

    let rows = await collection.aggregate(pipeline).toArray();

    if (hourParam !== null && !isNaN(hourParam)) {
      rows = rows.filter(r => r.hora === hourParam);
    }

    res.json(rows);
  } catch (err) {
    console.error('Error en 1.2:', err);
    res.status(500).json({ error: 'Error en la consulta 1.2', message: err.message });
  }
});

// 1.3 - Por día
app.get('/api/trips/1.3', async (req, res) => {
  try {
    const { db } = await connectToDatabase();
    const collection = db.collection('trips');
    
    const pipeline = [
      {
        $addFields: {
          fecha: {
            $dateTrunc: { date: "$start time", unit: "day" }
          }
        }
      },
      {
        $group: {
          _id: "$fecha",
          total_Viajes: { $sum: 1 }
        }
      },
      {
        $project: {
          _id: 0,
          fecha: "$_id",
          total_Viajes: 1
        }
      },
      { $sort: { fecha: 1 } }
    ];

    const result = await collection.aggregate(pipeline).toArray();
    res.json(result);
  } catch (err) {
    console.error('Error en 1.3:', err);
    res.status(500).json({ error: 'Error en la consulta 1.3', message: err.message });
  }
});

// 1.4 - Estaciones
app.get('/api/trips/1.4', async (req, res) => {
  try {
    const { db } = await connectToDatabase();
    const collection = db.collection('trips');
    const limit = req.query.limit ? Math.max(1, parseInt(req.query.limit, 10)) : 10;
    
    const pipeline = [
      {
        $group: {
          _id: {
            id: "$start station id",
            nombre: "$start station name"
          },
          total_Salidas: { $sum: 1 },
          duracion_Promedio: { $avg: "$tripduration" }
        }
      },
      {
        $project: {
          _id: 0,
          estacion_id: "$_id.id",
          estacion_nombre: "$_id.nombre",
          total_Salidas: 1,
          duracion_Promedio: 1
        }
      },
      { $sort: { total_Salidas: -1 } },
      { $limit: limit }
    ];

    const result = await collection.aggregate(pipeline).toArray();
    res.json(result);
  } catch (err) {
    console.error('Error en 1.4:', err);
    res.status(500).json({ error: 'Error en la consulta 1.4', message: err.message });
  }
});

// 1.5 - Hora y día
app.get('/api/trips/1.5', async (req, res) => {
  try {
    const { db } = await connectToDatabase();
    const collection = db.collection('trips');
    const hourQ = req.query.hour !== undefined ? parseInt(req.query.hour, 10) : null;
    const dayQ = req.query.day !== undefined ? parseInt(req.query.day, 10) : null;

    const pipeline = [
      {
        $addFields: {
          hora: { $hour: "$start time" },
          dia_Semana: { $dayOfWeek: "$start time" }
        }
      },
      {
        $group: {
          _id: { hora: "$hora", dia_Semana: "$dia_Semana" },
          total_Viajes: { $sum: 1 }
        }
      },
      {
        $project: {
          _id: 0,
          hora: "$_id.hora",
          dia_Semana: "$_id.dia_Semana",
          total_Viajes: 1
        }
      },
      { $sort: { total_Viajes: -1 } }
    ];

    let rows = await collection.aggregate(pipeline).toArray();

    if (!isNaN(hourQ) && hourQ !== null) rows = rows.filter(r => r.hora === hourQ);
    if (!isNaN(dayQ) && dayQ !== null) rows = rows.filter(r => r.dia_Semana === dayQ);

    res.json(rows);
  } catch (err) {
    console.error('Error en 1.5:', err);
    res.status(500).json({ error: 'Error en la consulta 1.5', message: err.message });
  }
});

// Manejo de errores 404
app.use((req, res) => {
  console.log('❌ 404 - Ruta no encontrada:', req.url);
  res.status(404).json({ error: 'Ruta no encontrada' });
});

// Manejo de errores generales
app.use((err, req, res, next) => {
  console.error('❌ Error en el servidor:', err);
  res.status(500).json({ 
    error: 'Error interno del servidor',
    message: err.message 
  });
});

// Iniciar servidor (solo si no está en Vercel)
if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
  });
}

module.exports = app;