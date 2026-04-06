// src/runReasignacion.js

//Ejemplo de uso: node src/runReasignacion.js 2026-02-26 noche_1
const { reasignarTurno } = require('./jobs/reasignacionTurno');

(async () => {
  const fecha = process.argv[2];
  const turno = process.argv[3];

  if (!fecha || !turno) {
    console.log('Uso: node src/runReasignacion.js YYYY-MM-DD turno');
    console.log("Ej:  node src/runReasignacion.js 2026-02-26 noche_1");
    process.exit(1);
  }

  const resultado = await reasignarTurno({ fecha, turno });
  console.log('Resultado:', resultado);

  process.exit(resultado.ok ? 0 : 1);
})();