# QuickJS-Zig ⚡

A high-performance build system for **QuickJS**, powered by the **Zig** compiler. This project allows you to compile JavaScript applications into standalone native binaries for Windows, Linux, and macOS with zero system dependencies.

## Features

* **Zero Config Cross-Compilation**: Build for Windows, Linux, and macOS from any host (Intel or Apple Silicon).
* **Zig-Powered**: Uses **Zig 0.15.2** as a C compiler for modern, safe, and highly optimized binaries.
* **Custom C Modules**: Easily inject and register your own C modules into the QuickJS engine.
* **Native Windows Support**: Includes a custom `exec` implementation for Windows, bypassing typical QuickJS POSIX limitations.
* **Platform-Specific Swapping**: Automatically replaces generic JS files with platform-specific ones (e.g., `index.mjs` → `index.darwin.mjs`) during build.
* **Clean Source Management**: Automatically patches and restores QuickJS source files to keep the core library pristine.

---

## Installation

Add `quickjs-zig` as a development dependency in your project:

```bash
npm install --save-dev quickjs-zig

```

> **Note**: During installation, the `postinstall` script will automatically download the appropriate Zig 0.15.2 binary for your platform and initialize the QuickJS submodules.

### Development / Local setup

If you want to contribute or test the latest version from source:

```bash
git clone https://github.com/eid-app/quickjs-zig.git
cd quickjs-zig
npm install
npm link

```

---

## Platform-Specific File Swapping

The build system supports platform-specific file resolution. This is useful when you need different JS logic for different operating systems while maintaining a single development entry point for IDE completion.

### How it works

1. **Generic file**: Create a base file (e.g., `index.mjs` or `dialogs.mjs`). This is your reference for IDE completion and IntelliSense.
2. **Specific files**: Create files with the platform suffix:
* `filename.win32.mjs`
* `filename.darwin.mjs`
* `filename.linux.mjs`


3. **Build Logic**:
* The `build/` folder is cleaned at the start of each execution.
* If a platform-specific version exists, the generic version is **excluded** from the build folder to avoid duplicates.
* The script automatically rewrites `import` statements in your code to point to the correct suffix during the build process.



---

## Configuration

Configure your entry point and custom C modules in your project's `package.json`:

```json
{
  "name": "my-app",
  "quickJs": {
    "input": "app/index.mjs",
    "modules": {
      "my_module": "src/my_module.c"
    }
  }
}

```

* **`input`**: The entry point of your JavaScript application (defaults to `app/index.mjs`).
* **`modules`**: A key-value map of custom C modules (Module Name -> C Source Path).

---

## Example Usage

### 1. Create a C Module (`src/my_module.c`)

This module will be automatically compiled and linked into your final binary.

```c
#include "quickjs-libc.h"

// A simple native function
static JSValue js_hello(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    return JS_NewString(ctx, "Hello from the native side!");
}

// Module initialization
JSModuleDef *js_init_module_my_module(JSContext *ctx, const char *module_name) {
    JSModuleDef *m = JS_NewCModule(ctx, module_name, NULL);
    if (!m) return NULL;
    JS_AddModuleExport(ctx, m, "hello");
    JS_SetModuleExport(ctx, m, "hello", JS_NewCFunction(ctx, js_hello, "hello", 0));
    return m;
}

```

### 2. Create your JavaScript (`app/index.mjs`)

Import your custom module just like any other ES module.

```javascript
import { hello } from 'my_module';
import * as os from 'os';

// Use the native function
const message = hello();
console.log(message);

// Standard QuickJS modules are also fully supported
console.log(`Platform: ${os.platform}`);

```

### 3. Build your binaries

Run the build command to generate tools and standalone binaries for all targets:

```bash
npx quickjs-zig build

```

---

## Supported Targets

The build system generates binaries for the following platforms in the `dist/` folder:

| Platform | Architecture | Target ID | Binary Name |
| --- | --- | --- | --- |
| **Windows** | x64 / x86 | `x86_64-windows-gnu` / `x86-windows-gnu` | `app_win64.exe` / `app_win32.exe` |
| **Linux** | x64 / x86 / ARM64 | `x86_64-linux-gnu` / `x86-linux-gnu` / `aarch64-linux-gnu` | `app_linux64` / `app_linux32` / `app_linux_arm64` |
| **macOS** | Apple / Intel | `aarch64-macos` / `x86_64-macos` | `app_mac_arm` / `app_mac_intel` |

---

## Technical Details

### Why Zig?

Zig is not just a language; it's a powerful C/C++ toolchain. It allows `quickjs-zig` to:

* Cross-compile to Windows (MinGW) from macOS/Linux without installing complex toolchains.
* Provide a consistent `libc` environment across different platforms.
* Produce small, fast, and statically linked binaries.

### Windows Patching

QuickJS is designed for POSIX systems. This tool automatically patches `quickjs-libc.c` during the build process to provide a working `os.exec` on Windows using a native `_spawnvp` implementation.

---

## License

MIT - Created by **eid-app**.

---
