const Module = require("node:module");
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "better-sqlite3") {
    const error = new Error("better-sqlite3 intentionally unavailable for fallback verification");
    error.code = "MODULE_NOT_FOUND";
    throw error;
  }
  return originalLoad.call(this, request, parent, isMain);
};
