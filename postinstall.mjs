import { execSync } from 'child_process';
import { mkdirSync, existsSync, writeFileSync, chmodSync, unlinkSync, renameSync } from 'fs';
import path from 'path';
import os from 'os';
import https from 'https';
import { fileURLToPath } from 'url';

// --- CONFIGURATION ---
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ZIG_VERSION = '0.15.2';
const BIN_DIR = path.resolve(__dirname, 'bin', 'zig');
const QUICKJS_DIR = path.resolve(__dirname, 'quickjs');

// Mapping for Zig download URLs
const platformMap = {
    win32: 'windows',
    darwin: 'macos',
    linux: 'linux'
};

const archMap = {
    x64: 'x86_64',
    arm64: 'aarch64'
};

const platform = platformMap[os.platform()];
const arch = archMap[os.arch()];

if (!platform || !arch) {
    console.error(`❌ Unsupported platform/arch: ${os.platform()} ${os.arch()}`);
    process.exit(1);
}

// Zig download configuration
const zigTarget = `${arch}-${platform}`;
const zigFileName = `zig-${zigTarget}-${ZIG_VERSION}.${platform === 'windows' ? 'zip' : 'tar.xz'}`;
const zigUrl = `https://ziglang.org/download/${ZIG_VERSION}/${zigFileName}`;
const ZIG_BIN_PATH = path.join(BIN_DIR, platform === 'windows' ? 'zig.exe' : 'zig');

// QuickJS source configuration (using zip for windows, tar.gz for unix)
const qjsExt = platform === 'windows' ? 'zip' : 'tar.gz';
const qjsUrl = `https://github.com/bellard/quickjs/archive/refs/heads/master.${qjsExt}`;

// --- DOWNLOAD HELPER ---
const downloadFile = (url, dest) => {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode === 302 || res.statusCode === 301) {
                return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                reject(new Error(`Failed to download: ${res.statusCode}`));
                return;
            }
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                writeFileSync(dest, Buffer.concat(chunks));
                resolve();
            });
        }).on('error', reject);
    });
};

// --- MAIN EXECUTION ---
async function install() {
    console.log("=== POSTINSTALL: INITIALIZING PROJECT DEPENDENCIES ===");

    // 1. Download QuickJS source
    if (!existsSync(QUICKJS_DIR)) {
        try {
            console.log(`📥 Downloading QuickJS source (${qjsExt})...`);
            const qjsArchive = path.resolve(__dirname, `qjs.${qjsExt}`);
            await downloadFile(qjsUrl, qjsArchive);

            if (platform === 'windows') {
                execSync(`powershell -command "Expand-Archive -Path '${qjsArchive}' -DestinationPath '${__dirname}' -Force"`);
            } else {
                execSync(`tar -xzf "${qjsArchive}" -C "${__dirname}"`);
            }

            const extractedDir = path.resolve(__dirname, 'quickjs-master');
            if (existsSync(extractedDir)) {
                renameSync(extractedDir, QUICKJS_DIR);
            }
            if (existsSync(qjsArchive)) unlinkSync(qjsArchive);
            console.log("✅ QuickJS sources installed.");
        } catch (err) {
            console.error(`❌ Failed to install QuickJS: ${err.message}`);
        }
    } else {
        console.log(`✅ QuickJS source already downloaded.`);
    }

    // 2. Install Zig Compiler
    if (existsSync(ZIG_BIN_PATH)) {
        console.log(`✅ Zig ${ZIG_VERSION} already installed.`);
        return;
    }

    if (!existsSync(BIN_DIR)) mkdirSync(BIN_DIR, { recursive: true });

    console.log(`📥 Downloading Zig ${ZIG_VERSION} for ${zigTarget}...`);
    const archivePath = path.join(BIN_DIR, zigFileName);

    try {
        await downloadFile(zigUrl, archivePath);
        console.log(`📦 Extracting ${zigFileName}...`);

        if (platform === 'windows') {
            // Extraction using PowerShell for Windows
            execSync(`powershell -command "Expand-Archive -Path '${archivePath}' -DestinationPath '${BIN_DIR}' -Force"`);
            // Zig extracts into a subfolder named 'zig-windows-x86_64-0.15.2', let's flatten it
            const subDir = path.join(BIN_DIR, `zig-${zigTarget}-${ZIG_VERSION}`);
            if (existsSync(subDir)) {
                execSync(`powershell -command "Move-Item -Path '${subDir}\\*' -Destination '${BIN_DIR}' -Force"`);
            }
        } else {
            // Extraction for Unix with strip-components to avoid nested folder
            execSync(`tar -xJf "${archivePath}" -C "${BIN_DIR}" --strip-components=1`);
        }

        // Cleanup
        if (existsSync(archivePath)) unlinkSync(archivePath);

        if (platform !== 'windows') {
            chmodSync(ZIG_BIN_PATH, 0o755);
        }

        console.log(`🚀 Zig ${ZIG_VERSION} installed successfully at ${ZIG_BIN_PATH}`);
    } catch (err) {
        console.error(`❌ Installation failed: ${err.message}`);
        process.exit(1);
    }
}

install();