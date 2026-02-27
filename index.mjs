#!/usr/bin/env node

/**
 * quickjs-zig CLI Dispatcher
 * This script is the entry point when running 'npx quickjs-zig'
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const command = args[0];

async function run() {
    switch (command) {
        case 'build':
            console.log("🛠️  quickjs-zig: Starting build process...");

            // On appelle build.mjs en lui passant le reste des arguments
            const buildScript = path.join(__dirname, 'build.mjs');
            const child = spawn('node', [buildScript, ...args.slice(1)], {
                stdio: 'inherit',
                shell: true
            });

            child.on('exit', (code) => {
                if (code === 0) {
                    console.log("✅ Build completed successfully.");
                }
                process.exit(code);
            });
            break;

        case 'help':
        case undefined:
            console.log(`
quickjs-zig - Native Binary Compiler for QuickJS

Usage:
  npx quickjs-zig <command> [options]

Commands:
  build    Compiles your project into native binaries based on package.json
  help     Shows this help message

Example:
  npx quickjs-zig build
            `);
            break;

        default:
            console.log(`❌ Unknown command: "${command}"`);
            console.log("Type 'npx quickjs-zig help' for usage.");
            process.exit(1);
    }
}

run();