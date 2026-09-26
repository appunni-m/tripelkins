function encodingQuality(header, encoding) {
  if (header === null) return 1;
  let wildcard = 0;
  for (const item of header.split(",")) {
    const [name, ...parameters] = item.trim().toLowerCase().split(";");
    let quality = 1;
    for (const parameter of parameters) {
      const match = /^\s*q\s*=\s*(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)\s*$/.exec(
        parameter,
      );
      if (/^\s*q\s*=/i.test(parameter)) quality = match ? Number(match[1]) : 0;
    }
    if (name === encoding) return quality;
    if (name === "*") wildcard = quality;
  }
  return wildcard;
}

function securityHeaders(headers) {
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set(
    "Permissions-Policy",
    "camera=(), geolocation=(), microphone=(self)",
  );
  headers.set("Vary", "Accept-Encoding");
  return headers;
}

export default {
  async fetch(request, env) {
    const requestUrl = new URL(request.url);
    if (!requestUrl.pathname.endsWith(".wasm"))
      return env.ASSETS.fetch(request);

    if (request.method !== "GET" && request.method !== "HEAD")
      return new Response("Method not allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });

    const acceptEncoding = request.headers.get("Accept-Encoding");
    const qualities = [
      {
        name: "br",
        suffix: ".br",
        quality: encodingQuality(acceptEncoding, "br"),
      },
      {
        name: "gzip",
        suffix: ".gz",
        quality: encodingQuality(acceptEncoding, "gzip"),
      },
    ];
    const selected = qualities
      .filter((encoding) => encoding.quality > 0)
      .sort((left, right) => right.quality - left.quality)[0];

    if (!selected)
      return new Response("This asset requires Brotli or gzip support.", {
        status: 406,
        headers: securityHeaders(
          new Headers({
            "Cache-Control": "no-store",
            "Content-Type": "text/plain; charset=utf-8",
          }),
        ),
      });

    const assetUrl = new URL(requestUrl);
    assetUrl.pathname += selected.suffix;
    const assetHeaders = new Headers(request.headers);
    // Static range offsets would refer to the encoded representation, not WASM bytes.
    assetHeaders.delete("Range");
    assetHeaders.delete("If-Range");
    const asset = await env.ASSETS.fetch(
      new Request(assetUrl, { method: request.method, headers: assetHeaders }),
    );
    if (asset.status === 304) {
      const headers = securityHeaders(new Headers(asset.headers));
      headers.set("Content-Type", "application/wasm");
      headers.set("Content-Encoding", selected.name);
      headers.set(
        "Cache-Control",
        requestUrl.pathname.startsWith("/assets/")
          ? "public, max-age=31536000, immutable"
          : "public, max-age=86400",
      );
      return new Response(null, { status: 304, headers, encodeBody: "manual" });
    }
    if (!asset.ok)
      return new Response("WASM asset not found", {
        status: asset.status,
        headers: securityHeaders(new Headers({ "Cache-Control": "no-store" })),
      });

    const headers = securityHeaders(new Headers(asset.headers));
    headers.set("Content-Type", "application/wasm");
    headers.set("Content-Encoding", selected.name);
    headers.set(
      "Cache-Control",
      requestUrl.pathname.startsWith("/assets/")
        ? "public, max-age=31536000, immutable"
        : "public, max-age=86400",
    );

    return new Response(request.method === "HEAD" ? null : asset.body, {
      status: asset.status,
      headers,
      // The asset is already compressed; avoid applying Content-Encoding twice.
      encodeBody: "manual",
    });
  },
};
