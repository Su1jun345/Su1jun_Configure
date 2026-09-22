const ALLOWED_HOSTS = new Set(["pic.tuafjz.cn", "expose.eisees.com"]);
const MEDIA_KEY = new TextEncoder().encode("f5d965df75336270");
const MEDIA_IV = new TextEncoder().encode("97b60394abc2fbe1");

export default {
  async fetch(request) {
    const requestUrl = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders()
      });
    }

    if (request.method !== "GET") {
      return withCors(new Response("Method Not Allowed", { status: 405 }));
    }

    const source = requestUrl.searchParams.get("url") || "";
    let sourceUrl;
    try {
      sourceUrl = new URL(source);
    } catch (error) {
      return withCors(new Response("Missing or invalid url", { status: 400 }));
    }

    if (sourceUrl.protocol !== "https:" || !ALLOWED_HOSTS.has(sourceUrl.hostname)) {
      return withCors(new Response("Source host is not allowed", { status: 403 }));
    }

    try {
      const upstream = await fetch(sourceUrl.toString(), {
        headers: {
          "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
          "Referer": "https://huangguoai.com/"
        }
      });

      if (!upstream.ok) {
        return withCors(new Response("Cover request failed", { status: upstream.status }));
      }

      const encrypted = await upstream.arrayBuffer();
      if (!encrypted.byteLength || encrypted.byteLength % 16 !== 0) {
        return withCors(new Response("Invalid encrypted cover", { status: 502 }));
      }

      const key = await crypto.subtle.importKey(
        "raw",
        MEDIA_KEY,
        { name: "AES-CBC" },
        false,
        ["decrypt"]
      );
      const decrypted = await crypto.subtle.decrypt(
        { name: "AES-CBC", iv: MEDIA_IV },
        key,
        encrypted
      );

      return withCors(new Response(decrypted, {
        status: 200,
        headers: {
          "Content-Type": detectImageType(new Uint8Array(decrypted)),
          "Content-Disposition": "inline"
        }
      }));
    } catch (error) {
      return withCors(new Response("Cover decrypt failed", { status: 502 }));
    }
  }
};

function detectImageType(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return "application/octet-stream";
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "*"
  };
}

function withCors(response) {
  const headers = new Headers(response.headers);
  Object.entries(corsHeaders()).forEach(([name, value]) => headers.set(name, value));
  return new Response(response.body, { status: response.status, headers: headers });
}
