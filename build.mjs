import { execSync } from 'child_process';
import { writeFileSync, mkdirSync, unlinkSync, existsSync, readdirSync, cpSync, readFileSync, renameSync, statSync, rmSync } from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

// --- PATH CONFIGURATION ---
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USER_CWD = process.cwd();
const PLATFORM = os.platform();

// Clean global build directory at the very beginning
const GLOBAL_BUILD_DIR = path.join(USER_CWD, 'build');
if (existsSync(GLOBAL_BUILD_DIR)) {
    rmSync(GLOBAL_BUILD_DIR, { recursive: true });
}

// Load the user project's package.json
const USER_PKG_PATH = path.join(USER_CWD, 'package.json');
if (!existsSync(USER_PKG_PATH)) {
    console.error("❌ Error: package.json not found in current directory.");
    process.exit(1);
}

const userPackageJson = JSON.parse(readFileSync(USER_PKG_PATH, 'utf8'));
const customModules = userPackageJson.quickJs?.modules || {};
const APP_NAME = userPackageJson.name || 'app';

// Optimization flag from package.json
const IS_OPTIMIZED = userPackageJson.quickJs?.optimization === true;

// Input file from package.json or default to app/index.mjs
const INPUT_FILE_RELATIVE = userPackageJson.quickJs?.input || 'app/index.mjs';

/**
 * Recursively scan and transform imports to platform-specific ones.
 * Filters out files from other platforms and ensures specific versions
 * replace generic ones (like index.mjs) in the build folder.
 */
function processDirectory(currentDir, targetDir, targetPlat) {
    if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });

    const filesInSource = readdirSync(currentDir);

    filesInSource.forEach(file => {
        const fullPath = path.join(currentDir, file);
        const destPath = path.join(targetDir, file);

        if (statSync(fullPath).isDirectory()) {
            return processDirectory(fullPath, destPath, targetPlat);
        }

        const isMjs = file.endsWith('.mjs') || file.endsWith('.js');
        const knownPlats = ['win32', 'darwin', 'linux'];

        if (isMjs) {
            const parts = file.split('.');
            const filePlat = parts.length > 2 ? parts[parts.length - 2] : null;

            // 1. Skip files belonging to OTHER platforms
            if (filePlat && knownPlats.includes(filePlat) && filePlat !== targetPlat) {
                return;
            }

            // 2. Logic for generic files (like index.mjs):
            // If a specific version (index.darwin.mjs) exists, we skip the generic one.
            if (!filePlat || !knownPlats.includes(filePlat)) {
                const specFile = file.replace(/\.mjs$/, `.${targetPlat}.mjs`);
                if (filesInSource.includes(specFile)) {
                    return;
                }
            }

            let content = readFileSync(fullPath, 'utf8');

            // 3. Transform generic imports to platform-specific ones if they exist physically
            content = content.replace(/(import\s+.+?\s+from\s+['"])(.+?)\.mjs(['"])/g, (match, before, importPath, after) => {
                const platFile = `${importPath}.${targetPlat}.mjs`;
                const platformFullPath = path.resolve(currentDir, platFile);

                if (existsSync(platformFullPath)) {
                    console.log(`✨ [${targetPlat}] Swapping import: ${importPath}.mjs -> ${platFile}`);
                    return `${before}${importPath}.${targetPlat}.mjs${after}`;
                }
                return match;
            });

            writeFileSync(destPath, content);
        } else {
            // Copy assets and other files as is
            cpSync(fullPath, destPath);
        }
    });
}

const QUICKJS_DIR = path.resolve(__dirname, 'quickjs');
const ZIG_PATH = path.resolve(__dirname, 'bin', 'zig', os.platform() === 'win32' ? 'zig.exe' : 'zig');
const VERSION = '2024-01-13';
const BIN_DIR = path.join(USER_CWD, 'bin');
const DIST_DIR = path.join(USER_CWD, 'dist');

const LIBC_PATH = path.join(QUICKJS_DIR, 'quickjs-libc.c');
const LIBC_BAK = path.join(QUICKJS_DIR, 'quickjs-libc.c.bak');
const QJS_C_PATH = path.join(QUICKJS_DIR, 'qjs.c');
const QJS_C_BAK = path.join(QUICKJS_DIR, 'qjs.c.bak');
const QJSC_C_PATH = path.join(QUICKJS_DIR, 'qjsc.c');
const QJSC_C_BAK = path.join(QUICKJS_DIR, 'qjsc.c.bak');
const EXEC_SRC_PATH = path.resolve(__dirname, 'src', 'exec.c');

if (!existsSync(BIN_DIR)) mkdirSync(BIN_DIR, { recursive: true });
if (!existsSync(DIST_DIR)) mkdirSync(DIST_DIR, { recursive: true });

