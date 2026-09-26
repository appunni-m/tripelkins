// Development workers live under /src/{laya,voice}/. Production runtime files
// move into a build-specific public directory so a deployment always has new
// URLs, even when ONNX Runtime's file contents did not change.
export function runtimeRoot(directory, workerUrl, development, base = "/") {
  const appRoot = development
    ? new URL(base, new URL("/", workerUrl))
    : new URL("../", workerUrl);
  const runtimePath = development
    ? `${directory}/`
    : `assets/${__TRIPELKINS_BUILD_ID__}/public/${directory}/`;
  return new URL(runtimePath, appRoot).href;
}
