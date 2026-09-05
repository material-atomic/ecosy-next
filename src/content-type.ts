/**
 * MIME types by short name, for building `Content-Type` headers without
 * retyping the strings.
 *
 * @example
 * new Response(body, { headers: { "content-type": CONTENT_TYPES.json } });
 */
export const CONTENT_TYPES = {
  json: "application/json",
  text: "text/plain",
  html: "text/html",
  css: "text/css",
  js: "text/javascript",
  xml: "application/xml",
  jpg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  urlencoded: "application/x-www-form-urlencoded",
  javascript: "application/javascript"
};
