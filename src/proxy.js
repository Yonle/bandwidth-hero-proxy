"use strict";
/*
 * proxy.js
 * The bandwidth hero proxy handler.
 * proxy(httpRequest, httpResponse);
 */
const undici = require("undici");
const pick = require("lodash").pick;
const shouldCompress = require("./shouldCompress");
const redirect = require("./redirect");
const compress = require("./compress");

async function proxy(req, res) {
  /*
   * Avoid loopback that could causing server hang.
   */
  if (
    req.headers["via"] == "1.1 bandwidth-hero" &&
    ["127.0.0.1", "::1"].includes(req.headers["x-forwarded-for"] || req.ip)
  )
    return redirect(req, res);
  try {
    let origin = await undici.request(req.params.url, {
      headers: {
        ...pick(req.headers, ["cookie", "dnt", "referer", "range"]),
        "user-agent": "Bandwidth-Hero Compressor",
        "x-forwarded-for": req.headers["x-forwarded-for"] || req.ip,
        via: "1.1 bandwidth-hero",
      },
      maxRedirections: 4
    });
    _onRequestResponse(origin, req, res);
  } catch (err) {
    _onRequestError(req, res, err);
  }
}

function _onRequestError(req, res, err) {
  // Ignore invalid URL.
  if (err.code === "ERR_INVALID_URL") return res.status(400).send("Invalid URL");

  /*
   * When there's a real error, Redirect then destroy the stream immediately.
   */
  redirect(req, res);
  console.error(err);
}

function _onRequestResponse(origin, req, res) {
  if (origin.statusCode >= 400) {
    origin.body.destroy()
    return redirect(req, res);
  }

  // handle redirects
  if (origin.statusCode >= 300 && origin.headers.location) {
    origin.body.destroy()
    return redirect(req, res);
  }

  res.setHeader("content-encoding", "identity");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "unsafe-none");
  req.params.originType = origin.headers["content-type"] || "";
  req.params.originSize = origin.headers["content-length"] || "0";

  origin.body.on('error', _ => req.socket.destroy());

  if (shouldCompress(req)) {
    /*
     * sharp support stream. So pipe it.
     */
    return compress(req, res, origin);
  } else {
    origin.body.destroy()
    return redirect(req, res);
  }
}


module.exports = proxy;
