const b = require('bcryptjs');
console.log('RECEPCAO:', b.hashSync('recepcao2024', 10));
console.log('ADMIN:', b.hashSync('admin2024', 10));
