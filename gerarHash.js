const bcrypt = require('bcryptjs');

const senha = process.argv[2];

if (!senha) {
  console.log('Uso: node gerarHash.js suasenha');
  process.exit(1);
}

const hash = bcrypt.hashSync(senha, 10);
console.log(hash);
