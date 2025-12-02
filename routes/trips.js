const express = require('express');
const router = express.Router();

/**
 * Recibe `db` (MongoDB Database object) y devuelve un router configurado.
 */
module.exports = (db) => {
  const collection = db.collection('trips');

  // 1.1 - Agrupar por usertype: total viajes y duración promedio
  router.get('/1.1', async (req, res) => {
    try {
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
      console.error(err);
      res.status(500).json({ error: 'Error en la consulta 1.1' });
    }
  });

  // 1.2 - Por hora del día. Opcional query param: ?hour=10  (devuelve solo esa hora si se pasa)
  router.get('/1.2', async (req, res) => {
    try {
      const hourParam = req.query.hour !== undefined ? parseInt(req.query.hour, 10) : null;
      const pipeline = [
        {
          $addFields: {
            hora: { $hour: "$start time" }   // asume "start time" es tipo Date
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

      let agg = collection.aggregate(pipeline);
      let rows = await agg.toArray();

      // Si se pasó hour, filtramos la hora concreta (alternativa: podría añadirse $match antes del group)
      if (hourParam !== null && !isNaN(hourParam)) {
        rows = rows.filter(r => r.hora === hourParam);
      }

      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error en la consulta 1.2' });
    }
  });

  // 1.3 - Total viajes por día
  router.get('/1.3', async (req, res) => {
    try {
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
      console.error(err);
      res.status(500).json({ error: 'Error en la consulta 1.3' });
    }
  });

  // 1.4 - Top estaciones por salidas. Query param: ?limit=5 (default 10)
  router.get('/1.4', async (req, res) => {
    try {
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
      console.error(err);
      res.status(500).json({ error: 'Error en la consulta 1.4' });
    }
  });

  // 1.5 - Por combinación hora + día de la semana. Query params: ?hour=10&day=2
  // Nota: MongoDB $dayOfWeek: 1=Dom, ...,7=Sáb
  router.get('/1.5', async (req, res) => {
    try {
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

      // Aplicar filtros si se proporcionaron params (alternativa: $match antes del $group)
      if (!isNaN(hourQ) && hourQ !== null) rows = rows.filter(r => r.hora === hourQ);
      if (!isNaN(dayQ) && dayQ !== null) rows = rows.filter(r => r.dia_Semana === dayQ);

      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error en la consulta 1.5' });
    }
  });

  return router;
};
