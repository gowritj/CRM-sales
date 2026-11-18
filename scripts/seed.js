const store = require("../db");

console.log(`Database is initialized at ${store.databasePath}`);
store.database.close();