// Detect the host architecture to find the correct qjsc binary
const arch = os.arch();
let hostQjscName = '';
if (PLATFORM === 'darwin') hostQjscName = (arch === 'arm64') ? 'qjsc_mac_arm' : 'qjsc_mac_intel';
else if (PLATFORM === 'linux') hostQjscName = (arch === 'arm64' || arch === 'aarch64') ? 'qjsc_linux_arm' : 'qjsc_linux64';
else if (PLATFORM === 'win32') hostQjscName = 'qjsc_win64.exe';

const hostQjscPath = path.join(BIN_DIR, hostQjscName);

// ==========================================================
// STAGE 0: PATCHING
// ==========================================================
console.log("=== STAGE 0: PATCHING QUICKJS SOURCES ===");

if (existsSync(LIBC_PATH)) {
    if (!existsSync(LIBC_BAK)) cpSync(LIBC_PATH, LIBC_BAK);
    let content = readFileSync(LIBC_PATH, 'utf8');

    if (!content.includes('#include <process.h>')) {
        content = '#if defined(_WIN32)\n#include <process.h>\n#endif\n' + content;
    }

    for (const name of Object.keys(customModules)) {
        const decl = `JSModuleDef *js_init_module_${name}(JSContext *ctx, const char *module_name);`;
        if (!content.includes(decl)) content = content.replace('#include "quickjs-libc.h"', `#include "quickjs-libc.h"\n\n${decl}`);
    }

    if (existsSync(EXEC_SRC_PATH)) {
        const execImpl = readFileSync(EXEC_SRC_PATH, 'utf8');
        if (!content.includes('js_os_exec_win32')) {
            content = content.replace('static JSClassDef js_worker_class = {', execImpl + '\nstatic JSClassDef js_worker_class = {');
        }
        const oldEntry = '    JS_CFUNC_DEF("exec", 1, js_os_exec ),';
        const newEntry = `#if defined(_WIN32)\n    JS_CFUNC_DEF("exec", 1, js_os_exec_win32 ),\n#else\n    JS_CFUNC_DEF("exec", 1, js_os_exec ),\n#endif`;
        if (content.includes(oldEntry)) content = content.replace(oldEntry, newEntry);
    }
    writeFileSync(LIBC_PATH, content);
    console.log("✅ quickjs-libc.c patched.");
}

[ [QJS_C_PATH, QJS_C_BAK], [QJSC_C_PATH, QJSC_C_BAK] ].forEach(([p, b]) => {
    if (!existsSync(p)) return;
    if (!existsSync(b)) cpSync(p, b);
    let content = readFileSync(p, 'utf8');
    const isQjsc = p.includes('qjsc.c');

    for (const name of Object.keys(customModules)) {
        if (isQjsc) {
            const entry = `namelist_add(&cmodule_list, "${name}", "${name}", 0);`;
            if (!content.includes(entry)) content = content.replace('namelist_add(&cmodule_list, "os", "os", 0);', `namelist_add(&cmodule_list, "os", "os", 0);\n    ${entry}`);
        } else {
            const decl = `JSModuleDef *js_init_module_${name}(JSContext *ctx, const char *module_name);`;
            const call = `js_init_module_${name}(ctx, "${name}");`;
            if (!content.includes(decl)) content = content.replace('#include "quickjs-libc.h"', `#include "quickjs-libc.h"\n\n${decl}`);
            if (!content.includes(call)) content = content.replace('js_init_module_os(ctx, "os");', `js_init_module_os(ctx, "os");\n    ${call}`);
        }
    }
    writeFileSync(p, content);
    console.log(`✅ ${path.basename(p)} patched.`);
});

const baseSources = ['quickjs.c', 'libregexp.c', 'libunicode.c', 'cutils.c', 'quickjs-libc.c', 'dtoa.c']
    .map(f => path.join(QUICKJS_DIR, f))
    .concat(Object.values(customModules).map(f => path.resolve(USER_CWD, f)))
    .join(' ');

const targets = [
  { id: 'x86_64-windows-gnu', qjs: 'qjs_win64.exe', qjsc: 'qjsc_win64.exe', app: `${APP_NAME}_win64.exe`, libs: '-lm', cflags: '-D_GNU_SOURCE', plat: 'win32' },
  { id: 'x86-windows-gnu',    qjs: 'qjs_win32.exe', qjsc: 'qjsc_win32.exe', app: `${APP_NAME}_win32.exe`, libs: '-lm', cflags: '-D_GNU_SOURCE', plat: 'win32' },
  { id: 'x86_64-linux-gnu',   qjs: 'qjs_linux64',   qjsc: 'qjsc_linux64',   app: `${APP_NAME}_linux64`,   libs: '-lm -lpthread -ldl', cflags: '-D_GNU_SOURCE -DCONFIG_PTHREAD', plat: 'linux' },
  { id: 'x86-linux-gnu',      qjs: 'qjs_linux32',   qjsc: 'qjsc_linux32',   app: `${APP_NAME}_linux32`,   libs: '-lm -lpthread -ldl', cflags: '-D_GNU_SOURCE -DCONFIG_PTHREAD', plat: 'linux' },
  { id: 'aarch64-linux-gnu',  qjs: 'qjs_linux_arm64', qjsc: 'qjsc_linux_arm64', app: `${APP_NAME}_linux_arm64`, libs: '-lm -lpthread -ldl', cflags: '-D_GNU_SOURCE -DCONFIG_PTHREAD', plat: 'linux' },
  { id: 'aarch64-macos',      qjs: 'qjs_mac_arm',   qjsc: 'qjsc_mac_arm',   app: `${APP_NAME}_mac_arm`,   libs: '-lm -lpthread -ldl', cflags: '-D_GNU_SOURCE -DCONFIG_PTHREAD', plat: 'darwin' },
  { id: 'x86_64-macos',       qjs: 'qjs_mac_intel', qjsc: 'qjsc_mac_intel', app: `${APP_NAME}_mac_intel`, libs: '-lm -lpthread -ldl', cflags: '-D_GNU_SOURCE -DCONFIG_PTHREAD', plat: 'darwin' }
];

