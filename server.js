require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');
const tripsRouter = require('./routes/trips');
const path = require('path');

const app = express();

// Configuración de CORS más permisiva
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

// Log para verificar configuración
console.log('Configuración:');
console.log('- Puerto:', PORT);
console.log('- Base de datos:', DB_NAME);
console.log('- MongoDB URI configurado:', MONGODB_URI ? 'Sí' : 'No');

if (!MONGODB_URI || !DB_NAME) {
  console.error('❌ Error: Por favor configura MONGODB_URI y DB_NAME en las variables de entorno');
  // No hacer exit en Vercel, solo registrar el error
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
  const client = new MongoClient(MONGODB_URI, {
    maxPoolSize: 10,
    minPoolSize: 2,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  });

  await client.connect();
  const db = client.db(DB_NAME);

  cachedClient = client;
  cachedDb = db;

  console.log('✅ Conectado a MongoDB');
  return { client, db };
}

// Middleware para manejar la conexión a la base de datos
app.use(async (req, res, next) => {
  try {
    const { db } = await connectToDatabase();
    req.db = db;
    next();
  } catch (err) {
    console.error('❌ Error conectando a MongoDB:', err);
    res.status(500).json({ 
      error: 'Error de conexión a la base de datos',
      message: err.message 
    });
  }
});

// Rutas
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Ruta de health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    database: cachedDb ? 'connected' : 'disconnected'
  });
});

// Usar el router de trips
app.use('/api/trips', (req, res, next) => {
  const router = tripsRouter(req.db);
  router(req, res, next);
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

// Exportar para Vercel
module.exports = app;