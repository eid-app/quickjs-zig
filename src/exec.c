#if defined(_WIN32)
#include <fcntl.h>
#include <io.h>

/* Helper to build the environment block for Windows */
static char **build_envp(JSContext *ctx, JSValueConst obj)
{
    uint32_t len, i;
    JSPropertyEnum *tab;
    char **envp, *pair;
    const char *key, *str;
    JSValue val;
    size_t key_len, str_len;

    if (JS_GetOwnPropertyNames(ctx, &tab, &len, obj,
                               JS_GPN_STRING_MASK | JS_GPN_ENUM_ONLY) < 0)
        return NULL;

    envp = js_mallocz(ctx, sizeof(envp[0]) * ((size_t)len + 1));
    if (!envp)
        goto fail;

    for(i = 0; i < len; i++) {
        val = JS_GetProperty(ctx, obj, tab[i].atom);
        if (JS_IsException(val))
            goto fail;
        str = JS_ToCString(ctx, val);
        JS_FreeValue(ctx, val); // OK: 2 arguments
        if (!str)
            goto fail;

        key = JS_AtomToCString(ctx, tab[i].atom);
        if (!key) {
            JS_FreeCString(ctx, str);
            goto fail;
        }

        key_len = strlen(key);
        str_len = strlen(str);
        pair = js_malloc(ctx, key_len + str_len + 2);
        if (!pair) {
            JS_FreeCString(ctx, key);
            JS_FreeCString(ctx, str);
            goto fail;
        }

        memcpy(pair, key, key_len);
        pair[key_len] = '=';
        memcpy(pair + key_len + 1, str, str_len);
        pair[key_len + 1 + str_len] = '\0';
        envp[i] = pair;

        JS_FreeCString(ctx, key);
        JS_FreeCString(ctx, str);
    }
    envp[len] = NULL;

done:
    JS_FreePropertyEnum(ctx, tab, len);
    return envp;
fail:
    if (envp) {
        for(i = 0; i < len; i++) {
            if (envp[i]) js_free(ctx, envp[i]);
        }
        js_free(ctx, envp);
        envp = NULL;
    }
    goto done;
}

/* Main exec implementation for Windows */
static JSValue js_os_exec(JSContext *ctx, JSValueConst this_val,
                          int argc, JSValueConst *argv)
{
    JSValueConst options, args = argv[0];
    JSValue val, ret_val = JS_UNDEFINED;
    const char **exec_argv = NULL;
    char **envp = NULL;
    const char *file = NULL;
    uint32_t exec_argc = 0, i;
    int ret, mode;
    BOOL block_flag = TRUE, use_path = TRUE;

    int custom_stdout_fd = -1;
    int old_stdout = -1;

    // 1. Arguments length
    val = JS_GetPropertyStr(ctx, args, "length");
    if (JS_IsException(val)) return JS_EXCEPTION;
    ret = JS_ToUint32(ctx, &exec_argc, val);
    JS_FreeValue(ctx, val); // OK: 2 arguments
    if (ret < 0) return JS_EXCEPTION;

    exec_argv = js_mallocz(ctx, sizeof(char *) * (exec_argc + 1));
    if (!exec_argv) return JS_EXCEPTION;

    for(i = 0; i < exec_argc; i++) {
        val = JS_GetPropertyUint32(ctx, args, i);
        if (JS_IsException(val)) goto exception;
        exec_argv[i] = JS_ToCString(ctx, val);
        JS_FreeValue(ctx, val); // OK: 2 arguments
        if (!exec_argv[i]) goto exception;
    }
    exec_argv[exec_argc] = NULL;

    // 2. Options & stdout fileno
    if (argc >= 2) {
        options = argv[1];
        get_bool_option(ctx, &block_flag, options, "block");
        get_bool_option(ctx, &use_path, options, "usePath");

        val = JS_GetPropertyStr(ctx, options, "stdout");
        if (!JS_IsUndefined(val) && !JS_IsNull(val)) {
            JS_ToInt32(ctx, &custom_stdout_fd, val);
        }
        JS_FreeValue(ctx, val); // Était trop peu d'arguments ici !

        val = JS_GetPropertyStr(ctx, options, "file");
        if (!JS_IsUndefined(val) && !JS_IsNull(val)) {
            file = JS_ToCString(ctx, val);
        }
        JS_FreeValue(ctx, val); // Était trop peu d'arguments ici !

        val = JS_GetPropertyStr(ctx, options, "env");
        if (!JS_IsUndefined(val) && !JS_IsNull(val)) {
            envp = build_envp(ctx, val);
        }
        JS_FreeValue(ctx, val); // OK: 2 arguments
    }

    if (envp == NULL) envp = (char **)_environ;
    const char *spawn_file = file ? file : exec_argv[0];

    // 3. Redirection logic
    if (custom_stdout_fd != -1) {
        _flushall();
        old_stdout = _dup(_fileno(stdout));
        if (_dup2(custom_stdout_fd, _fileno(stdout)) == -1) {
             _close(old_stdout);
             old_stdout = -1;
        }
    }

    mode = block_flag ? _P_WAIT : _P_NOWAIT;
    _flushall();

    if (use_path)
        ret = _spawnvpe(mode, spawn_file, (const char * const *)exec_argv, (const char * const *)envp);
    else
        ret = _spawnve(mode, spawn_file, (const char * const *)exec_argv, (const char * const *)envp);

    if (old_stdout != -1) {
        _flushall();
        _dup2(old_stdout, _fileno(stdout));
        _close(old_stdout);
    }

    if (ret == -1) {
        JS_ThrowTypeError(ctx, "exec error (spawn failed)");
        goto exception;
    }

    ret_val = JS_NewInt32(ctx, ret);

done:
    if (file) JS_FreeCString(ctx, file);
    if (exec_argv) {
        for(i = 0; i < exec_argc; i++) if (exec_argv[i]) JS_FreeCString(ctx, exec_argv[i]);
        js_free(ctx, exec_argv);
    }
    if (envp && envp != (char **)_environ) {
        char **p = envp;
        while (*p != NULL) { js_free(ctx, *p); p++; }
        js_free(ctx, envp);
    }
    return ret_val;

exception:
    ret_val = JS_EXCEPTION;
    goto done;
}
#endif