// ==========================================================
// STAGE 1 & 2: TOOLS AND APPLICATION COMPILATION
// ==========================================================
const stubPath = path.join(QUICKJS_DIR, 'repl_stub.c');
writeFileSync(stubPath, `const unsigned char qjsc_repl[] = {0}; const unsigned int qjsc_repl_size = 0;`);

// Feature optimization flags for qjsc
const qjscFlags = IS_OPTIMIZED ? '-fno-eval -fno-regexp -fno-proxy -fno-map -fno-typedarray -fno-promise' : '';

targets.forEach(t => {
    console.log(`\n--- Compiling for: ${t.id} ---`);

    // --- PLATFORM SPECIFIC BUILD RESOLUTION ---
    const PLATFORM_BUILD_DIR = path.join(USER_CWD, 'build', t.id);
    const inputBaseDir = path.dirname(path.resolve(USER_CWD, INPUT_FILE_RELATIVE));

    if (existsSync(PLATFORM_BUILD_DIR)) {
        rmSync(PLATFORM_BUILD_DIR, { recursive: true });
    }

    processDirectory(inputBaseDir, PLATFORM_BUILD_DIR, t.plat);

    const TARGET_INPUT_ABS = path.join(PLATFORM_BUILD_DIR, path.basename(INPUT_FILE_RELATIVE));

    // Dynamic Optimization Flags
    let optFlags = IS_OPTIMIZED ? '-O3 -flto' : '-O2';

    // -fuse-ld=lld is mandatory for macOS LTO, but causes warnings on other platforms
    if (IS_OPTIMIZED && t.plat === 'darwin') {
        optFlags += ' -fuse-ld=lld';
    }

    const cmdBase = `${ZIG_PATH} cc -target ${t.id} -I${QUICKJS_DIR} ${optFlags} ${t.cflags} -Wno-ignored-attributes -DCONFIG_VERSION=\\"${VERSION}\\" ${t.libs} -s`;

    try {
        execSync(`${cmdBase} -o "${path.join(BIN_DIR, t.qjs)}" ${baseSources} ${stubPath} "${path.join(QUICKJS_DIR, 'qjs.c')}"`);
        execSync(`${cmdBase} -o "${path.join(BIN_DIR, t.qjsc)}" ${baseSources} "${path.join(QUICKJS_DIR, 'qjsc.c')}"`);
        console.log(`✅ Build tools generated.`);

        const tempC = path.join(BIN_DIR, `${t.id}_app.c`);

        // Use host qjsc to compile the platform-resolved source
        execSync(`"${hostQjscPath}" ${qjscFlags} -e -o "${tempC}" "${TARGET_INPUT_ABS}"`, { cwd: USER_CWD });

        execSync(`${cmdBase} -o "${path.join(DIST_DIR, t.app)}" "${tempC}" ${baseSources} -I${QUICKJS_DIR}`);
        console.log(`✅ Binary built${IS_OPTIMIZED ? ' and optimized' : ''}: ${t.app}`);
    } catch (e) {
        console.error(`❌ Compilation failed for ${t.id}`);
        console.error(e.stderr?.toString() || e.message);
    }
});

// ==========================================================
// STAGE 3: CLEANUP
// ==========================================================
console.log("\n=== STAGE 3: CLEANUP ===");

// Remove all generated .c files in the bin directory
const binFiles = readdirSync(BIN_DIR);
binFiles.forEach(file => {
    if (file.endsWith('_app.c')) {
        unlinkSync(path.join(BIN_DIR, file));
        console.log(`🗑️ Removed temporary source: ${file}`);
    }
});

[ [LIBC_BAK, LIBC_PATH], [QJS_C_BAK, QJS_C_PATH], [QJSC_C_BAK, QJSC_C_PATH] ].forEach(([b, s]) => {
    if (existsSync(b)) {
        renameSync(b, s);
        console.log(`🔄 Restored original: ${path.basename(s)}`);
    }
});
if (existsSync(stubPath)) unlinkSync(stubPath);

console.log(`🚀 Build process complete. (Optimization: ${IS_OPTIMIZED ? 'ON' : 'OFF'})`);
console.log("Platform sources kept in build/ subfolders.");