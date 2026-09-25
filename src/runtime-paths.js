// Development workers live under /src/{laya,voice}/; built workers live in
// /assets/. Public ONNX files live at the app root in either layout. Resolve
// from a passed URL so Vite does not rewrite a directory as an asset filename
// (which also drops the trailing slash required by ONNX Runtime).
export function runtimeRoot(directory, workerUrl, development, base = "/") {
  const appRoot = development
    ? new URL(base, new URL("/", workerUrl))
    : new URL("../", workerUrl);
  return new URL(`${directory}/`, appRoot).href;
}
