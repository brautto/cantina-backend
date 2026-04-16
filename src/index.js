require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { testConnection } = require('./db');
const reservasRouter = require('./routes/reservas');
const webhookRoutes = require('./routes/webhook');
const authRouter = require('./routes/auth');
const diasCerradosRouter = require('./routes/diasCerrados');
const app = express();
const PORT = process.env.PORT || 3000;
const cron = require('node-cron');
const { enviarRecordatorios } = require('./jobs/recordatorioReservas');

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser()); // ← acá, antes de las rutas

// Endpoint de prueba
app.get('/', (req, res) => {
  res.send('Cantina Centro Vasko - Backend OK');
});

// Test DB
testConnection();

// Rutas
app.use('/dias-cerrados', diasCerradosRouter);
app.use('/reservas', reservasRouter);
app.use('/', webhookRoutes);
app.use('/auth', authRouter);

// Cron: recordatorio automático cada hora en punto
cron.schedule('* * * * *', () => {
  console.log('[CRON] Ejecutando recordatorios...');
  enviarRecordatorios();
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});