const express = require('express');
const router = express.Router();

router.post('/login', (req, res) => {
  const { usuario, password } = req.body;

  if (!usuario || !password) {
    return res.status(400).json({ error: 'Faltan credenciales' });
  }

  if (
    usuario !== process.env.ADMIN_USER ||
    password !== process.env.ADMIN_PASSWORD
  ) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }

  const token = Buffer.from(`${usuario}:${Date.now()}`).toString('base64');

  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'strict',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 días
  });

  return res.status(200).json({ ok: true });
});

router.post('/logout', (req, res) => {
  res.clearCookie('token');
  return res.status(200).json({ ok: true });
});

router.get('/verificar', (req, res) => {
  const token = req.cookies?.token;
  if (!token) {
    return res.status(401).json({ ok: false });
  }
  return res.status(200).json({ ok: true });
});

module.exports = router;