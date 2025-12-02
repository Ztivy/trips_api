require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');
const path = require('path');

const app = express();

// CORS más permisivo para desarrollo y producción
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configuración con validación mejorada
const MONGODB_URI = process.env.MONGODB_URI;
const PORT = process.env.PORT || 3000;
const DB_NAME = process.env.DB_NAME;
const NODE_ENV = process.env.NODE_ENV || 'development';

console.log('🚀 Iniciando aplicación...');
console.log('Configuración:');
console.log('- Entorno:', NODE_ENV);
console.log('- Puerto:', PORT);
console.log('- Base de datos:', DB_NAME);
console.log('- MongoDB URI configurado:', MONGODB_URI ? 'Sí ✓' : 'No ✗');

if (!MONGODB_URI || !DB_NAME) {
  console.error('❌ Error crítico: MONGODB_URI y DB_NAME son requeridos');
  console.error('Por favor configura estas variables de entorno');
  if (NODE_ENV === 'production') {
    process.exit(1); // Fallar en producción si no hay config
  }
}

// Cache de conexión para reutilizar en Render
let cachedClient = null;
let cachedDb = null;

async function connectToDatabase() {
  // Reutilizar conexión existente
  if (cachedClient && cachedDb) {
    try {
      // Verificar que la conexión sigue activa
      await cachedClient.db(DB_NAME).command({ ping: 1 });
      console.log('✅ Usando conexión existente a MongoDB');
      return { client: cachedClient, db: cachedDb };
    } catch (err) {
      console.log('⚠️ Conexión existente inválida, reconectando...');
      cachedClient = null;
      cachedDb = null;
    }
  }

  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI no está configurado');
  }

  console.log('🔄 Estableciendo nueva conexión a MongoDB...');
  
  // Configuración optimizada para Render
  const client = new MongoClient(MONGODB_URI, {
    maxPoolSize: 10,
    minPoolSize: 2,
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
    connectTimeoutMS: 10000,
    retryWrites: true,
    retryReads: true,
  });

  try {
    await client.connect();
    
    // Verificar la conexión
    const db = client.db(DB_NAME);
    await db.command({ ping: 1 });
    console.log('✅ Conectado exitosamente a MongoDB');
    
    // Verificar que la colección existe
    const collections = await db.listCollections({ name: 'trips' }).toArray();
    if (collections.length === 0) {
      console.warn('⚠️ Advertencia: La colección "trips" no existe en la base de datos');
    } else {
      console.log('✅ Colección "trips" encontrada');
    }

    cachedClient = client;
    cachedDb = db;

    return { client, db };
  } catch (err) {
    console.error('❌ Error conectando a MongoDB:', err.message);
    throw err;
  }
}

// Middleware para logging de requests
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Ruta principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Ruta de health check - MUY IMPORTANTE para Render
app.get('/api/health', async (req, res) => {
  try {
    const { db } = await connectToDatabase();
    const result = await db.command({ ping: 1 });
    
    res.json({ 
      status: 'ok',
      environment: NODE_ENV,
      timestamp: new Date().toISOString(),
      database: 'connected',
      ping: result,
      uptime: process.uptime()
    });
  } catch (err) {
    console.error('❌ Health check error:', err);
    res.status(503).json({
      status: 'error',
      environment: NODE_ENV,
      database: 'disconnected',
      message: err.message,
      timestamp: new Date().toISOString()
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
    console.log(`✅ Consulta 1.1 exitosa - ${result.length} registros`);
    res.json(result);
  } catch (err) {
    console.error('❌ Error en 1.1:', err);
    res.status(500).json({ 
      error: 'Error en la consulta 1.1', 
      message: err.message 
    });
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

    console.log(`✅ Consulta 1.2 exitosa - ${rows.length} registros`);
    res.json(rows);
  } catch (err) {
    console.error('❌ Error en 1.2:', err);
    res.status(500).json({ 
      error: 'Error en la consulta 1.2', 
      message: err.message 
    });
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
    console.log(`✅ Consulta 1.3 exitosa - ${result.length} registros`);
    res.json(result);
  } catch (err) {
    console.error('❌ Error en 1.3:', err);
    res.status(500).json({ 
      error: 'Error en la consulta 1.3', 
      message: err.message 
    });
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
    console.log(`✅ Consulta 1.4 exitosa - ${result.length} registros`);
    res.json(result);
  } catch (err) {
    console.error('❌ Error en 1.4:', err);
    res.status(500).json({ 
      error: 'Error en la consulta 1.4', 
      message: err.message 
    });
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

    console.log(`✅ Consulta 1.5 exitosa - ${rows.length} registros`);
    res.json(rows);
  } catch (err) {
    console.error('❌ Error en 1.5:', err);
    res.status(500).json({ 
      error: 'Error en la consulta 1.5', 
      message: err.message 
    });
  }
});

// Manejo de errores 404
app.use((req, res) => {
  console.log('❌ 404 - Ruta no encontrada:', req.url);
  res.status(404).json({ 
    error: 'Ruta no encontrada',
    path: req.url,
    availableRoutes: [
      'GET /',
      'GET /api/health',
      'GET /api/trips/1.1',
      'GET /api/trips/1.2',
      'GET /api/trips/1.3',
      'GET /api/trips/1.4',
      'GET /api/trips/1.5'
    ]
  });
});

// Manejo de errores generales
app.use((err, req, res, next) => {
  console.error('❌ Error en el servidor:', err);
  res.status(500).json({ 
    error: 'Error interno del servidor',
    message: err.message,
    stack: NODE_ENV === 'development' ? err.stack : undefined
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 SIGTERM recibido, cerrando servidor...');
  if (cachedClient) {
    await cachedClient.close();
    console.log('✅ Conexión a MongoDB cerrada');
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('🛑 SIGINT recibido, cerrando servidor...');
  if (cachedClient) {
    await cachedClient.close();
    console.log('✅ Conexión a MongoDB cerrada');
  }
  process.exit(0);
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log('═══════════════════════════════════════════════');
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  console.log(`🌍 Entorno: ${NODE_ENV}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}`);
  console.log(`🏥 Health check: http://localhost:${PORT}/api/health`);
  console.log('═══════════════════════════════════════════════');
});

module.exports = app;