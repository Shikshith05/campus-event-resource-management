// Prints a bcrypt hash for a password, for the password_hash column of
// data/pes/users.csv or for an UPDATE of an existing user.
//
//   node scripts/hash-password.mjs "the-new-password"
//
// Uses bcryptjs from the app (run `npm install` in app/ once). Cost 10,
// a new random salt every time, the same as the seed users.
import { createRequire } from "node:module";
import { resolve } from "node:path";

const password = process.argv[2];
if (!password) {
  console.error('Usage: node scripts/hash-password.mjs "the-new-password"');
  process.exit(1);
}
if (password.length < 8) {
  console.error("Use at least 8 characters.");
  process.exit(1);
}

const require = createRequire(resolve(import.meta.dirname, "..", "app", "package.json"));
let bcrypt;
try {
  bcrypt = require("bcryptjs");
} catch {
  console.error("bcryptjs not found: run `npm install` in the app/ folder first.");
  process.exit(1);
}

console.log(bcrypt.hashSync(password, 10));
