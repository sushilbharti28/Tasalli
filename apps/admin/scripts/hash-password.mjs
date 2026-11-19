// Usage: node scripts/hash-password.mjs  (reads the password from stdin)
// Prints a value for ADMIN_PASSWORD_HASH. The password itself is never stored.
import { scryptSync, randomBytes } from 'node:crypto';

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  const password = input.replace(/\r?\n$/, '');
  if (password.length < 12) {
    console.error('Use at least 12 characters.');
    process.exit(1);
  }
  const salt = randomBytes(16).toString('hex');
  console.log(`scrypt$${salt}$${scryptSync(password, salt, 32).toString('hex')}`);
});
