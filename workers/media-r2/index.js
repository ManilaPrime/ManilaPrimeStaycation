// workers/media-r2/index.js
// Zero-Egress Cloudflare R2 Media & Receipt Storage for Manila Prime Staycation

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization"
        }
      });
    }

    // 1. Upload media: PUT /upload/:filename or POST /upload
    if (request.method === "PUT" || request.method === "POST") {
      const filename = url.pathname.replace(/^\/(upload\/)?/, "") || `img_${Date.now()}.webp`;
      const contentType = request.headers.get("Content-Type") || "image/webp";

      try {
        const body = await request.arrayBuffer();
        if (body.byteLength === 0) {
          return new Response(JSON.stringify({ error: "Empty file body" }), { status: 400 });
        }

        await env.MEDIA_BUCKET.put(filename, body, {
          httpMetadata: { contentType }
        });

        const fileUrl = `${url.origin}/media/${filename}`;

        return new Response(
          JSON.stringify({
            success: true,
            key: filename,
            url: fileUrl,
            size: body.byteLength
          }),
          {
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*"
            }
          }
        );
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
      }
    }

    // 2. Serve media: GET /media/:filename
    if (request.method === "GET") {
      const key = url.pathname.replace(/^\/(media\/)?/, "");
      if (!key) {
        return new Response("Manila Prime R2 Media Service Active", { status: 200 });
      }

      const object = await env.MEDIA_BUCKET.get(key);
      if (!object) {
        return new Response("Media not found", { status: 404 });
      }

      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set("etag", object.httpEtag);
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
      headers.set("Access-Control-Allow-Origin", "*");

      return new Response(object.body, { headers });
    }

    return new Response("Method not allowed", { status: 405 });
  }
};
