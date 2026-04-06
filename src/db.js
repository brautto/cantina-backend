const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

const testConnection = async () => {
  try {
    const res = await pool.query('SELECT NOW()');
    console.log('✅ Conexión correcta, hora DB:', res.rows[0].now);
  } catch (err) {
    console.error('❌ Error al conectar con la DB:', err);
  }
};

module.exports = { pool, testConnection };
